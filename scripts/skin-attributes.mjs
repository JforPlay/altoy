/**
 * skin-attributes.mjs
 * The v1 스킨 특성 vocabulary — the single source of truth both the vision
 * labeler (which derives its output JSON schema from it) and the sheet sync
 * (which derives its validator from it) read, so the two cannot drift.
 *
 * JSON keys are English; values and sheet headers are the Korean the curators
 * actually type. Spec: dev/active/2026-07-26-skin-attribute-db-design.md
 */

/** The 클뜯 id column in the sheet's 라벨 tab — the join key. */
export const ID_HEADER = '클뜯 id';

/** The human-confirmation checkbox column. */
export const CHECKED_HEADER = '검수';

/**
 * One entry per attribute. ARRAY ORDER IS THE CSV COLUMN ORDER and therefore a
 * contract with the sheet's formulas — append only, never reorder or remove.
 *
 * `multi: true` means the sheet cell holds a comma-joined list (the convention
 * 스킨 태그 already uses in this dataset).
 */
export const ATTRIBUTES = [
    {
        key: 'eyewear', header: '아이웨어', multi: false,
        values: ['없음', '안경', '선글라스', '고글', '안대'],
    },
    {
        key: 'posture', header: '자세', multi: false,
        values: ['서기', '엎드리기', '눕기', '앉기·무릎꿇기', '거꾸로', '기타'],
    },
    {
        // Which side of the body faces the viewer. Deliberately a separate axis
        // from `posture`: two small enums beat one 12-way, and "every 뒷모습"
        // then filters across all postures.
        key: 'facing', header: '방향', multi: false,
        values: ['정면', '후면'],
    },
    {
        // A FRAMING axis, not a body position — 발 강조 must be able to coexist
        // with 정면 서기, which a single combined enum would forbid.
        key: 'emphasis', header: '강조부위', multi: false,
        values: ['없음', '다리·발', '가슴', '엉덩이', '얼굴 클로즈업'],
    },
    {
        // Always the DOMINANT colour. A "다중색" bucket here would be a pattern
        // wearing a colour's clothes and would silently break the obvious query:
        // silver hair with pink tips must still match 은발. The pattern lives in
        // hairMultiTone and the two compose.
        key: 'hairColor', header: '머리색', multi: false,
        values: ['금발', '갈색', '흑발', '은발·백발', '적발', '청발', '녹발', '분홍', '보라', '회색'],
    },
    {
        key: 'hairMultiTone', header: '머리 다중색', multi: false,
        values: ['단색', '브릿지', '그라데이션', '투톤', '기타'],
    },
    {
        // 오드아이 deliberately stays a VALUE here rather than splitting the way
        // hairColor did: heterochromia is rare, and unlike hair there is no
        // meaningful "dominant" eye colour to fall back to.
        key: 'eyeColor', header: '눈색', multi: false,
        values: ['금색', '갈색', '흑색', '은색·회색', '적색', '청색', '녹색', '분홍', '보라', '오드아이'],
    },
    {
        key: 'beastFeatures', header: '수인특징', multi: true,
        values: ['없음', '동물귀', '꼬리', '뿔', '날개', '후광'],
    },
];

/**
 * Attributes that describe the CHARACTER rather than the skin, so every skin of
 * one shipgirl should agree. The sync cross-checks these across each gid group
 * and reports disagreements — free QC with no extra model calls.
 */
export const CHARACTER_TRAIT_KEYS = ['hairColor', 'hairMultiTone', 'eyeColor', 'beastFeatures'];

/** Sentinel meaning "positively determined to have none of this attribute". */
const NONE = '없음';

/**
 * Parse one sheet cell into its stored value.
 *
 * A BLANK cell and `없음` are different states: blank means nobody (model or
 * human) has determined it and maps to null; `없음` is a positive "this skin has
 * none". Multi cells split on ',' and trim — NOT on the literal ', ' — so a
 * curator typing `동물귀,꼬리` is not a validation failure.
 *
 * @param {{key:string, header:string, multi:boolean, values:string[]}} attr
 * @param {string|undefined} raw
 * @returns {{value: string|string[]|null, error: string|null}}
 */
export function parseAttributeCell(attr, raw) {
    const text = String(raw ?? '').replace(/\r\n?/g, '\n').trim();
    if (!text) return { value: null, error: null };

    if (!attr.multi) {
        if (!attr.values.includes(text)) {
            return { value: null, error: `${attr.header}: "${text}" is not one of ${attr.values.join(' / ')}` };
        }
        return { value: text, error: null };
    }

    const parts = [];
    for (const part of text.split(',').map((p) => p.trim()).filter(Boolean)) {
        if (!attr.values.includes(part)) {
            return { value: null, error: `${attr.header}: "${part}" is not one of ${attr.values.join(' / ')}` };
        }
        if (!parts.includes(part)) parts.push(part);
    }
    if (!parts.length) return { value: null, error: null };
    if (parts.includes(NONE) && parts.length > 1) {
        return { value: null, error: `${attr.header}: "${NONE}" is exclusive — got "${parts.join(', ')}"` };
    }
    return { value: parts, error: null };
}

/**
 * JSON Schema for the vision model's structured output, derived from ATTRIBUTES
 * so the model can never emit a value the sync would then reject.
 *
 * Every attribute is `anyOf [<enum>, null]` — an abstaining model is worth far
 * more than a guessing one, and nulls become the review worklist. `anyOf` rather
 * than a union `type` array because that is what structured outputs support.
 * @returns {object}
 */
export function buildLabelSchema() {
    const properties = {};
    for (const attr of ATTRIBUTES) {
        properties[attr.key] = {
            anyOf: [
                attr.multi
                    ? { type: 'array', items: { type: 'string', enum: attr.values } }
                    : { type: 'string', enum: attr.values },
                { type: 'null' },
            ],
        };
    }
    return {
        type: 'object',
        properties,
        required: ATTRIBUTES.map((a) => a.key),
        additionalProperties: false,
    };
}
