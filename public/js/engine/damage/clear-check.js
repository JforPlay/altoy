// public/js/engine/damage/clear-check.js
/**
 * Boss clear-check: given fleet DPS, boss HP, and a battle time limit, estimate
 * time-to-kill and whether the fleet kills the boss in time. Pure — no wall-clock,
 * no DOM. Mirrors the sim's optimistic sustained-DPS model (no HP-phase mechanics).
 */
export function computeClearCheck({ fleetDps, bossHp, timeLimit }) {
  const dps = Number(fleetDps) || 0;
  const hp = Number(bossHp) || 0;
  const limit = Number(timeLimit) || 0;
  if (dps <= 0 || hp <= 0) {
    return { ttkSeconds: Infinity, clears: false, hpRemaining: hp };
  }
  const ttkSeconds = hp / dps;
  const hpRemaining = Math.max(0, hp - dps * limit);
  return { ttkSeconds, clears: ttkSeconds <= limit, hpRemaining };
}
