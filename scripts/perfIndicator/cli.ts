/**
 * Renders the perf-indicator comment body from a Reassure `output.json`.
 *
 * Usage: bun scripts/perfIndicator/cli.ts [--output <path>] [--known-issues <path>] [--out <path>] [--floor <ms>] [--threshold <ratio>]
 *
 * Writes the body to `--out` (default `.reassure/perf-comment.md`) and prints it. Nothing here touches the GitHub API:
 * the posting job consumes the file as an artifact.
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
    const durationFloorMs = Number(getArg('floor', String(DEFAULT_OPTIONS.durationFloorMs)));
    const durationRelativeThreshold = Number(getArg('threshold', String(DEFAULT_OPTIONS.durationRelativeThreshold)));

    const output = parseJson<CompareResult>(fs.readFileSync(outputPath, 'utf8'));
    const diff = buildPerfDiff(output, {durationFloorMs, durationRelativeThreshold, knownIssues});
    const body = renderPerfComment(diff, {durationFloorMs, durationRelativeThreshold});

    fs.writeFileSync(outPath, body);
    console.log(body);
}

main();
