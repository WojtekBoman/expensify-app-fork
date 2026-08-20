/**
 * Reads a JSON file whose shape is produced by a tool this repo controls (`reassure-compare`'s `output.json`, a
 * `.perf` line, or the committed known-issues list). Parsing is a single assertion here rather than one per call
 * site; a malformed file surfaces as a downstream `undefined`, which the diff treats as "no data" rather than
 * crashing the comment job.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse returns `any`; every caller passes output written by reassure or by this directory's own scripts.
const parseJson = <T>(contents: string): T => JSON.parse(contents) as T;

export default parseJson;
