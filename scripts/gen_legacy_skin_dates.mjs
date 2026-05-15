/**
 * gen_legacy_skin_dates.mjs — ONE-TIME / MANUAL RUN ONLY.
 *
 * NOT wired into `npm run build`. Regenerates the static historical backfill
 * `public/data/skin/skin_release_dates_legacy.json` by walking the commit
 * history of two archived, no-longer-updated GitHub repos:
 *   - Binary102/AzurLane_ClientSource   (KR data, 2019-01 → 2019-11)
 *   - Dimbreath/AzurLaneData            (ko-KR data, 2020-02 → 2021-01)
 *
 * Requires the `gh` CLI, authenticated (`gh auth status`).
 * Run:  node scripts/gen_legacy_skin_dates.mjs
 *
 * See dev/active/2026-05-15-legacy-skin-dates.md for the design rationale.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Commit-history bounds of each source (actual first/last commit dates).
const BIN_FIRST_DATE = '2019-01-30';   // Binary102's first KR commit
const BIN_LAST_DATE  = '2019-11-01';   // Binary102's last KR commit
const DIM_FIRST_DATE = '2020-02-10';   // Dimbreath's first ko-KR commit

// ===== Pure helpers (exported for tests) =====

/**
 * Extract the set of 5+-digit table-key IDs from a ship_skin_template.lua dump.
 * Matches both the clean `[100000] = {` literal and Dimbreath's decompiled
 * `slot1[100000] = {` assignment form. Short nested indices ([1], [2]) are
 * excluded by the 5-digit minimum; non-skin IDs are filtered later by
 * intersecting against the known skin-ID universe.
 * @param {string} content - raw lua file text
 * @returns {Set<string>} skin-ID strings present in the file
 */
export function extractSkinIds(content) {
    const ids = new Set();
    for (const m of content.matchAll(/\[(\d{5,})\]/g)) ids.add(m[1]);
    return ids;
}

/**
 * Convert a commit timestamp to a KST YYYY-MM-DD, conditionally snapped to the
 * Thursday maintenance day: Thursday kept, Fri/Sat/Sun snapped back to that
 * week's Thursday, Mon/Tue/Wed kept raw (likely a genuine off-schedule update).
 * @param {Date} date - commit timestamp (UTC)
 * @returns {string} YYYY-MM-DD in KST
 */
export function snapToThursday(date) {
    const kst = new Date(date.getTime() + 9 * 3600 * 1000);
    const dow = kst.getUTCDay();                 // 0=Sun .. 6=Sat, Thu=4
    let out = kst;
    if (dow === 5 || dow === 6 || dow === 0) {   // Fri/Sat/Sun → back to Thursday
        const back = dow === 0 ? 3 : dow - 4;
        out = new Date(kst.getTime() - back * 86400000);
    }
    return out.toISOString().slice(0, 10);
}

/**
 * Classify a skin into its encoded legacy value from its first-appearance in
 * each source. Binary102 entirely predates Dimbreath, so it always wins when
 * the skin appears in it.
 * @param {{ymd:string,isFirstCommit:boolean}|null} binFirst
 * @param {{ymd:string,isFirstCommit:boolean}|null} dimFirst
 * @returns {string|null} encoded value, or null if neither source has the skin
 */
export function classify(binFirst, dimFirst) {
    if (binFirst) {
        return binFirst.isFirstCommit ? `<${BIN_FIRST_DATE}` : binFirst.ymd;
    }
    if (dimFirst) {
        return dimFirst.isFirstCommit ? `${BIN_LAST_DATE}/${DIM_FIRST_DATE}` : dimFirst.ymd;
    }
    return null;
}

// ===== GitHub access =====

/** Run a `gh` subcommand, return stdout. */
function gh(args) {
    return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * List every commit touching `folderPath`, oldest first.
 * @returns {{sha:string,date:string}[]}
 */
function listCommits(repo, folderPath) {
    const arr = JSON.parse(gh(['api', `repos/${repo}/commits?path=${folderPath}&per_page=100`]));
    if (arr.length === 100) {
        console.warn(`[warn] ${repo}/${folderPath}: exactly 100 commits returned — pagination may be needed`);
    }
    return arr
        .map(c => ({ sha: c.sha, date: c.commit.committer.date }))
        .reverse();   // oldest first
}

/** Fetch a file's raw content at a commit, or null if it does not exist there. */
function fetchFile(repo, filePath, sha) {
    try {
        return gh(['api', `repos/${repo}/contents/${filePath}?ref=${sha}`,
            '-H', 'Accept: application/vnd.github.raw']);
    } catch (e) {
        // 404 = file absent at this sha (expected). Other errors are unusual.
        const msg = e?.message ?? '';
        if (!msg.includes('404')) {
            process.stderr.write(`[warn] fetchFile ${filePath}@${sha}: ${msg.slice(0, 120)}\n`);
        }
        return null;
    }
}

/**
 * Walk one source repo oldest→newest, recording each known skin's first
 * appearance. `isFirstCommit` marks skins already present in the source's
 * earliest snapshot.
 * @returns {Map<string,{ymd:string,isFirstCommit:boolean}>}
 */
function walkSource(repo, commits, candidatePaths, knownIds) {
    const firstSeen = new Map();
    let snapshotIndex = 0;
    for (const { sha, date } of commits) {
        let content = null;
        for (const p of candidatePaths) {
            content = fetchFile(repo, p, sha);
            if (content) break;
        }
        if (!content) continue;
        const present = extractSkinIds(content);
        const ymd = snapToThursday(new Date(date));
        for (const id of knownIds) {
            if (present.has(id) && !firstSeen.has(id)) {
                firstSeen.set(id, { ymd, isFirstCommit: snapshotIndex === 0 });
            }
        }
        console.log(`  ${repo} ${date.slice(0, 10)} ${sha.slice(0, 7)} — seen ${firstSeen.size} skins`);
        snapshotIndex++;
    }
    return firstSeen;
}

// ===== Main =====

function main() {
    const knownPath = new URL('../public/data/skin/skin_release_dates.json', import.meta.url);
    const knownMap = JSON.parse(readFileSync(knownPath, 'utf8'));
    const knownIds = Object.keys(knownMap).filter(k => k !== '_meta');
    console.log(`Known skin IDs: ${knownIds.length}`);

    console.log('Walking Binary102/AzurLane_ClientSource ...');
    const binCommits = listCommits('Binary102/AzurLane_ClientSource', 'Src/KR');
    const bin = walkSource('Binary102/AzurLane_ClientSource', binCommits,
        ['Src/KR/sharecfg/ship_skin_template.lua', 'Src/KR/ship_skin_template.lua.txt'],
        knownIds);

    console.log('Walking Dimbreath/AzurLaneData ...');
    const dimCommits = listCommits('Dimbreath/AzurLaneData', 'ko-KR');
    const dim = walkSource('Dimbreath/AzurLaneData', dimCommits,
        ['ko-KR/sharecfg/ship_skin_template.lua'], knownIds);

    const out = {};
    const counts = { exact: 0, floor: 0, range: 0, none: 0 };
    for (const id of knownIds) {
        const value = classify(bin.get(id) ?? null, dim.get(id) ?? null);
        if (value === null) { counts.none++; continue; }
        out[id] = value;
        if (value.startsWith('<')) counts.floor++;
        else if (value.includes('/')) counts.range++;
        else counts.exact++;
    }
    out._meta = {
        generated: new Date().toISOString().slice(0, 10),
        sources: {
            'Binary102/AzurLane_ClientSource': binCommits.at(-1)?.sha,
            'Dimbreath/AzurLaneData': dimCommits.at(-1)?.sha,
        },
        counts,
    };

    const outPath = new URL('../public/data/skin/skin_release_dates_legacy.json', import.meta.url);
    writeFileSync(outPath, JSON.stringify(out) + '\n');
    console.log('Wrote skin_release_dates_legacy.json:', counts);
}

// Only run the network walk when executed directly, never when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
