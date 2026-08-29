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

/**
 * Salvos when the weapon starts the battle reloading rather than ready.
 *
 * `coolStart` is that opening cooldown — battleweaponunit.lua InitialCD does
 * `AddCDTimer(GetReloadTime())`, the RAW reload with no salvo-firing time, so the
 * first shot lands one reload in and every later one a full cycle apart.
 *
 * `preloadShare` is the fraction of the weapon's mounts that skip it:
 * battleplayerunit.lua setWeapon flags the first `preload_count[slot]` of the
 * slot's `base_list[slot]` instances with SetModifyInitialCD. The split is
 * usually partial — 427 ships carry preload_count [0,1,0] against 2 torpedo
 * mounts — so one mount opens at t=0 and the other a reload later. Those two
 * groups drift apart over the window; this returns their MEAN salvo count, which
 * is exact for expected damage and can legitimately be fractional.
 */
export function countSalvosWithPreload(reloadInterval, initialDelay, coolStart, window, preloadShare = 0) {
  const ready = countSalvos(reloadInterval, initialDelay, window);
  if (!(coolStart > 0) || preloadShare >= 1) return ready;
  const late = countSalvos(reloadInterval, initialDelay + coolStart, window);
  return preloadShare > 0 ? preloadShare * ready + (1 - preloadShare) * late : late;
}

export function rollUpWeapon(expectedSalvo, reloadInterval, { initialDelay = 0, window = 90, coolStart = 0, preloadShare = 0 } = {}) {
  const salvoCount = countSalvosWithPreload(reloadInterval, initialDelay, coolStart, window, preloadShare);
  const total = expectedSalvo * salvoCount;
  const dps = window > 0 ? total / window : 0;
  return { salvoCount, reloadInterval, total, dps };
}
