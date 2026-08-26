/**
 * Renders the perf-indicator comment body from a Reassure `output.json`.
 *
 * Usage: bun scripts/perfIndicator/cli.ts [--output <path>] [--known-issues <path>] [--out <path>] [--with-duration] [--floor <ms>] [--threshold <ratio>]
 *
 * Duration rows are off unless `--with-duration` is passed. Baseline and branch are measured on two independently
 * provisioned runners, so a per-PR duration number reports the runner as much as the diff.
 *
 * Writes the body to `--out` (default `.reassure/perf-comment.md`), a `signal` / `clean` verdict to `<out>.status`,
 * and prints the body. Nothing here touches the GitHub API: the posting job reads both files.
 *
 * The verdict file exists because `postOrReplaceComment` always posts. A clean run has to stay silent unless a
 * previous push already commented, and only the caller knows that.
 */
import type {CompareResult} from '@callstack/reassure-compare';

import fs from 'fs';

import type {KnownIssues} from './types';

import buildPerfDiff, {DEFAULT_OPTIONS} from './diff';
import parseJson from './parseJson';
import renderPerfComment from './render';

function getArg(name: string, fallback: string): string {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? fallback : (process.argv.at(index + 1) ?? fallback);
}

function hasFlag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

function readKnownIssues(path: string): KnownIssues {
    if (!fs.existsSync(path)) {
        return {};
    }
    return parseJson<KnownIssues>(fs.readFileSync(path, 'utf8'));
}

function main() {
    const outputPath = getArg('output', '.reassure/output.json');
    const outPath = getArg('out', '.reassure/perf-comment.md');
    const knownIssues = readKnownIssues(getArg('known-issues', 'perf-known-issues.json'));
    const includeDuration = hasFlag('with-duration');
    const durationFloorMs = Number(getArg('floor', String(DEFAULT_OPTIONS.durationFloorMs)));
    const durationRelativeThreshold = Number(getArg('threshold', String(DEFAULT_OPTIONS.durationRelativeThreshold)));

    const output = parseJson<CompareResult>(fs.readFileSync(outputPath, 'utf8'));
    const diff = buildPerfDiff(output, {includeDuration, durationFloorMs, durationRelativeThreshold, knownIssues});
    const body = renderPerfComment(diff, {includeDuration, durationFloorMs, durationRelativeThreshold});

    const verdict = diff.renderRows.length > 0 || diff.durationRows.length > 0 ? 'signal' : 'clean';

    fs.writeFileSync(outPath, body);
    fs.writeFileSync(`${outPath}.status`, verdict);
    console.log(body);
}

main();
