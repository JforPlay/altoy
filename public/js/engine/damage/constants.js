// public/js/engine/damage/constants.js
/**
 * Damage-engine constants — faithful to Azur Lane KR Lua.
 * Sources: battlestate.lua, battleconfig.lua, battleconst.lua, battleformulas.lua.
 */

// Crit (battlestate.lua:5-6)
export const DFT_CRIT_RATE = 0.05;
export const DFT_CRIT_EFFECT = 1.5;

// Reload (battleconfig.lua:16-19) — identical to fleet-sim.calc.js RELOAD_K*
export const RELOAD_K1 = 6;
export const RELOAD_K2 = 100;
export const RELOAD_K3 = 3.14;
export const AIR_ASSIST_RELOAD_RATIO = 2.2; // AIR_ASSIST_RELOAD_RATIO=220 × PERCENT

// Fleet-sim battle clock: the timer starts before anything can fire (approach +
// intro). Everything after this is firing time, so the usable window is the
// fight's time limit minus this.
export const BATTLE_START_DELAY = 2;

// Damage scalars
export const AIR_MIT_CONST = 150;      // DRATE[7]: air mitigation 150/(AA+150)
export const BASE_ARP = 0.1;           // battleconfig.lua:393 — 항공 저항 관통, added to the term above
export const LVL_ADV_CAP = 25;         // DRATE[1]
export const LVL_ADV_FACTOR = 0.02;    // DRATE[2]
export const RANDOM_DAMAGE_EV = 1;     // E[random(0..2)] = 1 (battleconfig.lua:20-21)
export const PERCENT = 0.01;           // corrected % → fraction
export const RATIO_PERCENT = 0.0001;   // attack_attribute_ratio → fraction (PERCENT2)

// Hit / crit (battlestate.lua ACCURACY/DRATE)
export const HIT_FLOOR = 0.1;          // ACCURACY[1]
export const HIT_DENOM_PAD = 2;        // ACCURACY[2]
export const CRIT_DENOM_PAD = 2000;    // DRATE[4]
export const LUCK_HIT_FACTOR = 0.001;  // PERCENT1
export const LUCK_CRIT_FACTOR = 0.0002;// DRATE[3]

// WeaponDamageAttr (battleconst.lua:181-187)
export const WEAPON_ATTR = { CANNON: 1, TORPEDO: 2, ANTI_AIR: 3, AIR: 4, ANTI_SUB: 5 };
// attack_attribute number → engine attribute key (offensive only; 3/5 excluded)
export const ATTR_TO_KEY = { 1: 'cannon', 2: 'torpedo', 4: 'air' };
