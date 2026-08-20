/** Renders a `PerfDiff` into the sticky PR comment body (plan phase 2c). */
import type {DurationRow, PerfDiff, RenderRow} from './types';

const MARKER = '<!-- perf-indicator -->';

/** GitHub rejects comment bodies past 65536 characters; stay well clear of it. */
const MAX_BODY_LENGTH = 30000;

function formatMs(value: number): string {
    return `${value.toFixed(value < 1 ? 4 : 2)} ms`;
}

function formatPercent(value: number): string {
    return `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function formatCountDelta(baseline: number | undefined, current: number): string {
    if (baseline === undefined) {
        return `${current} (new)`;
    }
    return baseline === current ? `${current}` : `${baseline} -> ${current}`;
}

function formatRedundantUpdates(row: RenderRow): string {
    const {baseline, current} = row.redundantUpdates;
    const counts = formatCountDelta(baseline?.length, current.length);
    if (baseline === undefined) {
        return counts;
    }

    // `redundantUpdates` holds update indices, not component names, so the useful detail is which update turned
    // redundant.
    const added = current.filter((index) => !baseline.includes(index));
    return added.length > 0 ? `${counts} (new at update ${added.join(', ')})` : counts;
}

function renderRenderSection(rows: RenderRow[]): string {
    const header = ['| scenario | status | mean renders | initial updates | redundant updates |', '| --- | --- | --- | --- | --- |'];
    const body = rows.map(
        (row) =>
            `| ${row.name} | ${row.status} | ${formatCountDelta(row.meanCount.baseline, row.meanCount.current)} | ` +
            `${formatCountDelta(row.initialUpdateCount.baseline, row.initialUpdateCount.current)} | ${formatRedundantUpdates(row)} |`,
    );
    return ['### Render counts', ...header, ...body].join('\n');
}

function renderDurationSection(rows: DurationRow[], floorMs: number, threshold: number): string {
    const header = ['| scenario | before | after | change |', '| --- | --- | --- | --- |'];
    const body = rows.map((row) => `| ${row.name} | ${formatMs(row.baselineMeanDuration)} | ${formatMs(row.currentMeanDuration)} | ${formatPercent(row.relativeDurationDiff)} |`);
    return [
        '### Duration (advisory)',
        `Scenarios with a baseline mean at or above ${floorMs} ms that moved by more than ${(threshold * 100).toFixed(0)}%. ` +
            'That floor is blunt, not calibrated: wall-clock here is measured across two runners and never fails this check.',
        ...header,
        ...body,
    ].join('\n');
}

function renderPerfComment(diff: PerfDiff, options: {durationFloorMs: number; durationRelativeThreshold: number}): string {
    const sections: string[] = [MARKER, '## Performance'];

    const hasRenderRows = diff.renderRows.length > 0;
    const hasDurationRows = diff.durationRows.length > 0;

    if (!hasRenderRows && !hasDurationRows) {
        sections.push('No render or duration change.');
    } else {
        const parts = [hasRenderRows ? `${diff.renderRows.length} render` : '', hasDurationRows ? `${diff.durationRows.length} duration` : ''].filter(Boolean);
        sections.push(`${parts.join(' and ')} row(s) below.`);
    }

    if (hasRenderRows) {
        sections.push(renderRenderSection(diff.renderRows));
    }
    if (hasDurationRows) {
        sections.push(renderDurationSection(diff.durationRows, options.durationFloorMs, options.durationRelativeThreshold));
    }

    const details = [
        '<details>',
        '<summary>Measurement details</summary>',
        '',
        `- compared scenarios: ${diff.stats.comparedCount} (${diff.stats.renderComparedCount} render)`,
        `- eligible for a duration row: ${diff.stats.durationEligibleCount}`,
        `- known render issues muted: ${diff.stats.knownIssuesMuted}`,
        `- added scenarios: ${diff.addedScenarios.length}`,
        `- removed scenarios: ${diff.removedScenarios.length}`,
        '',
        '</details>',
    ];
    sections.push(details.join('\n'));

    const body = sections.join('\n\n');
    return body.length > MAX_BODY_LENGTH ? `${body.slice(0, MAX_BODY_LENGTH)}\n\n_Truncated._` : body;
}

export default renderPerfComment;
export {MARKER, MAX_BODY_LENGTH};
