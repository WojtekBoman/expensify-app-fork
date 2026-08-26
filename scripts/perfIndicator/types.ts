import type {MeasureEntry} from '@callstack/reassure-compare';

/** Shared shapes for the perf-indicator POC (plan phase 2b/2c). */

/** One scenario's recorded tier A violation, as stored in `perf-known-issues.json`. */
type KnownIssue = {
    /** Number of redundant updates recorded on `main`. */
    redundantUpdates: number;

    /** `initialUpdateCount` recorded on `main`. */
    initialUpdateCount: number;
};

type KnownIssues = Record<string, KnownIssue>;

type Delta<T> = {
    baseline: T | undefined;
    current: T;
};

/** Why a render scenario made it into the comment. */
type RenderRowStatus =
    /** Scenario has no baseline entry - report absolute values. */
    | 'added'
    /** Scenario was clean on baseline and is not clean now. */
    | 'new'
    /** Scenario already violated, and the violation got worse than the recorded value. */
    | 'grown';

type RenderRow = {
    name: string;
    status: RenderRowStatus;
    meanCount: Delta<number>;
    initialUpdateCount: Delta<number>;
    redundantUpdates: Delta<number[]>;
};

type DurationRow = {
    name: string;
    type: MeasureEntry['type'];
    baselineMeanDuration: number;
    currentMeanDuration: number;
    relativeDurationDiff: number;
};

type PerfDiff = {
    renderRows: RenderRow[];
    durationRows: DurationRow[];
    addedScenarios: string[];
    removedScenarios: string[];
    /** Counts for the collapsed section, so a clean comment can still say what was measured. */
    stats: {
        /** Mirrors `DiffOptions.includeDuration`, so the renderer can say why a duration row is absent. */
        durationReported: boolean;

        comparedCount: number;
        renderComparedCount: number;
        durationEligibleCount: number;
        knownIssuesMuted: number;
    };
};

type DiffOptions = {
    /**
     * Whether duration rows may appear at all. Off by default: baseline and branch are measured on two independently
     * provisioned runners with no shared timing reference, so a per-PR duration number reports the runner as much as
     * the diff. Turning this on is a claim that the measurement has been repaired.
     */
    includeDuration: boolean;

    /** Only scenarios whose baseline mean is at or above this (ms) can produce a duration row. */
    durationFloorMs: number;

    /** Minimum absolute relative duration change for a duration row. */
    durationRelativeThreshold: number;

    /** Recorded tier A violations to mute. */
    knownIssues: KnownIssues;
};

export type {DiffOptions, DurationRow, KnownIssue, KnownIssues, PerfDiff, RenderRow, RenderRowStatus};
