/**
 * Tier A + tier C diff over a Reassure `output.json`.
 *
 * `output.json` carries no baseline-vs-current tier A comparison: `countChanged` filters on upstream's hardcoded
 * `COUNT_DIFF_THRESHOLD = 0.5`, and `renderIssues` filters `current.issues` with no baseline term at all. This module
 * is that missing comparison.
 *
 * `compared` is reconstructed as `significant + meaningless` - upstream partitions every compared entry between those
 * two buckets, so their union is lossless (`compare.js:130-131`).
 */
import type {AddedEntry, CompareEntry, CompareResult, MeasureEntry, RemovedEntry} from '@callstack/reassure-compare';

import type {DiffOptions, DurationRow, PerfDiff, RenderRow} from './types';

const DEFAULT_OPTIONS: DiffOptions = {
    durationFloorMs: 5,
    durationRelativeThreshold: 0.2,
    knownIssues: {},
};

function getIssueCounts(entry: MeasureEntry | undefined) {
    return {
        initialUpdateCount: entry?.issues?.initialUpdateCount ?? 0,
        redundantUpdates: entry?.issues?.redundantUpdates ?? [],
    };
}

function buildRenderRow(entry: CompareEntry | AddedEntry, options: DiffOptions): RenderRow | undefined {
    const current = getIssueCounts(entry.current);
    const isAdded = entry.baseline === undefined;

    if (isAdded) {
        const hasViolation = current.initialUpdateCount > 0 || current.redundantUpdates.length > 0;
        if (!hasViolation) {
            return undefined;
        }
        return {
            name: entry.name,
            status: 'added',
            meanCount: {baseline: undefined, current: entry.current.meanCount},
            initialUpdateCount: {baseline: undefined, current: current.initialUpdateCount},
            redundantUpdates: {baseline: undefined, current: current.redundantUpdates},
        };
    }

    const baseline = getIssueCounts(entry.baseline);

    // The known-issues list is the floor a scenario is compared against, not the baseline entry: a PR that also
    // happens to move the baseline should not be able to hide behind it. Absent from the list means "must be clean".
    const known = options.knownIssues[entry.name];
    const floor = {
        initialUpdateCount: Math.max(baseline.initialUpdateCount, known?.initialUpdateCount ?? 0),
        redundantUpdates: Math.max(baseline.redundantUpdates.length, known?.redundantUpdates ?? 0),
    };

    const countGrew = entry.current.meanCount > entry.baseline.meanCount;
    const initialGrew = current.initialUpdateCount > floor.initialUpdateCount;
    const redundantGrew = current.redundantUpdates.length > floor.redundantUpdates;

    if (!countGrew && !initialGrew && !redundantGrew) {
        return undefined;
    }

    const wasClean = baseline.initialUpdateCount === 0 && baseline.redundantUpdates.length === 0;
    return {
        name: entry.name,
        status: wasClean ? 'new' : 'grown',
        meanCount: {baseline: entry.baseline.meanCount, current: entry.current.meanCount},
        initialUpdateCount: {baseline: baseline.initialUpdateCount, current: current.initialUpdateCount},
        redundantUpdates: {baseline: baseline.redundantUpdates, current: current.redundantUpdates},
    };
}

function buildDurationRow(entry: CompareEntry, options: DiffOptions): DurationRow | undefined {
    if (entry.baseline.meanDuration < options.durationFloorMs) {
        return undefined;
    }
    if (Math.abs(entry.relativeDurationDiff) <= options.durationRelativeThreshold) {
        return undefined;
    }
    return {
        name: entry.name,
        type: entry.type,
        baselineMeanDuration: entry.baseline.meanDuration,
        currentMeanDuration: entry.current.meanDuration,
        relativeDurationDiff: entry.relativeDurationDiff,
    };
}

function buildPerfDiff(output: CompareResult, overrides: Partial<DiffOptions> = {}): PerfDiff {
    const options: DiffOptions = {...DEFAULT_OPTIONS, ...overrides};

    const compared: CompareEntry[] = [...(output.significant ?? []), ...(output.meaningless ?? [])];
    const added: AddedEntry[] = output.added ?? [];
    const removed: RemovedEntry[] = output.removed ?? [];

    const renderCandidates = [...compared, ...added].filter((entry) => entry.type === 'render');
    const renderRows = renderCandidates.map((entry) => buildRenderRow(entry, options)).filter((row): row is RenderRow => row !== undefined);

    const durationRows = compared
        .map((entry) => buildDurationRow(entry, options))
        .filter((row): row is DurationRow => row !== undefined)
        .sort((a, b) => b.relativeDurationDiff - a.relativeDurationDiff);

    // A muted scenario is one that violates today but produced no row.
    const reportedNames = new Set(renderRows.map((row) => row.name));
    const knownIssuesMuted = renderCandidates.filter((entry) => {
        const current = getIssueCounts(entry.current);
        const violates = current.initialUpdateCount > 0 || current.redundantUpdates.length > 0;
        return violates && !reportedNames.has(entry.name);
    }).length;

    return {
        renderRows: renderRows.sort((a, b) => a.name.localeCompare(b.name)),
        durationRows,
        addedScenarios: added.map((entry) => entry.name).sort(),
        removedScenarios: removed.map((entry) => entry.name).sort(),
        stats: {
            comparedCount: compared.length,
            renderComparedCount: compared.filter((entry) => entry.type === 'render').length,
            durationEligibleCount: compared.filter((entry) => entry.baseline.meanDuration >= options.durationFloorMs).length,
            knownIssuesMuted,
        },
    };
}

export default buildPerfDiff;
export {DEFAULT_OPTIONS};
