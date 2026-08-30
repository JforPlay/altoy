// tests/simulators/fleet-sim-barrage-text-gate.test.mjs
/**
 * The KR-text validation gate, ported from WSL `fleet_sim_barrage_process.py`
 * (lines ~828-1108) to score the SIMULATOR's output instead of the old extractor's
 * records.
 *
 * The KR description states the cadence in prose and we already ship it, so it is a
 * free oracle over the whole table — and the only thing that catches a
 * systematically wrong reading of the buff graph. The parser's governing rule is the
 * extractor's: emit nothing rather than a guess. A phrasing it declines is a skipped
 * check; a phrasing it mis-reads is a false alarm that costs a human a look and,
 * worse, teaches the next reader to ignore the gate.
 *
 * WHAT CHANGED, AND WHY IT IS AN IMPROVEMENT. The Python gate scored one record's
 * `{k, n, d}` triple per skill. There are no records any more: the simulator emits
 * ROWS, and one skill can emit several. Scoring rows is strictly stronger, because a
 * skill's text usually states several cadences and the old gate could only ever
 * answer one of them. 워싱턴 11000's text states both 「20초마다」 and 「10초 및
 * 이후 20초마다」; the old record had to satisfy both claims with one number, while
 * each row now has its own claim to answer and both are checked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runBattleSim } from '../../public/js/engine/damage/battle-sim.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const graph = read('../../public/data/sim/fleet_sim_graph.json');
const names = read('../../public/data/sim/skill_data_template.json');
const ships = read('../../public/data/ship_info_data.json');

// ---------------------------------------------------------------------------
// The parser (ported verbatim in behaviour from the Python)
// ---------------------------------------------------------------------------

const RE_PLACEHOLDER = /\$(\d+)/g;
// The lookbehind is a FIX to the Python original, not a port artefact: `(\d+)초`
// happily matches the `5` inside `0.5초마다` and fabricates a 5 s cadence out of a
// half-second one. Measured over all 3113 described skills, exactly three claims
// change and every one is a fabrication removed — 18950 [5]->[], 151550 [5]->[], and
// 801570 [15,5]->[15], which keeps its real 15 s and drops a 5 borrowed from a
// `0.5초마다` elsewhere in its text. No correct claim is lost, so this cannot inflate
// a score; it can only stop the gate asking for a number the game never states.
const RE_PERIOD = /(?:매[\s ]*)?(?<![\d.])(\d+)[\s ]*초[\s ]*(?:마다|만다)/g;
// `N회` alone is NOT a threshold — "탄막을 1회 발사한다" is a volley size and
// "최대 4회 중첩" a stack cap. A threshold always closes with `…마다` or a bare
// `…시` ("주포 15회 발사 시, 특수 탄막을 발사한다"), and the bridge between the
// number and that ending may not cross a clause break (`,` `.`) nor a digit or
// `초` (which would let it borrow the `마다` of a neighbouring `N초마다` clause).
//
// `번` counts the same thing as `회` and 4 skills use it ("특수 부포를 5번 발사할
// 때마다"). Reading only `회` was a silent decline, not an honest one: 19550 escaped
// triage entirely because of its phrasing.
//
// `중첩` is excluded because a stack ladder is not a firing threshold: 12090's
// "효과가 3번 중첩될 때 마다 특수 탄막을 발사" counts buff stacks that accrue every 8s,
// and its record's 24s period is those three stacks — right, and flagged wrong the
// moment `번` was admitted without this guard.
const RE_COUNT = new RegExp(
  '(\\d+)[\\s\\u00a0]*[회번](?![\\s\\u00a0]*중첩)[^,.\\n초\\d]{0,8}?마다'
  + '|(\\d+)[\\s\\u00a0]*[회번][\\s\\u00a0]*(?:발사|공격|사격|타격)[\\s\\u00a0]*시(?=[\\s\\u00a0,]|$)', 'g');
// A conditional variant states its own threshold as a reduction rather than a
// cadence ("발동에 필요한 주포 공격 횟수 6회로 감소"), and it is that variant the
// config casts under its own skill id — 트렌토 25213 / 스킬라 29982.
const RE_COUNT_MOD = /횟수[\s ]*(\d+)[\s ]*회?[\s ]*(?:로|으로)[\s ]*(?:감소|증가)/g;
const RE_OPENING = /(?:전투[\s ]*(?:개시|시작|진입)|정찰[\s ]*완료)[\s ]*(?:후[\s ]*)?(\d+)[\s ]*초[\s ]*(?:후|뒤)/g;
// A numberless cadence: the barrage rides every salvo / every air strike. It
// corroborates the record's KIND and nothing else — the cooldown a `fire` record
// carries is never in the text — so these do not join the cadence set, where they
// would accept a timer record that happens to sit beside an on-fire clause.
// No digits in the gap: "주포 15회 발사 시" is a THRESHOLD, not an every-salvo
// trigger, and reading it as one turned ~30 전탄 발사 records into false alarms.
// `완료` is in the verb set because 장전 완료 and 발사 are the same event in auto
// battle — 괴츠 152330 is "자신의 주포 공격 장전 완료 시", and the engine agrees
// (`onChargeWeaponReady` and `onChargeWeaponFire` share a FIRE_CLASS_SLOTS entry).
const RE_ON_FIRE = /(?:주포|부포|어뢰|뇌격)[^,.\n\d]{0,12}?(?:공격|발사|발동|사격|완료)[\s ]*시(?!마다)/;
const RE_ON_AIR = /(?:항공[\s ]*공격|공중[\s ]*지원|항공[\s ]*지원)[^,.\n\d]{0,8}?시(?!마다)/;
const ANY = '*'; // cadence-set entry meaning "this kind, any number"
// A period only counts as the barrage's when the clause it heads is about firing
// something. Skill text covers the whole kit, so the nearest `N초마다` is as
// often a stat buff (12090: "8초마다 포격 상승"), a damage-over-time tick (150890:
// "2초마다 1씩 피해") or a rate cap (16020: "18초마다 최대 1회만 발동 가능") as it is
// the barrage — and every one of those read as a cadence is a false alarm.
const RE_FIRING_CLAUSE = /(탄막|공격|발사|사격|전개|발동|어뢰|폭격|소환|살포|부설|실시|정찰|스캔|사용|시전)/;
const RE_RATE_CAP = /^[\s ]*(?:최대[\s ]*)?\d+[\s ]*회만/;

/**
 * The KR `desc` with its `$N` level placeholders substituted.
 *
 * A period is often written `$1초마다` — the literal lives in `desc_add[N-1]`, one
 * row per level as `[value, delta]`, so max level is the last row (D5). Values that
 * are not a bare integer ("8.0%", "Lv.10") resolve to `?`, which no cadence regex
 * can match. Leaving the raw `$1` in place instead would let `RE_PERIOD` read the
 * placeholder's own index as the period.
 */
function resolveDesc(entry) {
  const desc = (entry && entry.desc) || '';
  const add = (entry && entry.desc_add) || [];
  return desc.replace(RE_PLACEHOLDER, (_m, d) => {
    const i = Number(d) - 1;
    const tbl = i < add.length && Array.isArray(add[i]) ? add[i] : null;
    const last = tbl && tbl.length ? tbl[tbl.length - 1] : null;
    const v = Array.isArray(last) && last.length ? last[0] : null;
    return typeof v === 'string' && /^\d+$/.test(v) ? v : '?';
  });
}

/**
 * True when the clause this `N초마다` heads is about firing something.
 *
 * Scoped to the rest of the SENTENCE rather than a character count: the verb can sit
 * anywhere in it ("12초마다 내구가 가장 낮은 적에게 … 특수 공격을 실시한다") and a
 * fixed window either cuts that off or reaches into the next clause.
 */
function statesFiring(line, m) {
  const tail = line.slice(m.index + m[0].length).split('.')[0];
  return RE_FIRING_CLAUSE.test(tail) && !RE_RATE_CAP.test(tail);
}

/**
 * Every cadence the KR text states, as a `{"kind|n"}` set, plus the opening delays it
 * states as a separate set. Empty sets mean the text says nothing the parser is
 * willing to read.
 *
 * A SET, not one value, because a skill description covers the whole kit: 17630 names
 * a 20s buff cycle and a 10s barrage, 14930 a 20s barrage and a 5-hit firepower stack.
 * Which clause belongs to the barrage is exactly what the text does not say, so
 * scoring against the leftmost match would fail records that are right. The number the
 * row carries still has to be one the text states somewhere — nothing here comes from
 * the sim, so a row whose cadence appears nowhere in its own description is still
 * caught.
 *
 * Openings are collected only from lines that also state a period. A skill's later
 * paragraphs describe other effects with their own delays, and comparing `d` against
 * those flags a row that is right: 요크타운II 16220 fires its own barrage every 18s
 * (line 2) while line 3's "전투 개시 20초 후" belongs to the support barrage it lends
 * to a DIFFERENT fleet.
 */
function expectedFromText(entry) {
  const txt = resolveDesc(entry);
  const cadences = new Set();
  for (const m of txt.matchAll(RE_COUNT)) cadences.add(`count|${Number(m[1] ?? m[2])}`);
  for (const m of txt.matchAll(RE_COUNT_MOD)) cadences.add(`count|${Number(m[1])}`);
  if (RE_ON_FIRE.test(txt)) cadences.add(`fire|${ANY}`);
  if (RE_ON_AIR.test(txt)) cadences.add(`air|${ANY}`);
  const openings = new Set();
  for (const line of txt.split('\n')) {
    const periods = new Set();
    for (const m of line.matchAll(RE_PERIOD)) if (statesFiring(line, m)) periods.add(Number(m[1]));
    for (const n of periods) cadences.add(`timer|${n}`);
    if (periods.size) for (const m of line.matchAll(RE_OPENING)) openings.add(Number(m[1]));
  }
  return { cadences, openings };
}

// ---------------------------------------------------------------------------
// The sim's rows, as the {k, n, d} triples the KR text is scored against
// ---------------------------------------------------------------------------

/**
 * A sim row as the {k, n, d} triple the KR text is scored against.
 *
 * The kinds are the old extractor's, so the prose is scored against exactly the
 * vocabulary it was scored against before: `count` (주포 N회마다), `fire` (발사 시),
 * `air` (항공 공격 시), `timer` (N초마다) and `once` (a one-shot with no recurrence).
 *
 * ONE DEVIATION from the brief's snippet, and it is a fix to this file rather than a
 * relaxation: the once/timer split on an attach-side row reads the row's own `period`,
 * not `activations > 1.5`. An activation COUNT is not a cadence claim — 민스크 4081's
 * recurrence is `buff_4082 (time:15) -> onAttach cast, rant:3000`, i.e. a genuine
 * 「이후 15초마다 30% 확률로」 that lands 5 × 0.3 = 1.5 activations in a 78 s window
 * and so read as a one-shot with the period 15 the prose states sitting right on it.
 * Same shape on 101070/101090/101110/101130 (넵튠 4인방), 801430, 800050 and 1090400.
 * A row whose `period` is 0 states no cadence, and that is exactly what `once` means.
 */
const FIRE_TRIGGERS = new Set(['onFire', 'onChargeWeaponFire', 'onTorpedoWeaponFire',
  'onWeaponSteday', 'onChargeWeaponReady']);
const AIR_TRIGGERS = new Set(['onAllInStrike', 'onAllInStrikeSteady', 'onAirAssistReady']);

function rowCadence(row) {
  if (row.trigger === 'onBattleBuffCount') return { k: 'count', n: row.countTarget, d: row.first };
  if (FIRE_TRIGGERS.has(row.trigger)) return { k: 'fire', n: row.period, d: row.first };
  if (AIR_TRIGGERS.has(row.trigger)) return { k: 'air', n: row.period, d: row.first };
  if (row.trigger === 'onStartGame' || row.trigger === 'onAttach') {
    return { k: row.period > 0 ? 'timer' : 'once', n: row.period, d: row.first };
  }
  return { k: 'timer', n: row.period, d: row.first };
}

/**
 * The nominal loadout the corpus is simulated under: a 78 s window (a META 80 s limit
 * minus the 2 s approach), a main gun on slot 1 firing every 3 s, a torpedo mount on
 * slot 2 and an airstrike, so a barrage of every trigger class has an occasion to
 * fire. One event per volley carrying every name that volley raises — an edge listing
 * two of them must fire once, not once per name.
 *
 * `spEquipped` is on for BOTH corpora, not just the 전용 장비 one: it is a real build,
 * a `check_spweapon` gate is the config's own statement that the skill exists only
 * with the weapon fitted, and switching it off would silently drop those rows out of
 * the gate's coverage rather than check them.
 */
function ctx() {
  const window = 78;
  const events = [];
  for (let t = 3; t <= window; t += 3) {
    events.push({ t, names: ['onFire', 'onChargeWeaponFire', 'onChargeWeaponReady', 'onWeaponSteday'],
      slot: 1, attr: 'cannon' });
  }
  for (let t = 20; t <= window; t += 20) {
    events.push({ t, names: ['onFire', 'onTorpedoWeaponFire', 'onWeaponSteday'], slot: 2, attr: 'torpedo' });
  }
  for (let t = 12; t <= window; t += 12) {
    events.push({ t, names: ['onAllInStrike', 'onAllInStrikeSteady', 'onAirAssistReady'], slot: 1, attr: 'air' });
  }
  return { window, events,
    unit: { equipTypes: [1, 6, 8], nationality: 3, shipType: 4, spEquipped: true, allyCount: 6, tags: [] } };
}

const SIM_CTX = ctx();

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Tolerance on a period. The old records carried the config integer; a row carries a
 * measured or config float on a 1/30 s clock, so an exact set membership test would
 * fail on 19.999999999. COUNT thresholds stay EXACT — `countTarget` is an integer
 * straight out of the config, and an off-by-one threshold is a real disagreement.
 */
const TOL = 0.35;

const numberMatches = (numeric, kinds, n) => {
  if (n == null) return false;
  for (const [k, v] of numeric) {
    if (!kinds.has(k)) continue;
    if (k === 'count' ? v === n : Math.abs(v - n) <= TOL) return true;
  }
  return false;
};

/**
 * (agree, checked, disagree, skipped, kindOnly) for D4's gate.
 *
 * THE UNIT IS THE SKILL, and that is the Python's unit, not a relaxation of it. The
 * old gate scored one record per skill because the extractor emitted one; the sim
 * emits every firing occasion it finds, and a skill's prose does NOT enumerate them
 * all — 엘리제 106490 names her 10 s barrage and says nothing about the 3-volley
 * 0.5 s burst her `buff_106496` also fires, 루루티에 103060 says 「22초마다 … 전개될
 * 때마다 강화」 for what the config ships as three escalating weapons at 22/44/66 s.
 * Scoring each occasion against the whole description therefore asks the prose a
 * question it never answers, which is the very trap the Python's own comment names:
 * "Which clause belongs to the barrage is exactly what the text does not say".
 *
 * So the assertion is the one the corpus can actually support: FOR EVERY SKILL WHOSE
 * PROSE STATES A CADENCE, THE SIMULATOR PRODUCES THAT CADENCE. A skill fails when
 * none of its claims answers anything the prose says — which is exactly the failure a
 * mis-read of the buff graph produces, since a wrong reading would not contain the
 * stated number at all.
 *
 * `kindOnly` counts the passes where the text corroborated the claim's KIND but stated
 * no number to compare — weaker evidence than the rest, and worth printing apart so a
 * healthy-looking percentage cannot hide behind them.
 *
 * `d` is compared as hard as `{k, n}` is: a wrong opening delay shifts every
 * activation in the battle window and at short windows zeroes a barrage out entirely,
 * and three such defects were found by hand before this gate existed. It is compared
 * only when the text states an opening AND the claim's own number is the one the text
 * stated — the absence of an opening clause is not a claim that the first cast is at
 * t=0 (with no `initialCD` the engine waits one full cooldown, so `d = n` is the
 * correct silent case), and a claim that agreed by kind alone matched a different
 * clause, whose opening is not its own.
 */
function checkAgainstText(claims, corrections) {
  let agree = 0; let checked = 0; let skipped = 0; let kindOnly = 0;
  const disagree = [];
  const bySkill = new Map();
  for (const c of claims) {
    const g = bySkill.get(c.sid);
    if (g) g.push(c); else bySkill.set(c.sid, [c]);
  }
  for (const [sid, group] of bySkill) {
    const { cadences, openings } = expectedFromText(names[sid] || {});
    // THE OPENING IS A CLAIM ABOUT THE SKILL, NOT ABOUT EACH WEAPON, and it is met
    // when ANY of the skill's claims lands on it — the same unit everything else in
    // this gate is scored at. Per-weapon it raised two false alarms, both of which
    // sat in the corrections ledger masking a bug in this file rather than a
    // divergence in the data:
    //   15240 키예프 「전투 개시 5초 후 … 이후 10초마다 … 탄막 형태 업그레이드 및
    //     특수 탄막 재발동」 — the opener and each upgraded form are DIFFERENT
    //     weapons (63690 at t=5, then 63700 at 15, 63710/63720 at 25 every 10 s), so
    //     no single weapon's claim can carry both the 5 and the 10.
    //   1090090 콘테 디 카보우르 「전투 개시 10초 후 어뢰 탄막 … 어뢰 탄막 발사 후
    //     15초마다 특수 탄막」 — 68730 at t=10 and 160790 first landing at 10+15=25,
    //     which is exactly what the prose says and what the sim reports.
    // It does NOT let an off-by-one-period opening through, which is the defect class
    // the `d` check exists for: if the sim delayed the whole barrage by a cycle, NO
    // claim would land on the stated opening. 17850 and 1011700 still fail it.
    const openingMet = [...openings].some((o) => group.some((c) => Math.abs(o - c.d) <= TOL));
    const numeric = [...cadences]
      .map((c) => c.split('|'))
      .filter(([, v]) => v !== ANY)
      .map(([k, v]) => [k, Number(v)]);
    const anyCorroborated = group.some((c) => c.alts.some((g) => cadences.has(`${g.k}|${ANY}`)));
    // An `ANY` entry for a kind this skill never fires is not evidence about it — with
    // no number to compare and no matching trigger, there is nothing to check.
    if (!(anyCorroborated || numeric.length)) { skipped += 1; continue; }
    checked += 1;
    let ok = false; let byNumber = false; let sawNumber = false;
    for (const { alts, d } of group) {
      for (const got of alts) {
        const corroborated = cadences.has(`${got.k}|${ANY}`);
        // `fire` and `timer` are both "every N seconds" in prose; accept either. The
        // `ANY` corroboration is kind-exact on purpose — it says "the text states this
        // trigger", which is no evidence at all about a number.
        const kinds = new Set([got.k]);
        if (got.k === 'timer' || got.k === 'fire') { kinds.add('timer'); kinds.add('fire'); }
        const num = numberMatches(numeric, kinds, got.n);
        sawNumber = sawNumber || num;
        let pass = corroborated || num;
        // `d` is only checked against an opening once the claim's own cadence is the
        // one the text stated. A claim that agreed by kind alone matched some OTHER
        // clause, and that clause's opening is not its own: 인디애나 150290 fires on
        // every 주포 공격 while the 30s opening belongs to its second, combo-gated
        // barrage.
        if (num && openings.size && (got.k === 'timer' || got.k === 'fire')
            && !openingMet) pass = false;
        if (pass) { ok = true; byNumber = num; break; }
      }
      if (ok) break;
    }
    // The ledger is keyed on (skill id, DISAGREEMENT KIND), never on the skill alone.
    // A bare skill key exempts that skill from every future check: measured under
    // injected regressions on 2026-08-30, a blanket ledger absorbed 48% of the new
    // disagreements a `first += 5` defect produced, 23 of those from `period × 2` and
    // 15 from `count + 1`. An entry may only ever suppress the disagreement it was
    // written for — `cadence` (no claim answers any number the text states) or `d`
    // (a number agreed but the stated opening did not).
    const kind = sawNumber ? 'd' : 'cadence';
    if (ok) { agree += 1; kindOnly += byNumber ? 0 : 1; } else if (corrections[`${sid}|${kind}`]) {
      agree += 1;                     // accepted divergence, explained in the ledger
    } else {
      disagree.push(`[${kind}] ${sid} ${group[0].label}: `
        + `text=${[...cadences].sort().join(',')} opening=${[...openings].sort().join(',')} `
        + `claims=${JSON.stringify(group.map((c) => [c.d, c.alts.map((g) => `${g.k}:${g.n}`)]))}`);
    }
  }
  return { agree, checked, disagree, skipped, kindOnly };
}

// ---------------------------------------------------------------------------
// The two corpora
// ---------------------------------------------------------------------------

/**
 * A ship's weapon_true roots, as the BATCHES production installs them in.
 *
 * THE GATE MUST VALIDATE THE CONFIGURATION THAT SHIPS. `resolveBarrageDescriptors`
 * makes ONE `runBattleSim(liveSkillIds, ctx)` call per ship (design §5), and roots on
 * one unit are not independent: 20 of them carry a `ship_tag_list` gate whose tag is
 * stamped by a SIBLING root, so run one at a time they always score their "tag absent"
 * arm. 치칼로프 19600 fires weapons 62620/62640/62660 alone and 163050/163070/163090
 * beside 18610; Z47 150160 fires nothing alone and reads its counter off 30282's
 * `BattleBuffCount` when batched.
 *
 * Batch 0 is the live set — `liveSkillIds`' own rule, a rung survives unless its
 * successor is present — and every superseded rung gets one batch of its own where it
 * is swapped back in for its chain's terminal, so every root is still scored, in a run
 * where it is the live one. INSTALLING A RUNG BESIDE ITS OWN SUCCESSOR is not a state
 * the game produces and is actively wrong: chain-mates share a `countType`, so the
 * lower threshold trips first and RESETS the shared counter. 아일윈 20011/20012 both
 * count `countType: 20010`, at 15 and 10, and installed together the 15-salvo rung
 * reads as its successor's 10 — 265 skills failed that way before the swap-back.
 *
 * `owns` is what the batch is SCORED for, so a skill several ships display is
 * harvested exactly once, from the last ship that displays it (the ship the old flat
 * scope map named).
 */
function shipBatches(ship) {
  const skills = ship.skill || {};
  const succ = (sid) => {
    const up = skills[sid] && skills[sid].upgrade;
    return up != null && skills[String(up)] ? String(up) : null;
  };
  const roots = Object.keys(skills).filter((sid) => skills[sid] && skills[sid].weapon_true);
  const live = roots.filter((sid) => !succ(sid));
  const terminal = (sid) => {
    const seen = new Set(); let cur = sid;
    while (succ(cur) && !seen.has(cur)) { seen.add(cur); cur = succ(cur); }
    return cur;
  };
  const out = [{ roots: live, owns: live }];
  for (const sid of roots) {
    if (!succ(sid)) continue;
    const drop = terminal(sid);
    out.push({ roots: live.filter((x) => x !== drop).concat(sid), owns: [sid] });
  }
  return out;
}

/** Every skill id a roster ship displays with weapon_true — the core scope. */
function displayedScope() {
  const owner = new Map();
  const byShip = ships.map((s, i) => {
    const batches = shipBatches(s);
    for (const b of batches) for (const sid of b.owns) owner.set(sid, i);
    return { name: s.name, batches };
  });
  return { owner, byShip };
}

/**
 * Every skill id a ship gains from its 전용 장비 — the second scope. Two fields, both
 * on `sp_weapon`, and neither is reachable from `ship.skill`: `skill_upgrade`'s
 * targets (the upgraded rung the maxed weapon swaps in) and `attached_weapon_skill_id`
 * (the ids the weapon fires in its own right). An id that is ALSO a displayed skill
 * stays in the core corpus — the gate is split by which corpus a row came from, and an
 * id in both would be judged twice under different rules.
 *
 * These run BESIDE the ship's own live skills with each upgrade's SOURCE rung swapped
 * out, which is `applySPSkillUpgrade`'s output and so exactly the list production
 * hands the sim. It moves no number today; it is here so the batch is the shipping
 * configuration rather than the half of it that was convenient.
 */
function spweaponScope(core) {
  const owner = new Map();
  const byShip = ships.map((s, i) => {
    const sp = s.sp_weapon || {};
    const pairs = (sp.skill_upgrade || []).filter((p) => Array.isArray(p) && p.length > 1);
    const ids = pairs.map((p) => p[1])
      .concat((sp.attached_weapon_skill_id || []).filter((a) => a && a.id != null).map((a) => a.id));
    const owns = [];
    for (const sid of ids) {
      if (core.owner.has(String(sid)) || owns.includes(String(sid))) continue;
      owns.push(String(sid));
      owner.set(String(sid), i);
    }
    if (!owns.length) return { name: s.name, batches: [] };
    const sources = new Set(pairs.map((p) => String(p[0])));
    const siblings = shipBatches(s)[0].roots.filter((sid) => !sources.has(sid));
    return { name: s.name, batches: [{ roots: [...new Set(owns.concat(siblings))], owns }] };
  });
  return { owner, byShip };
}

const CORE = displayedScope();
const SPW = spweaponScope(CORE);

/**
 * Run a corpus one BATCH at a time — `shipBatches` above — and turn each root's rows
 * into scorable claims. Rows are attributed back by their own `skillId`, which the sim
 * carries on every row, so batching changes what the run knows and not who is scored.
 *
 * A CLAIM is one weapon's firing schedule — every row the sim emitted for that
 * `(root, weaponId)` pair — and not one row, because the engine splits a single
 * barrage's schedule across two casts that the prose describes as one thing.
 * 핫스 108100 「전투 개시 5초 후 … 이후 20초마다」 is an `onUpdate quota:1` opener at
 * t=5 and a re-armed `onAttach` recurrence first landing at t=25: neither row states
 * the prose's claim, and the merged pair states it exactly. This is the same
 * opener/recurrence merge the Python extractor did before emitting its record, so
 * grouping restores the unit the gate was written to score rather than relaxing it.
 *
 * `d` is the group's EARLIEST activation — when this barrage first lands, which is
 * what 「전투 개시 N초 후」 states. `alts` keeps every row's own `{k, n}`: the claim
 * agrees when one of them is the cadence the prose states.
 *
 * Two weapons fired by ONE cast still make the same claim twice (워싱턴's 66390 +
 * 66410 fire together), so identical `{k, n, d}` groups collapse — counting one claim
 * twice inflates the numerator as readily as the denominator.
 */
function simClaims(corpus, tally) {
  const out = [];
  corpus.byShip.forEach((ship, i) => {
    for (const batch of ship.batches) {
      const mine = batch.owns.filter((sid) => corpus.owner.get(sid) === i);
      if (!mine.length) continue;      // another ship owns every root here
      const { fired, blocked } = runBattleSim(batch.roots, SIM_CTX, graph);
      const blockedSet = new Set(blocked.map(String));
      const bySid = new Map();
      for (const row of fired) {
        const g = bySid.get(String(row.skillId));
        if (g) g.push(row); else bySid.set(String(row.skillId), [row]);
      }
      for (const sid of mine) {
        const rows = bySid.get(sid) || [];
        // A root the sim DISCLOSES and that fired nothing makes no claim at all, so its
        // text has nothing to be scored against — comparing a claim to a non-claim can
        // only ever manufacture a disagreement. Those belong beside the text the parser
        // declines to read. Counted here rather than silently vanishing (a zero-row root
        // contributes no claims, so nothing downstream would otherwise see it), and
        // ratcheted below so over-disclosure cannot quietly buy a better percentage.
        // NARROW BY DESIGN: a root that fires AND is disclosed still makes real claims
        // about the half it did model, and those are scored exactly as before.
        if (!rows.length) {
          if (blockedSet.has(sid)) tally.disclosed += 1; else tally.silent += 1;
          continue;
        }
        const byWeapon = new Map();
        for (const row of rows) {
          const g = byWeapon.get(row.weaponId);
          if (g) g.push(row); else byWeapon.set(row.weaponId, [row]);
        }
        const seen = new Set();
        for (const wrows of byWeapon.values()) {
          const alts = wrows.map(rowCadence).sort((a, b) => b.d - a.d); // recurrence first
          const d = Math.min(...alts.map((g) => g.d));
          const key = `${d}|${alts.map((g) => `${g.k}:${g.n}`).join(',')}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ sid, alts, d, label: ship.name || '' });
        }
      }
    }
  });
  return out;
}

// `'skill_id|kind': reason` — disagreements triaged as config-vs-text divergences
// rather than simulator bugs, so the row ships as simulated and the gate stops
// re-reporting it. An unexplained disagreement is not allowed to ship (D4).
//
// THE KEY CARRIES THE DISAGREEMENT KIND, so an entry suppresses only the disagreement
// it was written for. Keyed on the skill alone it exempted that skill from every
// future check — 33 of 924 permanently, 16 of them for reasons that had stopped
// applying — and absorbed 48% of the new disagreements an injected `first += 5`
// regression produced (23 of a `period × 2`, 15 of a `count + 1`).
//
// Nothing lands here to make a number go away. Each one was traced into the buff
// graph first, and everything that turned out to be an extractor bug was fixed in the
// walk instead: 14930's stack counter, 11820's short-lived opener, 150510/152220's
// delayed attach, 110010's stagger read as an opening, 15800's onStack re-arm, and
// 17030/17140's re-armed one-shot.
//
// RE-TRIAGED 2026-08-30 against what the gate reports after per-ship batching.18
// entries no longer fired and were DELETED rather than left standing — `151640`,
// `19890`, `152640`, `15390`, `19720`, `16630`, `12190`, `14020`, `4101`, `5041`,
// `17140`, `106410`, `106420`, `151560`, `1010310`, `11870`, most of them the
// opener-only family the simulator now resolves — plus `15240` 키예프 and `1090090`
// 콘테 디 카보우르, whose stated reason had gone stale because they were bugs in THIS
// FILE's opening check rather than divergences in the data. Those two are fixed at
// `openingMet`, not re-worded here.
const _COUNT_CONFIG = 'config counter vs description: countTarget paired by countType is what '
  + 'checkModCount/getCount compares against at runtime, and it diverges from the text in BOTH '
  + 'directions across these ships, so no single engine mechanic (gunnerBonus needs a max-star '
  + 'gunner hull and can only reduce) explains it';

const TEXT_CORRECTIONS = {
  // 전탄 발사 / 특수 탄막 count families — text and counter disagree per ship.
  '21191|cadence': _COUNT_CONFIG,   // 엔터프라이즈(경순) 15 vs 12
  '21192|cadence': _COUNT_CONFIG,   // 엔터프라이즈(경순) 10 vs 8
  '22061|cadence': _COUNT_CONFIG,   // 아키즈키급 24 vs 15
  '22062|cadence': _COUNT_CONFIG,   // 아키즈키급 16 vs 10
  '22251|cadence': _COUNT_CONFIG,   // 모가미/미쿠마 12 vs 9
  '22252|cadence': _COUNT_CONFIG,   // 모가미/미쿠마 8 vs 6
  '30512|cadence': _COUNT_CONFIG,   // 르 아르디 10 vs 15 (config is the LOWER one here)
  // The config states the threshold in a different UNIT from the prose.
  '150160|cadence': 'Z47 스탬프 피버: 「[특수 탄막 - Z47]을 2회 발동할 때마다」 counts activations '
    + 'of ANOTHER barrage, while the config implements it as a main-gun salvo counter — '
    + 'BattleBuffCount {countType: 30285, index: [1]} — so the two numbers are in different '
    + 'units and no reading of the graph can produce a count:2 row. The threshold also diverges '
    + 'by rung: 30 on buff_30281 (= 2x its own 15-salvo 특수 탄막 Z47-I, exactly the prose) and '
    + '10 on the live buff_30282 (= 1x its 10-salvo Z47-II, where the prose implies 20) — the '
    + 'same shape as the _COUNT_CONFIG family above. Visible at all only since roots are batched '
    + 'per ship: the counter this skill reads sits on the SIBLING root 30282, so run alone it '
    + 'fired nothing and was skipped as disclosed',
  // The threshold is real but the config expresses it as a buff LIFETIME, so there is
  // no countTarget for this gate to read.
  '18550|cadence': '프린츠 루프레히트: the skill grants a 특수 부포 (163010, firing every 2s at '
    + 'max level) and the barrage it drives (163020/163030) comes out as a 10s onRemove row — '
    + "which IS the text's 「5회 공격할 때마다」, five shots of a 2s weapon. The config states "
    + 'that threshold as a buff LIFETIME rather than a BattleBuffCount, so no countTarget '
    + 'exists anywhere for this gate to read and the row is honestly labelled timer. Accepting '
    + "count|5 against timer:10 would mean multiplying one claim's period by another claim's "
    + 'threshold — a rule with no second case in the corpus, which could as easily accept a '
    + "wrong number by coincidence. A limit of the gate's kind vocabulary, not a simulator "
    + 'error: the cadence itself is right',
  '19550|cadence': '프린츠 루프레히트, the base rung of 18550 and the same shape: the granted '
    + '특수 부포 ladders from 5s at level 1 to 2s at max and 「특수 부포를 5번 발사할 때마다」 '
    + "counts THAT weapon's shots, which the config again expresses as the same 10s lifetime. "
    + 'Identical reasoning to 18550 above',
  // The text's number has no counterpart the graph can produce.
  '19800|cadence': '할포드: the prose says 「전투 중 1초마다 특수 탄막을 전개」 and no 1s cadence '
    + "exists anywhere in the skill's graph. The no-seaplane arm (`buff_19800`'s "
    + '`maxWeaponNumber: 0` cast, which this loadout takes) reaches `buff_19806`, whose only '
    + 'cast is `{skill_id: 19804, time: 15}` at every one of its ten levels. Text-vs-config '
    + 'divergence',
  '150230|cadence': '로데슈: the barrage rides 「[8가지 덕목 돌격]을 2회 발동할 때마다」 on top of '
    + 'a 「10초마다」 발동, i.e. every 20s — and `buff_150230` states that directly as a third '
    + 'cast `{skill_id: 150232, time: 20}` beside the 10s 발동 (150231) and the 5-stack '
    + 'self-buff (150233, quota 5). The sim reads 20; the parser reads `10` and `2` as separate '
    + 'cadences and has no rule that multiplies one clause by another',
  // The OLD record was wrong and the simulator is right, because it evaluates a gate
  // the extractor could only read.
  '17850|d': "노시로(μ장비): the prose's 「사쿠라 엠파이어 장비를 장착하고 있는 경우, 전투 시작 "
    + "5초 후에 추가로 1회 발동」 opener is `buff_17850`'s second cast, "
    + '`{skill_id: 17853, check_weapon: true, label: ["IJN"], minWeaponNumber: 1}`. `label` is a '
    + 'per-item filter UnitCtx cannot answer, so evalGate returns `unknown`: the sim declines the '
    + 'opener AND discloses the skill (`blocked: ["17850"]`). The old record carried d=5 because '
    + 'the extractor read the cast without evaluating its gate. First activation at 20s is correct '
    + 'for a build without Sakura equipment',
  '1011700|d': '르 테메레르 대담무쌍 +: same shape one gate further. The 「전투 개시 3초 후」 opener is '
    + '`{time: 3, quota: 1, check_target: ["TargetPlayerVanguardFleet","TargetNationality"], '
    + 'minTargetNumber: 2, nationality: [8, 9]}` — it needs two 아이리스 리브레/비시아 vanguard '
    + 'ships, which this loadout does not have, so evalGate returns a plain false and the barrage '
    + 'correctly starts at its 20s cadence instead',
  // Two distinct barrages in one skill: the surviving claim describes the one gated on
  // a trigger this sim never raises, and the sim discloses it rather than guessing.
  '18950|cadence': '비토리오 쿠니베르티 (몽롱하게 비치는 지식의 보라색 달+): two barrages. The sim '
    + 'models the 배기연무 one — buff_18950 casts on onTorpedoWeaponFire, which attaches '
    + 'buff_18951 {time: 0.5, quota: 6, initialCD}, giving three rows (168560/184500/184510) '
    + 'at ~18 activations. The surviving count claim belongs to the OTHER barrage, the '
    + '「이 특수 탄막이 적에게 10회 명중할 때마다 … 추가로 특수 어뢰 공격」 one, whose gate is '
    + 'BattleBuffCount {countType: 18950, countTarget: 10, index: [18950]} on '
    + 'onBulletCollide. This simulator models no bullet flight and never raises that '
    + 'trigger (design §3), so the counter can never reach 10 and no count row can exist — '
    + 'and skill_18952/18953 (weapon 168590) correctly never fires. It is NOT hidden: '
    + 'runBattleSim([18950]).blocked === [18950], so the barrage is reported as unmodelled '
    + 'rather than shown with a wrong number. Structural, not a defect',
  '19950|cadence': '비토리오 쿠니베르티 (몽롱하게 비치는 지식의 보라색 달), the base rung of 18950 '
    + 'and the same structure at countTarget 15: BattleBuffCount {countType: 19950, '
    + 'countTarget: 15, index: [19950]} on onBulletCollide gates the 특수 어뢰, so that '
    + 'claim has no row by design. Its extra fire|* claim is kind-only and cannot be met '
    + 'either: the torpedo salvo merely ATTACHES the 배기연무 emitter, whose own cast sits '
    + 'on onUpdate, so no row can carry a fire trigger. Disclosed the same way '
    + '(blocked === [19950])',
};

/**
 * COVERAGE RATCHET — committed baselines, asserted EXACTLY, in both corpora.
 *
 * The agreement percentage cannot see coverage loss. A skill that stops producing rows
 * leaves `checked` AND `disagree` at the same moment, so the ratio is computed over the
 * survivors and a shrinking corpus reads as a PERFECT score. Proved by construction on
 * 2026-08-30: deleting six of the eight weapon trigger classes from the simulator's
 * `RAISED` set left this whole suite green at 100%, and a sim that simply refused to
 * model the disagreeing skills would have scored BETTER than the real one. The old
 * `checked >= 800` floor permitted 124 of 924 displayed skills (13.4%) to vanish, and
 * `checked >= 30` permitted 67% of the 전용 장비 corpus.
 *
 * So the three population counts are pinned instead: `checked` (skills whose text
 * scores something), `disclosed` (zero rows, and the sim said it cannot model them) and
 * `silent` (zero rows and no note). Exact equality is deliberate — the sim is
 * deterministic over committed data, so there is nothing for a tolerance to absorb, and
 * a band would just be a smaller version of the floor this replaces. A DROP in
 * `checked`, or a RISE in either zero-row bucket, is coverage the simulator used to have
 * and lost: that is the failure this exists to catch. A move the other way is a win and
 * still fails — update the number here in the same commit that earned it, and say in the
 * message which one moved and why.
 *
 * VERIFIED to fail, one deletion at a time, on 2026-08-30. Each of the eight weapon
 * triggers is caught by `checked` in both corpora (the six-at-once experiment above now
 * reads 867 and 80 against 925 and 89). Each of the six CLOCK triggers is caught too,
 * and only through the zero-row buckets — `onStartGame`/`onUpdate`/`onAttach`/`onRemove`/
 * `onBattleBuffCount` leave `checked` at 925 and move `disclosed`/`silent`, because they
 * are raised by direct `trigger()` calls that never consult `RAISED` and so reach only
 * `_hasUnraisedWeaponPath`. `onStack` is the narrowest: the displayed corpus does not
 * see it at all and the 전용 장비 one catches it at `disclosed` 53 -> 55. That is why all
 * three counts are pinned, in both corpora, rather than `checked` alone.
 */
const BASELINE = {
  displayed: { checked: 925, disclosed: 204, silent: 58 },
  spweapon: { checked: 89, disclosed: 53, silent: 187 },
};

function assertCoverage(which, got) {
  const want = BASELINE[which];
  for (const k of ['checked', 'disclosed', 'silent']) {
    if (got[k] === want[k]) continue;
    // Fewer `checked`, or more of either zero-row bucket, is coverage lost.
    const lost = k === 'checked' ? got[k] < want[k] : got[k] > want[k];
    assert.fail(`${which} ${k} = ${got[k]}, baseline ${want[k]}. `
      + (lost
        ? 'That is COVERAGE LOST — a barrage the simulator used to model and no longer does. '
          + 'The agreement percentage cannot see it, because a skill that stops producing rows '
          + 'leaves `checked` and `disagree` at the same moment.'
        : 'The scored population grew.')
      + ' Update BASELINE in this same commit, and only for a move you meant to make.');
  }
}

function scoreCorpus(which) {
  const tally = { disclosed: 0, silent: 0 };
  const claims = simClaims(which === 'displayed' ? CORE : SPW, tally);
  const raw = checkAgainstText(claims, {});
  const net = checkAgainstText(claims, TEXT_CORRECTIONS);
  // `GATE_DUMP=1 node --test ...` prints every RAW disagreement, ledger entries
  // included. Triaging one means re-reading the ones already accepted beside it.
  if (process.env.GATE_DUMP) console.log(['--- ' + which, ...raw.disagree].join('\n'));
  return { ...raw, agree: net.agree, unexplained: net.disagree, ...tally };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test('the KR text corroborates the simulated cadence', () => {
  const { agree, checked, disagree, kindOnly, unexplained, skipped,
    disclosed, silent } = scoreCorpus('displayed');
  // Printed BEFORE the asserts: on a failure the numbers are what a triage starts from,
  // and an assert that fires first hides them.
  console.log(`  displayed: ${agree}/${checked} (${kindOnly} kind-only), `
    + `${disagree.length} raw disagree, ${skipped} skipped, ${unexplained.length} unexplained`);
  // The three skip buckets are printed apart on purpose — `skipped` is text the parser
  // declined, `disclosed` is a barrage the sim says it cannot model, and `silent` is a
  // root that read as inactive with no note. The two zero-row buckets are ratcheted
  // below, which is what stops either of them from becoming a way to skip the corpus.
  console.log(`  displayed skips: ${skipped} parser-declined, ${disclosed} disclosed-no-rows, `
    + `${silent} silent-no-rows`);
  // Every disagreement in the DISPLAYED corpus is triaged and either fixed or in the
  // corrections ledger. Zero unexplained is the claim; the percentage floor is the
  // backstop under it, and the coverage ratchet is what stops the corpus itself from
  // shrinking out from under both.
  assert.deepEqual(unexplained, [], `unexplained disagreements:\n${unexplained.join('\n')}`);
  assert.ok(agree / checked >= 0.98, `agreement ${(100 * agree / checked).toFixed(1)}% of ${checked}`);
  assertCoverage('displayed', { checked, disclosed, silent });
});

test('the 전용 장비 corpus corroborates too', () => {
  // No percentage floor here on purpose: 39 checked records are too few for a ratio to
  // mean anything. Zero unexplained is the whole claim.
  const { unexplained, checked, agree, skipped, kindOnly, disclosed, silent } = scoreCorpus('spweapon');
  console.log(`  전용 장비: ${agree}/${checked} (${kindOnly} kind-only), `
    + `${skipped} skipped, ${unexplained.length} unexplained`);
  console.log(`  전용 장비 skips: ${skipped} parser-declined, ${disclosed} disclosed-no-rows, `
    + `${silent} silent-no-rows`);
  assert.deepEqual(unexplained, [], `unexplained:\n${unexplained.join('\n')}`);
  assertCoverage('spweapon', { checked, disclosed, silent });
});
