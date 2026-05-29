// public/js/engine/damage/timeline.js
/**
 * Window roll-up. Model: a weapon is ready at t = initialDelay (default 0,
 * i.e. preloaded/ready at window start) and fires every reloadInterval; we
 * count every salvo whose fire-time ≤ window. This is the standard optimistic
 * DPS-estimate model; real preload varies (tune via initialDelay). Pure.
 */
export function countSalvos(reloadInterval, initialDelay, window) {
  if (reloadInterval <= 0 || window < initialDelay) return 0;
  return Math.floor((window - initialDelay) / reloadInterval) + 1;
}

export function rollUpWeapon(expectedSalvo, reloadInterval, { initialDelay = 0, window = 90 } = {}) {
  const salvoCount = countSalvos(reloadInterval, initialDelay, window);
  const total = expectedSalvo * salvoCount;
  const dps = window > 0 ? total / window : 0;
  return { salvoCount, reloadInterval, total, dps };
}
