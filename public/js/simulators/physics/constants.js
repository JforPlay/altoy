/**
 * physics/constants.js
 * BattleConfig physics constants, ported verbatim from the game Lua
 * (AzurLaneLuaScripts/KR/mod/battle/data/battleconfig.lua and battleformulas.lua).
 */

// Fixed simulation rate. The game runs every Update at exactly this rate;
// the simulator's World.step() advances one of these ticks.
export const VIEW_FPS = 30;                  // battleconfig.lua:5
export const TICK_SECONDS = 1 / 30;          // battleconfig.lua:7 (calcInterval)

// Bullet speed conversion factor: SECONDs / viewFPS * BulletSpeedConvertConst
//   = 60 / 30 * 0.1 = 0.2   (battleformulas.lua:9)
export const BULLET_SPEED_CONVERT = 0.2;

export const GRAVITY = -0.05;                // battleconfig.lua:167
export const BOMB_DETONATE_HEIGHT = 1.2;     // battleconfig.lua:84
export const AIRCRAFT_HEIGHT = 10;           // battleconfig.lua:86
export const ACC_INTERVAL = 1 / 30;          // battlebulletunit.lua:14
export const BULLET_SPLIT_SHIFT_DELAY = 0.2; // battleconfig.lua:27

// Tracker turn deadzone — cos(10 degrees) (battlebulletunit.lua:15).
export const TRACKER_ANGLE = Math.cos((10 * Math.PI) / 180);
