/**
 * expression-face.js
 * Shared, game-faithful resolution of WHICH expression face to composite onto an
 * extracted painting, given a `expression_manifest.json` entry. The extracted base
 * (output_expressions/<id>/painting.png) always has a transparent face hole, so every
 * consumer must pick a face to fill it — this is the single source of truth for that
 * choice, used by the story viewer (per-line expressions) and the skin pages
 * (list-viewer lightbox + detail viewer default art).
 *
 * Pure and dependency-free on purpose: no imports, no DOM, node-testable.
 */

/**
 * Face-id candidates for a painting, in game-priority order:
 *   1. the step's expression — sprite name == script value, 1:1, no
 *      remapping (dialoguestoryplayer.lua :866 uses the raw value as the
 *      paintingface atlas sprite name). Pass null/undefined for the
 *      no-expression case (default art) to skip this.
 *   2. the manifest's `default` — ship_skin_expression[painting].default,
 *      the game's no-expression face (baked into the manifest by the
 *      pipeline's enrich_expression_manifest.py; present for ~190 entries).
 *   3. '0', then the numerically smallest face — web-only fallback. The
 *      game HIDES the face layer when a step has no expression and the
 *      painting has no config default (the in-game base has the face
 *      baked in), but every EXTRACTED base has the face region cut out
 *      (verified: alpha=0 across the face box even for paintings whose
 *      in-game base is complete), so the viewer must always composite
 *      something; the lowest face id is the most neutral stand-in.
 * Candidates are filtered to faces that actually exist in the manifest,
 * so no fetch is wasted on known-missing face files. Pure — node-testable.
 * @param {{faces?:string[], default?:string}} expressionData - a manifest entry
 * @param {string|number|null|undefined} expression - the step's expression, or null for default art
 * @returns {string[]} ordered face-id candidates to try (may be empty)
 */
export function pickFaceCandidates(expressionData, expression) {
    const faces = (expressionData?.faces || []).map(String);
    if (!faces.length) return [];

    const chain = [];
    if (expression !== undefined && expression !== null) chain.push(String(expression));
    if (typeof expressionData.default === 'string' && expressionData.default !== '') {
        chain.push(expressionData.default);
    }
    chain.push('0');
    const numeric = faces
        .filter(f => !Number.isNaN(Number(f)))
        .sort((x, y) => Number(x) - Number(y));
    if (numeric.length) chain.push(numeric[0]);

    const seen = new Set();
    const out = [];
    for (const c of chain) {
        if (faces.includes(c) && !seen.has(c)) {
            seen.add(c);
            out.push(c);
        }
    }
    // Last resort (e.g. all-non-numeric face names): first listed face.
    if (!out.length) out.push(faces[0]);
    return out;
}
