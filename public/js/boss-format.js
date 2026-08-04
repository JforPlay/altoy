/**
 * boss-format.js
 * Pure formatting helpers for /map/boss-viewer.
 *
 * No DOM, no fetch, no mutation — node-importable so tests/boss/boss-format.test.mjs
 * covers it directly. Everything that renders a boss goes through here so the grid,
 * the detail drawer and the map-viewer crosslink card can't drift apart.
 */
import { DATA_FOR_TOY_BASE } from './utils.js';

/** enemy_data_statistics.armor_type */
export const ARMOR_LABELS = { 1: '경장갑', 2: '중형장갑', 3: '중장갑' };

/** boss_data.json `src` — the eight groups the processor emits. */
export const SRC_LABELS = {
    main: '일반해역',
    hard: '하드',
    event: '이벤트',
    archive: '기록',
    meta: 'META',
    challenge: '한계 챌린지',
    guild: '대형작전',
    siren: '세이렌',
};

/** enemy_data_by_type.type_name (1–25). The boss data uses 16 of these. */
export const TYPE_LABELS = {
    1: '구축', 2: '경순', 3: '중순', 4: '순양전함', 5: '전함',
    6: '경항모', 7: '항모', 8: '잠수', 9: '항순', 10: '항전',
    11: '뇌순', 12: '공작', 13: '모니터', 14: '어뢰정', 15: '수송함',
    16: '자폭선', 17: '기함', 18: '초갑순양함', 19: '운송함', 20: '미구',
    21: '미구', 22: '범선', 23: '범선', 24: '범선', 25: '알 수 없음',
};

/**
 * Portrait URL for an identity.
 *
 * 241 of 379 identities are shipgirl-derived and carry `sid`, so they reuse the
 * skin_qicon asset that is already published — no extra extraction. The rest are
 * siren/unnamed enemies published under boss_qicon, keyed by the raw enemy icon
 * name. `IMG_FALLBACKS` covers a miss on either path.
 */
export function bossPortraitUrl(identity) {
    if (!identity) return '';
    return identity.sid
        ? `${DATA_FOR_TOY_BASE}/skin_qicon/${identity.sid}.webp`
        : `${DATA_FOR_TOY_BASE}/boss_qicon/${identity.icon}.webp`;
}

/**
 * Second URL to try when the primary 404s, for the `data-fallback` attribute the
 * utils.js img-error handler consumes (it runs before `data-onfail`, so a miss
 * on both still hides the image).
 *
 * A skin id is not proof the asset was published: 프로토콜 워페어 "포트리스"
 * resolves to skin 900405, which skin_qicon does not carry — its portrait only
 * exists under boss_qicon. Rather than special-case that one boss, every
 * sid-backed identity falls back to its icon-keyed file, so a future gap in the
 * skin pipeline degrades to the right picture instead of a placeholder.
 * Returns '' when boss_qicon is already the primary — nothing left to try.
 */
export function bossPortraitFallbackUrl(identity) {
    if (!identity?.sid || !identity.icon) return '';
    return `${DATA_FOR_TOY_BASE}/boss_qicon/${identity.icon}.webp`;
}

/** `data-fallback="…"` attribute for an identity, or '' when there is no second URL. */
export function bossPortraitFallbackAttr(identity, escape) {
    const url = bossPortraitFallbackUrl(identity);
    return url ? ` data-fallback="${escape(url)}"` : '';
}

/**
 * Armor type for one appearance. The processor hoists the dominant value onto the
 * identity and emits a per-appearance `armor` only where it disagrees (measured:
 * exactly one identity), so the override always wins when present.
 */
export function appearanceArmor(app, identity) {
    return app?.armor ?? identity?.armor ?? 1;
}

/**
 * Whether an appearance's stat block means anything. Operation Siren enemies are
 * scaled at runtime by world_enhancement — raw config reads hp=240 for a boss with
 * a real ~1.9M — so the processor emits no stats for them and flags them `scaled`.
 */
export function isStatsUsable(app) {
    return !app?.scaled;
}

/** Display order of the source groups — the same order the filter chips use. */
const SRC_ORDER = Object.keys(SRC_LABELS);
const srcRank = (src) => {
    const i = SRC_ORDER.indexOf(src);
    return i < 0 ? SRC_ORDER.length : i;
};

/**
 * Digit-aware collation. Plain localeCompare orders labels as text, so it put
 * META "T10" before "T2" and stage "15–4" before "5–4"; `numeric` compares the
 * digit runs as numbers instead.
 */
const natural = new Intl.Collator('ko', { numeric: true });

/**
 * Group by source (chip order), then hardest/newest first inside each group:
 * event name → level → stage label, all descending. Returns a new array.
 */
export function sortAppearances(apps) {
    return [...(apps || [])].sort((a, b) =>
        srcRank(a.src) - srcRank(b.src)
        || natural.compare(b.ev || '', a.ev || '')
        || (b.lv || 0) - (a.lv || 0)
        || natural.compare(String(b.where), String(a.where))
    );
}

/**
 * Detail-drawer sections: one per source in chip order, each carrying that
 * source's appearance rows *and* its skill text, so the drawer prints one group
 * heading instead of repeating the source badge on all 19 rows.
 *
 * Skills describe a specific fight, not the boss as a whole — 헬레나 holds a
 * separate META set and 한계 챌린지 set, and 12 of the 23 META bosses also have
 * plain 일반해역/기록 rows the META mechanics don't apply to — so they belong
 * inside their own source's section rather than in one list above everything.
 *
 * A source with skills but no appearances still gets a section. None exists
 * today (all 37 skill sources have matching rows), but a future family must
 * surface rather than silently drop its text.
 */
export function groupDetail(apps, skills) {
    const groups = [];
    const bySrc = new Map();
    const section = (src) => {
        let g = bySrc.get(src);
        if (!g) {
            g = { src, rows: [], skills: [] };
            bySrc.set(src, g);
            groups.push(g);
        }
        return g;
    };
    for (const app of sortAppearances(apps)) section(app.src).rows.push(app);
    for (const s of skills || []) section(s.src).skills.push(s);
    return groups.sort((a, b) => srcRank(a.src) - srcRank(b.src));
}

/** `<color=…>` spans in the game's skill text, and the only markup it uses. */
const COLOR_TAG = /<color=[^>]*>([\s\S]*?)<\/color>/g;

/**
 * Skill description split into `{ text, em }` segments for safe rendering.
 *
 * The game wraps its key numbers in `<color=#92fc63>`, and that one hex is the
 * only colour across all 82 descriptions — it means "emphasis", not a palette
 * choice. So the value is discarded and the segment is merely flagged, letting
 * the sheet use a theme token that works in both light and dark. It also keeps
 * upstream text out of a style attribute entirely.
 *
 * Callers must still escape `text`; this splits, it does not sanitise.
 */
export function parseSkillText(text) {
    const src = String(text ?? '');
    const out = [];
    let last = 0;
    COLOR_TAG.lastIndex = 0;
    for (let m = COLOR_TAG.exec(src); m; m = COLOR_TAG.exec(src)) {
        if (m.index > last) out.push({ text: src.slice(last, m.index), em: false });
        if (m[1]) out.push({ text: m[1], em: true });
        last = m.index + m[0].length;
    }
    if (last < src.length) out.push({ text: src.slice(last), em: false });
    return out;
}
