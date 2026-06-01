/**
 * build-sim.probability.js
 * Pure probability math for the shipgirl build simulator — the numbers users trust.
 *
 * Extracted from shipgirl-build-sim.js so the formulas are unit-testable in isolation.
 * Everything here is pure: no DOM, no module state, no I/O. Inputs in, numbers out.
 * The pool/cost/rate CONSTANTS stay in shipgirl-build-sim.js (they're plain data and are
 * passed in as arguments where needed) — this module owns only the calculations.
 */

/**
 * Derive each pool's full probability table, adding N as the leftover so every pool
 * sums to 100%. Mirrors the game's "N is whatever's left" rule.
 * @param {Object<string, {UR:number,SSR:number,SR:number,R:number}>} base - pool → rarity %s (no N)
 * @returns {Object<string, {UR:number,SSR:number,SR:number,R:number,N:number}>}
 */
export function buildPoolProbabilities(base) {
    const out = {};
    for (const poolId of Object.keys(base)) {
        const baseProbs = base[poolId];
        const total = Object.values(baseProbs).reduce((sum, val) => sum + val, 0);
        out[poolId] = { ...baseProbs, N: Math.max(0, 100 - total) };
    }
    return out;
}

/**
 * Apply the despair-pool UR pickup boost: when a UR ship is hand-picked, its chance rises
 * to the pickup rate and N drops by the same amount so the table still sums to 100%.
 * Returns a fresh object (never mutates the input).
 * @param {{UR:number,SSR:number,SR:number,R:number,N:number}} baseProbs
 * @param {{UR:number}} despairRates - pickup rates (uses .UR)
 * @param {boolean} hasUR - whether a UR ship is selected in the despair pool
 * @returns {{UR:number,SSR:number,SR:number,R:number,N:number}} effective probabilities
 */
export function applyDespairUrPickup(baseProbs, despairRates, hasUR) {
    if (!hasUR) return { ...baseProbs };
    const urIncrease = despairRates.UR - baseProbs.UR;
    return {
        ...baseProbs,
        UR: despairRates.UR,
        N: Math.max(0, baseProbs.N - urIncrease),
    };
}

/**
 * Single-build chance (%) for one "regular" (non-pickup) ship of a rarity: the rarity's
 * leftover chance after pickup ships, split evenly among the regular ships.
 * @param {number} rarityProbPercent - the rarity's total chance (%)
 * @param {number} pickupTotal - summed pickup-ship chance (%) within that rarity
 * @param {number} regularShipsCount - number of non-pickup ships in that rarity
 * @returns {number} single-build chance (%) for one regular ship (0 if there are none)
 */
export function regularShipSingleProb(rarityProbPercent, pickupTotal, regularShipsCount) {
    const remaining = Math.max(0, rarityProbPercent - pickupTotal);
    return regularShipsCount > 0 ? remaining / regularShipsCount : 0;
}

/**
 * Cumulative chance (%) of at least one success across `builds` independent builds: 1-(1-p)^n.
 * @param {number} singleProbPercent - per-build chance (%)
 * @param {number} builds - number of builds
 * @returns {number} cumulative chance (%)
 */
export function cumulativeChance(singleProbPercent, builds) {
    return (1 - Math.pow(1 - (singleProbPercent / 100), builds)) * 100;
}

/**
 * Format a percent for display: drops float drift (28.7999… → 28.8) and trailing zeros
 * (2 → "2", 2.5 → "2.5", 1.20 → "1.2").
 * @param {number} p
 * @returns {string}
 */
export function formatPercent(p) {
    return Number(p.toFixed(2)).toString();
}
