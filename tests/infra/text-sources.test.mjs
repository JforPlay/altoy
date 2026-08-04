/**
 * text-sources.test.mjs
 * Gates source files that git classifies as binary.
 *
 * A single NUL byte anywhere in the first 8000 makes git treat the whole file as
 * binary: `git diff` prints "Bin 4467 -> 6746 bytes" instead of a diff, and the
 * change becomes unreviewable — while node runs it fine, so every test, the
 * build and the smoke suite stay green. The realistic way to introduce one is a
 * raw NUL character typed straight into a template string as a join separator;
 * spelling it as an escape keeps the same runtime value and the file plain text.
 *
 * This asks git for its own verdict (`ls-files --eol`) rather than re-deriving
 * the rule, so it flags exactly what would show up as unreviewable in a diff.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Extensions whose contents a human is expected to read in a diff. */
const SOURCE_EXT = /\.(js|mjs|cjs|ts|astro|css|md|json|txt|py|ya?ml|html)$/i;

/**
 * Tracked files plus untracked-but-not-ignored ones, with git's eol/binary
 * verdict. `--others` matters: a brand-new file is the likeliest place for this
 * to appear, and it is not in the index yet when the author runs the tests.
 */
function gitEolEntries() {
    const out = execFileSync('git',
        ['ls-files', '--eol', '--cached', '--others', '--exclude-standard'],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return out.split('\n').filter(Boolean).map((line) => {
        // "i/lf    w/crlf  attr/<attrs>\t<path>" — attrs are space-padded, path follows a tab.
        const tab = line.indexOf('\t');
        return {
            path: line.slice(tab + 1),
            // The worktree verdict, not the index one: it is what the author is
            // editing and what `git add` will copy, and a file that is binary in
            // HEAD reads binary here too until someone actually fixes it. Reading
            // i/ as well would only keep flagging an already-fixed-but-unstaged file.
            worktreeEol: line.slice(0, tab).trim().split(/\s+/).find((f) => f.startsWith('w/')),
        };
    });
}

const entries = gitEolEntries().filter((e) => SOURCE_EXT.test(e.path));

test('no source file is binary to git — a NUL byte makes its diff unreviewable', () => {
    const binary = entries.filter((e) => e.worktreeEol === 'w/-text').map((e) => e.path);
    assert.deepEqual(binary, [],
        `Source file(s) git treats as binary, so their diffs show as "Bin <n> bytes"\n`
        + `and cannot be reviewed. Almost certainly a raw NUL in a string — spell it\n`
        + `as an escape instead:\n  ${binary.join('\n  ')}`);
});

test('the scan reaches real files — a passing run means coverage, not an empty sweep', () => {
    assert.ok(entries.length > 200, `only ${entries.length} source files enumerated`);
    assert.ok(entries.some((e) => e.path === 'public/js/utils.js'), 'utils.js missing from the scan');
});
