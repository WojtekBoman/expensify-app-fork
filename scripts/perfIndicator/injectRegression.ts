/**
 * Seeds a synthetic regression pair from a real `.perf` file, so the indicator can be exercised without CI and
 * without a real code change.
 *
 * `.perf` files are line-delimited JSON (a metadata header, then one entry per scenario), so a "regressed branch" is
 * just the baseline with a few fields edited. Every mutation is printed, giving an expected-versus-actual list to
 * check the rendered comment against.
 *
 * Usage: bun scripts/perfIndicator/injectRegression.ts [--baseline <path>] [--out-dir <dir>]
 */
import type {MeasureEntry, MeasureHeader} from '@callstack/reassure-compare';

import fs from 'fs';
import path from 'path';

import parseJson from './parseJson';

function getArg(name: string, fallback: string): string {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? fallback : (process.argv.at(index + 1) ?? fallback);
}

type PerfFile = {
    header: MeasureHeader;
    entries: MeasureEntry[];
};

function readPerfFile(filePath: string): PerfFile {
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
    const [headerLine, ...entryLines] = lines;
    return {
        header: parseJson<MeasureHeader>(headerLine ?? '{}'),
        entries: entryLines.map((line) => parseJson<MeasureEntry>(line)),
    };
}

function writePerfFile(filePath: string, file: PerfFile) {
    const lines = [JSON.stringify(file.header), ...file.entries.map((entry) => JSON.stringify(entry))];
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function scaleDuration(entry: MeasureEntry, factor: number): MeasureEntry {
    return {
        ...entry,
        meanDuration: entry.meanDuration * factor,
        durations: entry.durations.map((value) => value * factor),
    };
}

function hasIssues(entry: MeasureEntry): boolean {
    return (entry.issues?.initialUpdateCount ?? 0) > 0 || (entry.issues?.redundantUpdates?.length ?? 0) > 0;
}

function main() {
    const baselinePath = getArg('baseline', '.reassure/baseline.perf');
    const outDir = getArg('out-dir', '.reassure-poc');
    const baseline = readPerfFile(baselinePath);

    const cleanRenders = baseline.entries.filter((entry) => entry.type === 'render' && !hasIssues(entry));
    const violatingRenders = baseline.entries.filter((entry) => entry.type === 'render' && hasIssues(entry));
    const functions = baseline.entries.filter((entry) => entry.type === 'function');
    const slowFunction = [...functions].sort((a, b) => b.meanDuration - a.meanDuration).at(0);
    const fastFunction = [...functions].sort((a, b) => a.meanDuration - b.meanDuration).at(0);

    const mutations: Array<{name: string; seeded: string; expectRow: boolean}> = [];
    const mutate = new Map<string, (entry: MeasureEntry) => MeasureEntry>();

    const newViolation = cleanRenders.at(0);
    if (newViolation) {
        mutate.set(newViolation.name, (entry) => ({...entry, issues: {initialUpdateCount: 0, redundantUpdates: [1]}}));
        mutations.push({name: newViolation.name, seeded: 'new redundantUpdates [1] on a previously clean scenario', expectRow: true});
    }

    const newInitialUpdate = cleanRenders.at(1);
    if (newInitialUpdate) {
        mutate.set(newInitialUpdate.name, (entry) => ({...entry, issues: {initialUpdateCount: 1, redundantUpdates: []}}));
        mutations.push({name: newInitialUpdate.name, seeded: 'initialUpdateCount 0 -> 1', expectRow: true});
    }

    const countBump = cleanRenders.at(2);
    if (countBump) {
        mutate.set(countBump.name, (entry) => ({...entry, meanCount: entry.meanCount + 1, counts: entry.counts.map((value) => value + 1)}));
        mutations.push({name: countBump.name, seeded: `meanCount ${countBump.meanCount} -> ${countBump.meanCount + 1}`, expectRow: true});
    }

    const grown = violatingRenders.at(0);
    if (grown) {
        const current = grown.issues?.redundantUpdates ?? [];
        mutate.set(grown.name, (entry) => ({
            ...entry,
            issues: {initialUpdateCount: entry.issues?.initialUpdateCount ?? 0, redundantUpdates: [...current, 9]},
        }));
        mutations.push({name: grown.name, seeded: `redundantUpdates ${current.length} -> ${current.length + 1} on a known issue`, expectRow: true});
    }

    const unchangedKnownIssue = violatingRenders.at(1);
    if (unchangedKnownIssue) {
        mutations.push({name: unchangedKnownIssue.name, seeded: 'untouched known issue - must stay muted', expectRow: false});
    }

    if (slowFunction) {
        mutate.set(slowFunction.name, (entry) => scaleDuration(entry, 1.35));
        mutations.push({name: slowFunction.name, seeded: `duration +35% on a ${slowFunction.meanDuration.toFixed(2)} ms scenario`, expectRow: true});
    }

    if (fastFunction) {
        mutate.set(fastFunction.name, (entry) => scaleDuration(entry, 4));
        mutations.push({name: fastFunction.name, seeded: `duration x4 on a ${fastFunction.meanDuration.toFixed(4)} ms scenario - below the floor, must not appear`, expectRow: false});
    }

    const removed = functions.at(-1);
    const addedName = 'POC synthetic added scenario';

    const entries = baseline.entries
        .filter((entry) => entry.name !== removed?.name)
        .map((entry) => {
            const mutation = mutate.get(entry.name);
            return mutation ? mutation(entry) : entry;
        });

    const templateRender = cleanRenders.at(3) ?? cleanRenders.at(0);
    if (templateRender) {
        entries.push({...templateRender, name: addedName, issues: {initialUpdateCount: 2, redundantUpdates: [1]}});
        mutations.push({name: addedName, seeded: 'added scenario with a violation - absolute values, no baseline', expectRow: true});
    }
    if (removed) {
        mutations.push({name: removed.name, seeded: 'removed scenario - counted, no row', expectRow: false});
    }

    fs.mkdirSync(outDir, {recursive: true});
    writePerfFile(path.join(outDir, 'baseline.perf'), baseline);
    writePerfFile(path.join(outDir, 'current.perf'), {
        header: {...baseline.header, metadata: {...baseline.header.metadata, branch: 'poc-synthetic-regression'}},
        entries,
    });

    console.log(`Wrote ${outDir}/baseline.perf (${baseline.entries.length} entries) and ${outDir}/current.perf (${entries.length} entries)\n`);
    console.log('Seeded mutations:');
    for (const mutation of mutations) {
        console.log(`  [${mutation.expectRow ? 'expect row' : 'expect NO row'}] ${mutation.name}\n      ${mutation.seeded}`);
    }
}

main();
