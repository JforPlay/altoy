// public/js/engine/damage/salvo.js
/**
 * Per-salvo aggregation. One salvo = bulletsPerSalvo bullets, each an
 * expected landed hit scaled by hitRate. vs a single boss, pierce_count
 * is irrelevant (one target). Pure.
 */
export function computeSalvo(hitResult, bulletsPerSalvo) {
  const expectedSalvo = hitResult.expectedHit * bulletsPerSalvo * hitResult.hitRate;
  return { expectedSalvo, bulletsPerSalvo, hitRate: hitResult.hitRate, perHit: hitResult };
}
