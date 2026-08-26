import {describe, expect, test} from 'bun:test';

import buildPerfDiff from '@scripts/perfIndicator/diff';
import parseJson from '@scripts/perfIndicator/parseJson';
import renderPerfComment from '@scripts/perfIndicator/render';
import type {KnownIssues} from '@scripts/perfIndicator/types';

import type {AddedEntry, CompareEntry, CompareResult, MeasureEntry, RemovedEntry, RenderIssues} from '@callstack/reassure-compare';

import {compare} from '@callstack/reassure-compare';
import fs from 'fs';
import os from 'os';
import path from 'path';

const RENDER_OPTIONS = {durationFloorMs: 5, durationRelativeThreshold: 0.2};

function buildEntry(overrides: Partial<MeasureEntry> & {name: string}): MeasureEntry {
    return {
        name: overrides.name,
        type: overrides.type ?? 'render',
        runs: 10,
        meanDuration: overrides.meanDuration ?? 10,
        stdevDuration: overrides.stdevDuration ?? 0.1,
        durations: overrides.durations ?? Array.from({length: 10}, () => overrides.meanDuration ?? 10),
        warmupDurations: [],
        outlierDurations: [],
        meanCount: overrides.meanCount ?? 1,
        stdevCount: 0,
        counts: Array.from({length: 10}, () => overrides.meanCount ?? 1),
        issues: overrides.issues,
    } as MeasureEntry;
}

function buildCompared(baseline: MeasureEntry, current: MeasureEntry): CompareEntry {
    const durationDiff = current.meanDuration - baseline.meanDuration;
    return {
        name: baseline.name,
        type: baseline.type,
        baseline,
        current,
        durationDiff,
        relativeDurationDiff: durationDiff / baseline.meanDuration,
        isDurationDiffSignificant: false,
        countDiff: current.meanCount - baseline.meanCount,
        relativeCountDiff: (current.meanCount - baseline.meanCount) / baseline.meanCount,
    };
}

function buildOutput(overrides: Partial<CompareResult> = {}): CompareResult {
    return {
        metadata: {},
        errors: [],
        warnings: [],
        significant: [],
        meaningless: [],
        countChanged: [],
        renderIssues: [],
        added: [],
        removed: [],
        ...overrides,
    };
}

const issues = (initialUpdateCount: number, redundantUpdates: number[]): RenderIssues => ({initialUpdateCount, redundantUpdates}) as RenderIssues;

describe('perf-indicator diff', () => {
    test('reports nothing when a scenario is unchanged', () => {
        const entry = buildEntry({name: 'clean'});
        const diff = buildPerfDiff(buildOutput({meaningless: [buildCompared(entry, entry)]}));

        expect(diff.renderRows).toEqual([]);
        expect(diff.durationRows).toEqual([]);
        expect(diff.stats.comparedCount).toBe(1);
    });

    test('reports a new violation on a previously clean scenario', () => {
        const baseline = buildEntry({name: 'a'});
        const current = buildEntry({name: 'a', issues: issues(0, [1])});
        const diff = buildPerfDiff(buildOutput({meaningless: [buildCompared(baseline, current)]}));

        expect(diff.renderRows).toHaveLength(1);
        expect(diff.renderRows.at(0)?.status).toBe('new');
        expect(diff.renderRows.at(0)?.redundantUpdates).toEqual({baseline: [], current: [1]});
    });

    test('reports a grown violation and mutes an unchanged known one', () => {
        const knownIssues: KnownIssues = {
            grown: {redundantUpdates: 1, initialUpdateCount: 0},
            unchanged: {redundantUpdates: 2, initialUpdateCount: 1},
        };
        const grown = buildCompared(buildEntry({name: 'grown', issues: issues(0, [1])}), buildEntry({name: 'grown', issues: issues(0, [1, 2])}));
        const unchanged = buildCompared(buildEntry({name: 'unchanged', issues: issues(1, [1, 2])}), buildEntry({name: 'unchanged', issues: issues(1, [1, 2])}));

        const diff = buildPerfDiff(buildOutput({meaningless: [grown, unchanged]}), {knownIssues});

        expect(diff.renderRows.map((row) => row.name)).toEqual(['grown']);
        expect(diff.renderRows.at(0)?.status).toBe('grown');
        expect(diff.stats.knownIssuesMuted).toBe(1);
    });

    test('reports nothing when a violation shrinks', () => {
        const shrunk = buildCompared(buildEntry({name: 'shrunk', issues: issues(1, [1, 2])}), buildEntry({name: 'shrunk', issues: issues(0, [1])}));
        const diff = buildPerfDiff(buildOutput({meaningless: [shrunk]}), {knownIssues: {shrunk: {redundantUpdates: 2, initialUpdateCount: 1}}});

        expect(diff.renderRows).toEqual([]);
    });

    test('reports a meanCount increase even when the issues object is empty', () => {
        const diff = buildPerfDiff(buildOutput({meaningless: [buildCompared(buildEntry({name: 'counted', meanCount: 2}), buildEntry({name: 'counted', meanCount: 3}))]}));

        expect(diff.renderRows.at(0)?.meanCount).toEqual({baseline: 2, current: 3});
    });

    test('ignores a sub-threshold meanCount move, which is run-to-run jitter', () => {
        // Replayed from a real branch: 3 -> 3.2 with unchanged issue counts means the scenario rendered once more in
        // 2 of 10 runs. Upstream guards this with COUNT_DIFF_THRESHOLD = 0.5 and so must the comment.
        const diff = buildPerfDiff(buildOutput({meaningless: [buildCompared(buildEntry({name: 'jitter', meanCount: 3}), buildEntry({name: 'jitter', meanCount: 3.2}))]}));

        expect(diff.renderRows).toEqual([]);
    });

    test('reports an added scenario with a violation using absolute values', () => {
        const added: AddedEntry = {name: 'brand new', type: 'render', current: buildEntry({name: 'brand new', issues: issues(2, [1])})};
        const diff = buildPerfDiff(buildOutput({added: [added]}));

        expect(diff.renderRows.at(0)?.status).toBe('added');
        expect(diff.renderRows.at(0)?.initialUpdateCount).toEqual({baseline: undefined, current: 2});
        expect(diff.addedScenarios).toEqual(['brand new']);
    });

    test('counts a removed scenario without producing a row', () => {
        const removed: RemovedEntry = {name: 'gone', type: 'render', baseline: buildEntry({name: 'gone', issues: issues(0, [1])})};
        const diff = buildPerfDiff(buildOutput({removed: [removed]}));

        expect(diff.renderRows).toEqual([]);
        expect(diff.removedScenarios).toEqual(['gone']);
    });

    test('ignores issues on function entries, which never emit them', () => {
        const entry = buildCompared(buildEntry({name: 'fn', type: 'function'}), buildEntry({name: 'fn', type: 'function', meanCount: 5}));
        const diff = buildPerfDiff(buildOutput({meaningless: [entry]}));

        expect(diff.renderRows).toEqual([]);
    });
});

describe('perf-indicator duration section', () => {
    test('reports a scenario above the floor that moved past the threshold', () => {
        const entry = buildCompared(buildEntry({name: 'slow', type: 'function', meanDuration: 50}), buildEntry({name: 'slow', type: 'function', meanDuration: 70}));
        const diff = buildPerfDiff(buildOutput({significant: [entry]}));

        expect(diff.durationRows).toHaveLength(1);
        expect(diff.durationRows.at(0)?.relativeDurationDiff).toBeCloseTo(0.4);
    });

    test('drops a sub-floor scenario however large the relative change', () => {
        const entry = buildCompared(buildEntry({name: 'fast', type: 'function', meanDuration: 0.001}), buildEntry({name: 'fast', type: 'function', meanDuration: 0.1}));
        const diff = buildPerfDiff(buildOutput({significant: [entry]}));

        expect(diff.durationRows).toEqual([]);
        expect(diff.stats.durationEligibleCount).toBe(0);
    });

    test('drops a scenario above the floor that stayed inside the threshold', () => {
        const entry = buildCompared(buildEntry({name: 'steady', type: 'function', meanDuration: 50}), buildEntry({name: 'steady', type: 'function', meanDuration: 55}));
        const diff = buildPerfDiff(buildOutput({significant: [entry]}));

        expect(diff.durationRows).toEqual([]);
        expect(diff.stats.durationEligibleCount).toBe(1);
    });

    test('reports improvements too, so the comment is not one-sided', () => {
        const entry = buildCompared(buildEntry({name: 'faster', type: 'function', meanDuration: 50}), buildEntry({name: 'faster', type: 'function', meanDuration: 20}));
        const diff = buildPerfDiff(buildOutput({significant: [entry]}));

        expect(diff.durationRows.at(0)?.relativeDurationDiff).toBeCloseTo(-0.6);
    });
});

describe('perf-indicator rendering', () => {
    test('renders one visible line on a clean comparison', () => {
        const body = renderPerfComment(buildPerfDiff(buildOutput()), RENDER_OPTIONS);

        expect(body).toContain('<!-- perf-indicator -->');
        expect(body).toContain('No render or duration change.');
        expect(body).not.toContain('### Render counts');
        expect(body).not.toContain('### Duration');
    });

    test('names the newly-added redundant update indices', () => {
        const entry = buildCompared(buildEntry({name: 'a', issues: issues(0, [1])}), buildEntry({name: 'a', issues: issues(0, [1, 4])}));
        const body = renderPerfComment(buildPerfDiff(buildOutput({meaningless: [entry]})), RENDER_OPTIONS);

        expect(body).toContain('1 -> 2 (new at update 4)');
    });
});

describe('perf-indicator over a real compare() run', () => {
    /**
     * `output.json` has no `compared` array, so the diff reconstructs it as `significant + meaningless`. That
     * reconstruction is the one assumption in this module that upstream could break, so it is checked against a real
     * `compare()` run rather than a hand-built fixture.
     */
    test('sees every compared entry through significant + meaningless', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-indicator-'));
        const header = JSON.stringify({metadata: {branch: 'test', commitHash: 'abc'}});
        const baselineEntries = [buildEntry({name: 'renderOne'}), buildEntry({name: 'renderTwo', issues: issues(0, [1])}), buildEntry({name: 'fn', type: 'function', meanDuration: 50})];
        const currentEntries = [
            buildEntry({name: 'renderOne', issues: issues(0, [2])}),
            buildEntry({name: 'renderTwo', issues: issues(0, [1])}),
            buildEntry({name: 'fn', type: 'function', meanDuration: 80}),
        ];

        const baselineFile = path.join(directory, 'baseline.perf');
        const currentFile = path.join(directory, 'current.perf');
        const outputFile = path.join(directory, 'output.json');
        fs.writeFileSync(baselineFile, `${[header, ...baselineEntries.map((entry) => JSON.stringify(entry))].join('\n')}\n`);
        fs.writeFileSync(currentFile, `${[header, ...currentEntries.map((entry) => JSON.stringify(entry))].join('\n')}\n`);

        await compare({baselineFile, currentFile, outputFile, outputFormat: 'json'});
        const output = parseJson<CompareResult>(fs.readFileSync(outputFile, 'utf8'));
        const diff = buildPerfDiff(output, {knownIssues: {renderTwo: {redundantUpdates: 1, initialUpdateCount: 0}}});

        expect(diff.stats.comparedCount).toBe(3);
        expect(diff.renderRows.map((row) => row.name)).toEqual(['renderOne']);
        expect(diff.durationRows.map((row) => row.name)).toEqual(['fn']);

        fs.rmSync(directory, {recursive: true, force: true});
    });
});
