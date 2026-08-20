/**
 * Seeds `perf-known-issues.json` from a `.perf` file measured on `main`.
 *
 * Usage: bun scripts/perfIndicator/seedKnownIssues.ts [--baseline <path>] [--out <path>]
 */
import type {MeasureEntry} from '@callstack/reassure-compare';

import fs from 'fs';

import type {KnownIssues} from './types';

import parseJson from './parseJson';

function getArg(name: string, fallback: string): string {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? fallback : (process.argv.at(index + 1) ?? fallback);
}

function readEntries(path: string): MeasureEntry[] {
    return fs
        .readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .map((line) => parseJson<MeasureEntry | {metadata: unknown}>(line))
        .filter((value): value is MeasureEntry => 'name' in value);
}

function main() {
    const entries = readEntries(getArg('baseline', '.reassure/baseline.perf'));
    const outPath = getArg('out', 'perf-known-issues.json');

    const knownIssues: KnownIssues = {};
    const violating = entries
        .filter((entry) => (entry.issues?.initialUpdateCount ?? 0) > 0 || (entry.issues?.redundantUpdates?.length ?? 0) > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of violating) {
        knownIssues[entry.name] = {
            redundantUpdates: entry.issues?.redundantUpdates?.length ?? 0,
            initialUpdateCount: entry.issues?.initialUpdateCount ?? 0,
        };
    }

    fs.writeFileSync(outPath, `${JSON.stringify(knownIssues, null, 4)}\n`);
    console.log(`Seeded ${Object.keys(knownIssues).length} scenarios into ${outPath}`);
}

main();
