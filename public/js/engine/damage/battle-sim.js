// public/js/engine/damage/battle-sim.js
/**
 * Battle-engine mirror: a discrete-event simulation of the KR buff/skill event bus,
 * used to count barrage (탄막) activations instead of inferring a cadence from the
 * config graph's shape.
 *
 * Pure: no DOM, no wall-clock, never mutates an input.
 *
 * There is no traversal to port — the engine is an event bus over a tick loop
 * (BattleUnit:Update -> UpdateBuff -> onTrigger -> effect:Trigger), so this is a
 * small simulator rather than a graph walk. Fixed 30 fps, matching both the engine
 * and the sim-weapon physics core.
 *
 * PROBABILITY RIDES ONE SCALAR, and that is the whole design. castSkill
 * (battlebuffcastskill.lua) rolls `rant` BEFORE it calls enterCoolDown, so a failed
 * roll costs no cooldown. Modelling each cast edge's `avail` as P(off cooldown)
 * reproduces BOTH documented rant semantics with no special case:
 *   - onUpdate + CD + p: mass restores at now+time, then converges over ~1/p ticks
 *     -> effective period time + (1/p - 1)/30, i.e. rant is nearly a no-op.
 *   - onFire + CD + p: mass drains one salvo at a time -> period time + gap/p.
 *   - onAttach / onStartGame, no CD: a plain multiply.
 * If this file ever disagrees with the corpus, check this mechanism first.
 */
import { evalGate } from './battle-sim.gates.js';

export const TICK = 1 / 30;
const RANT_FULL = 10000;
const MAX_CASCADE = 8;      // recursion guard on attach cascades

/** Triggers this sim raises. Everything else is battlefield state it cannot model. */
const RAISED = new Set([
  'onStartGame', 'onUpdate', 'onAttach', 'onStack', 'onRemove', 'onBattleBuffCount',
  'onFire', 'onChargeWeaponFire', 'onTorpedoWeaponFire', 'onWeaponSteday',
  'onChargeWeaponReady', 'onAllInStrike', 'onAllInStrikeSteady', 'onAirAssistReady',
]);

const FIRE_TYPES = new Set(['BattleSkillFire', 'BattleSkillFireSupport']);

/** Triggers raised by a battle EVENT rather than by the clock. See record(). */
const EVENT_TRIGGERS = new Set([
  'onFire', 'onChargeWeaponFire', 'onTorpedoWeaponFire', 'onWeaponSteday',
  'onChargeWeaponReady', 'onAllInStrike', 'onAllInStrikeSteady', 'onAirAssistReady',
]);

class Sim {
  constructor(graph, ctx) {
    this.g = graph;
    this.ctx = ctx;
    this.now = 0;
    this.buffs = [];            // live BuffInstance[]
    this.restores = new Map();  // tick index -> [{ edge, mass }] due at that tick
    this.rows = new Map();      // `${root}|${weaponId}|${trigger}` -> row
    this.blocked = new Set();
    this.counters = new Map();  // countType -> count
    // A MULTISET, mirroring battleunit.lua's _labelTagList + its per-tag counter:
    // two live buffs may stamp one tag and either expiring must not clear it. Keys are
    // deleted at zero so `has` still answers exactly what a Set would. The seeds are
    // the unit's own identity tags (setStandardLabelTag's N_/T_), which have no holder
    // and so are never decremented — nothing removes a tag it did not add.
    this.tags = new Map();
    for (const t of ctx.unit.tags || []) this.tags.set(String(t), (this.tags.get(String(t)) || 0) + 1);
    this._reachS = new Map();   // skillId -> reaches a weapon? (memoised, see below)
    this._reachB = new Map();
  }

  // --- buff lifecycle ----------------------------------------------------
  /**
   * `ev` is threaded into the attach cascade because addBuff RAISES onAttach/onStack:
   * a cast reached through count -> AddBuff -> the child's onAttach would otherwise
   * lose the count context, and record() has no other source for `countTarget`.
   * 안샨 29801 「주포로 16회 공격할 때마다」 is exactly that shape — the count is right
   * (48 s IS 16 salvos) and only the label was gone.
   */
  addBuff(id, root, weight, cascade, ev) {
    const node = this.g.b[String(id)];
    if (!node || weight <= 0 || cascade > MAX_CASCADE) return;
    const life = node.t || 0;
    const present = this.buffs.find((b) => b.id === String(id) && b.root === root);
    if (present) {
      // battleunit.lua:976 AddBuff on a present buff calls Stack(): the lifetime
      // refreshes, the effects do not restart. ponytail: weight takes max rather
      // than composing 1-(1-a)(1-b); exact for the 94% with no rant on the adder,
      // upgrade path is a per-instance distribution if a real case needs it.
      present.expiresAt = life ? this.now + life : Infinity;
      present.weight = Math.max(present.weight, weight);
      // SetRemoveTime (battlebuffunit.lua:279) clears _cancelTime, so a re-add drops
      // a pending BattleBuffCancelBuff removal along with the refreshed lifetime.
      present.cancelAt = Infinity;
      // Stack() raises the level, capped at the node's own `s`. This is READ by an
      // onStack BattleBuffCount rather than being bookkeeping — see fire().
      present.stacks = Math.min(present.stacks + 1, node.s || 1);
      this.trigger('onStack', present, ev, cascade + 1);
      return;
    }
    const inst = {
      id: String(id), root, weight, stacks: 1,
      // Identifies THIS attachment. record() reads it to tell one burst of casts
      // from the next — see the period rule there.
      key: (this._seq = (this._seq || 0) + 1),
      expiresAt: life ? this.now + life : Infinity,
      cancelAt: Infinity,
      edges: node.e.map((e) => ({
        e,
        // SetArgs arms _nextEffectTime = now + time unless initialCD, so a cast
        // with a cooldown and no initialCD does NOT fire on its first trigger.
        avail: (e.a.initialCD || !(e.a.time > 0)) ? 1 : 0,
        quota: e.a.quota != null ? e.a.quota : Infinity,
      })),
    };
    for (const edge of inst.edges) {
      if (!edge.avail && edge.e.a.time > 0) {
        this._scheduleRestore(edge.e.a.time, edge, 1);
      }
    }
    this.buffs.push(inst);
    this.trigger('onAttach', inst, ev, cascade + 1);
  }

  /**
   * battleunit.lua:1067 RemoveBuff — drop the instance and raise onRemove, exactly as
   * expiry does. Removal is BY BUFF ID ON THE UNIT, so a cleanse can end a loop it
   * does not itself hold; the engine keeps one buff list, not one per root skill.
   *
   * ponytail: a removal reached at fractional mass still removes outright, the same
   * set-membership shortcut BattleBuffAddTag takes in apply(). The upgrade path is to
   * scale it — `b.weight *= (1 - mass)`, dropping the instance at ~0 — which was
   * built and measured on 2026-08-30: it differs on 6 of 1327 displayed roots, is
   * closer on 꼬마 다이호 (her 1-in-3 류세이 roll ends the plane loop, so ~2.4 planes
   * per cycle against a true ~2.6 where this gives 1), and scores WORSE on the KR-text
   * gate (3 unexplained against 2). It is also not uniformly better: a
   * partially-present cleanse holder can never re-attach, so its later rolls stop
   * removing anything. Revisit only with a case the gate can see.
   */
  _removeBuffs(ids, cascade) {
    const want = new Set(ids.map(String));
    const gone = this.buffs.filter((b) => want.has(b.id));
    if (!gone.length) return;
    this.buffs = this.buffs.filter((b) => !want.has(b.id));
    for (const b of gone) this.trigger('onRemove', b, null, cascade + 1);
  }

  /**
   * Bucket a cooldown restore by the TICK it lands on, so draining is O(1) per tick.
   *
   * A flat list forced an O(n) scan every tick, and n does not stay small. The
   * tempting fix — an epsilon on `mass` so the convergence tail terminates — is
   * INERT at the magnitudes that matter: at a 1% proc chance the 20 s cooldown
   * replenishes `avail` long before it can decay, so the smallest mass ever
   * computed is ~2.4e-5, four orders of magnitude above any sane floor. The edge
   * simply re-fires every tick forever, and each entry lives a whole cooldown.
   * Measured at 50 such edges: 90 s took 908 ms and 600 s took 13.2 s; bucketed,
   * 108 ms and 581 ms, with activation counts identical to two decimals.
   */
  _scheduleRestore(delay, edge, mass) {
    const tick = Math.round((this.now + delay) / TICK);
    const bucket = this.restores.get(tick);
    if (bucket) bucket.push({ edge, mass });
    else this.restores.set(tick, [{ edge, mass }]);
  }

  // --- dispatch ----------------------------------------------------------
  /**
   * Raise `names` on one buff instance (or all of them when inst is null).
   *
   * `names` is a LIST because one salvo raises several trigger names at once
   * (onFire + onChargeWeaponFire + onChargeWeaponReady + onWeaponSteday), and an
   * edge listing two of them must fire ONCE per salvo, not once per name. Raising
   * them as separate events is a silent 2-4x over-count.
   */
  trigger(names, inst, ev, cascade = 0) {
    if (cascade > MAX_CASCADE) return;
    const list = Array.isArray(names) ? names : [names];
    const targets = inst ? [inst] : this.buffs.slice();
    for (const b of targets) {
      for (const edge of b.edges) {
        if (!edge.e.tr) continue;
        // Record under the edge's OWN declared trigger, so the row's label is the
        // condition the config states rather than whichever alias arrived first.
        const matched = edge.e.tr.find((t) => list.includes(t));
        if (!matched) continue;
        this.fire(edge, b, ev, matched, cascade);
      }
    }
  }

  fire(edge, buff, ev, trigger, cascade) {
    const a = edge.e.a;
    // equipIndexRequire: a slot-filtered edge only sees events from those slots.
    // Scoped to the WEAPON events, because that is where battlebuffeffect.lua checks
    // it (onFire / onBulletHit / onCombo read `slot3.equipIndex`); onAttach, onStack
    // and onBattleBuffCount carry no equipIndex and their wrappers never call it. The
    // scope is load-bearing now that addBuff threads its event into the attach
    // cascade: without it the 38 onAttach edges carrying an `index` would start being
    // filtered against whatever slot the originating salvo came from.
    if (a.index && ev && ev.slot != null && EVENT_TRIGGERS.has(trigger)
        && !a.index.includes(ev.slot)) return;

    if (edge.e.ty === 'BattleBuffCount') {
      // The THRESHOLD lives here, on a sibling BattleBuffCount paired by countType —
      // never on the cast edge, which carries no threshold at all. Counters are
      // deterministic: all 598 shipped count records carry no rant.
      const key = a.countType;
      // An onStack counter READS the holder's stack level; every other trigger
      // increments a tally. battlebuffcount.lua:98 is `_count = GetStack()`, an
      // absolute read. 92 of the 791 records in the published graph (11.6%, over 55
      // buffs) trigger on onStack, the sim raises onStack, and all 92 sit on a buff
      // whose stack cap is above 1 — most with countTarget equal to that cap, i.e.
      // "fire at max stacks". Tallying stack EVENTS there turns an honest zero into a
      // confidently wrong number.
      const reads = (edge.e.tr || []).includes('onStack');
      const n = reads ? buff.stacks : (this.counters.get(key) || 0) + 1;
      if (n >= (a.countTarget || Infinity)) {
        if (!reads) this.counters.set(key, 0);
        // countTarget and the watched slots ride the event: record() copies them onto
        // the row, and they are the only source cadenceLabel has for 「주포 N회마다」.
        // The WHOLE list, not its first entry — a counter watching [1, 3] is not a
        // 주포 counter (14 live roots have a multi-slot index), and `slot` stays beside
        // it for readers that only ever wanted the leading one.
        this.trigger('onBattleBuffCount', null, {
          names: ['onBattleBuffCount'], countType: key,
          countTarget: a.countTarget, slot: (a.index || [])[0], slots: a.index,
        }, cascade + 1);
      } else if (!reads) {
        this.counters.set(key, n);
      }
      return;
    }
    // An onBattleBuffCount edge only answers ITS OWN counter.
    if (trigger === 'onBattleBuffCount' && ev && ev.countType !== a.countType) return;

    const gate = evalGate(a, this.ctx.unit, this.tags);
    if (gate === 'unknown') { this.blocked.add(buff.root); return; }
    if (gate === false) return;
    if (edge.quota <= 0) return;

    const p = (a.rant != null ? a.rant : RANT_FULL) / RANT_FULL;
    // enterCoolDown is a no-op when _time == 0, so such an edge is never in CD and
    // its avail must stay at 1 — that is what makes rant a plain multiply on an
    // onAttach cast and a period-widener on a cooldown-gated one.
    const hasCd = a.time > 0;
    let mass = edge.avail * p * buff.weight * (a.repeat_count || 1);
    if (mass > edge.quota) mass = edge.quota;
    // An epsilon, not > 0: availability converges geometrically but never reaches
    // exactly 0, so a bare `<= 0` guard keeps pushing a restore entry every tick for
    // the rest of the battle. Measured before this guard: one such edge plateaus at
    // ~600 pending entries (its cooldown in ticks) and 50 of them peak at 30,000
    // entries / ~800 ms. Below this threshold an activation cannot round to anything
    // a reader would see.
    if (mass <= 1e-9) return;
    edge.quota -= mass;
    if (hasCd) {
      const spent = mass / (buff.weight * (a.repeat_count || 1));
      edge.avail -= spent;
      this._scheduleRestore(a.time, edge, spent);
    }
    this.apply(edge, buff, mass, trigger, cascade, ev);
  }

  /**
   * Run one effect's payload with `mass` expected occurrences.
   *
   * `ev` is threaded rather than stashed on `this` because an attach cascade
   * re-enters fire() mid-apply: a shared field would be clobbered by the inner
   * event and the outer record() would label its row with the wrong one.
   */
  apply(edge, buff, mass, trigger, cascade, ev) {
    const e = edge.e;
    const a = e.a;
    // See record(): the period a row REPORTS cannot always be measured.
    //
    // A FINITE QUOTA MEANS `a.time` IS NOT A CADENCE. The edge cannot keep firing on
    // that cooldown — it stops after `quota` casts per attachment — so its `time` is a
    // stagger offset or an opening delay, and reporting it labels the barrage with a
    // number the game never repeats at. 운젠 17030's buff_17034 carries fifteen
    // {time: 0.4…3.9, quota: 1} casts of one staggered launcher the prose states as
    // 「20초마다」, and 258 of 3492 cast edges have this shape. Those rows are measured
    // instead, which is what record() below is built to answer correctly.
    const bounded = a.time > 0 && a.quota != null;
    const stated = (a.time > 0 && !bounded)
      ? a.time
      : (EVENT_TRIGGERS.has(trigger) ? 0 : null);
    // ...but a bounded edge's `time` is NOT nothing, it is the weaker claim: a real
    // delay-to-first-fire when the holder is never re-added, a stagger offset when it
    // is. record() files it below the measurement, so the measurement wins wherever
    // there IS one. 루루티에 103060 is the case that needs it — four
    // {time: 22/44/66/88, quota: 1} casts on ONE 90 s buff are the prose's
    // 「22초 마다 … 최대 4번」 ladder, four genuine one-shots with no burst to measure.
    const statedAlt = bounded ? a.time : null;
    switch (e.ty) {
      case 'BattleBuffAddBuff':
        this.addBuff(a.buff_id, buff.root, mass, cascade, ev);
        break;
      case 'BattleBuffCastSkill':
        this.cast(a.skill_id, buff, mass, trigger, cascade, ev, stated, statedAlt);
        break;
      case 'BattleBuffCastSkillRandom': {
        // battlebuffcastskillrandom.lua `spell` rolls once and casts exactly ONE of
        // skill_id_list. The band width IS the probability, so the mass splits
        // across the alternatives; casting each at full rate multiplies the barrage
        // by the list length (2B 117034/117035/117036). Alternatives share the
        // parent edge's own cadence, so `stated` passes through unchanged.
        const ids = a.skill_id_list || [];
        const bands = a.range || [];
        for (let i = 0; i < ids.length; i++) {
          const band = bands[i];
          // battlebuffcastskillrandom.lua:23 rolls `math.random()` with NO argument,
          // i.e. a fixed [0,1), then tests `lo <= roll < hi`. So a band's probability
          // is its OVERLAP with [0,1) — never its raw width over some span, and never
          // renormalised: bands covering only half the space leave a real proc miss.
          // The overlap also handles the corpus's one typo for free: buff 152051 ships
          // [[0,0.33],[0.33,66],[0.66,1]], where the 66 is plainly meant to be 0.66,
          // and the engine itself fires that alternative on any roll >= 0.33 — which
          // is exactly what the overlap returns (0.67), where a clamped width gives 1.
          const share = band
            ? Math.max(0, Math.min(band[1], 1) - Math.max(band[0], 0))
            : 1 / ids.length;
          this.cast(ids[i], buff, mass * share, trigger, cascade, ev, stated, statedAlt);
        }
        break;
      }
      case 'BattleBuffAddTag': {
        // A TAG LIVES EXACTLY AS LONG AS THE BUFF HOLDING IT. battlebuffaddtag.lua
        // overrides two methods and no more — onAttach -> unit:AddLabelTag, onRemove ->
        // unit:RemoveLabelTag — so this must act on the trigger that fired it. Stamping
        // once and never clearing turns a one-second window into the whole battle:
        // 드미트리 돈스코이 180000/190000 gate an uncooled onUpdate cast on `xietongdaji`,
        // stamped by buff_190008 whose lifetime is 1 s, and read 2251 casts against ~30.
        //
        // Any OTHER trigger does nothing: BattleBuffAddTag inherits the base method,
        // whose onTrigger only decrements quota (battlebuffeffect.lua:802). The one edge
        // in the graph that also lists onStack therefore must not re-stamp.
        //
        // Membership, not mass — a fractional mass stamps, and un-stamps the same way.
        // Nothing is lost by that: all 342 reachable AddTag effects carry `tag` and
        // nothing else, so there is no rant, cooldown, quota or gate to weigh.
        const d = trigger === 'onAttach' ? 1 : trigger === 'onRemove' ? -1 : 0;
        if (d) {
          for (const t of [].concat(a.tag_list || [], a.tag || [])) {
            const key = String(t);
            const n = (this.tags.get(key) || 0) + d;
            // RemoveLabelTag decrements only what it finds, so an unmatched removal is
            // a no-op rather than a negative count.
            if (n > 0) this.tags.set(key, n); else this.tags.delete(key);
          }
        }
        break;
      }
      case 'BattleBuffCancelBuff':
        // battlebuffcancelbuff.lua: `count` (default 99999, and a literal 0 stays 0 —
        // Lua's `or` only replaces nil) counts DOWN on every trigger, and at <= 0 the
        // effect cancels THE BUFF HOLDING IT. It never reads its own arg_list
        // `buff_id`: SetArgs stores it and onTrigger uses `slot2` — the holder — so a
        // target id here is dead config. `delay` arms _cancelTime = now + delay, once
        // (SetToCancel guards on `if not _cancelTime`); with no delay the holder is
        // removed on the spot.
        //
        // This is what BOUNDS a loop. 애버크롬비 11300's {count: 0, delay: 16} on
        // onUpdate cancels the root buff at t=16, which is what makes its two 15 s
        // adders one-shot openers — 「전투 개시 15초 후에 … 그 뒤 20초마다」. Without
        // it the 15 s adder never stops and the barrage over-counts by 75%.
        if (edge.cancelIn == null) edge.cancelIn = a.count != null ? a.count : 99999;
        edge.cancelIn -= 1;
        if (edge.cancelIn <= 0) {
          if (a.delay != null) {
            if (buff.cancelAt === Infinity) buff.cancelAt = this.now + a.delay;
          } else {
            this._removeBuffs([buff.id], cascade);
          }
        }
        break;
      case 'BattleBuffCleanse':
        // battlebuffcleanse.lua strips every id in `buff_id_list` FROM THE UNIT, so
        // unlike the cancel above it can end a loop it does not hold. Its own
        // check_target / min / maxTargetNumber gate already ran through evalGate.
        //
        // 꼬마 다이호 16800's cleanse on onBattleBuffCount at 6 stacks IS the prose's
        // 「총 6회의 함재기 공격을 소환할 때까지」; dropped, the random-plane loop runs
        // every second for the rest of the battle (~9.5x) AND the 사이운 opener never
        // re-fires, because a buff that is never removed can only Stack().
        //
        // Nothing DESCENDS through a removal edge to collect effects, so this does not
        // reopen CLAUDE.md's "never descend through a REMOVAL edge" rule — that one is
        // about deriving a skill's effects from what it strips. Here the removal is
        // the control flow.
        this._removeBuffs(a.buff_id_list || [], cascade);
        break;
      default:
        break;      // BattleBuffCount is handled in `fire`, before the cooldown model
    }
  }

  cast(skillId, buff, mass, trigger, cascade, ev, stated, statedAlt) {
    const node = this.g.s[String(skillId)];
    if (!node || mass <= 0 || cascade > MAX_CASCADE) return;
    for (const e of node.e) {
      if (FIRE_TYPES.has(e.ty)) {
        this.record(buff, e.a.weapon_id, mass, trigger, ev, stated, statedAlt);
      } else if (e.ty === 'BattleSkillAddBuff' && e.a.buff_id) {
        this.addBuff(e.a.buff_id, buff.root, mass, cascade + 1, ev);
      }
    }
  }

  record(buff, weaponId, mass, trigger, ev, stated, statedAlt) {
    if (weaponId == null) return;
    const root = buff.root;
    // A cast reached THROUGH a count answers the count, whatever the edge that
    // finally fired declares — 안샨 29801's weapon hangs off buff_29805's onAttach,
    // and labelling that row 「발동 시」 loses the 「주포 16회마다」 the count states and
    // the config's own threshold with it.
    const counted = !!(ev && ev.countTarget != null);
    const trig = counted ? 'onBattleBuffCount' : trigger;
    const k = `${root}|${weaponId}|${trig}`;
    let row = this.rows.get(k);
    if (!row) {
      row = { skillId: root, weaponId, activations: 0, trigger: trig, first: this.now,
        _last: this.now, _gaps: 0, _n: 0, _burstGap: null,
        _burstAt: this.now, _burstId: buff.id, _burstKey: buff.key };
      // A count row's label needs the threshold and the slot it watches; both ride
      // the onBattleBuffCount event Task 3 raises, and nothing else supplies them.
      if (counted) row.countTarget = ev.countTarget;
      if (ev && ev.slot != null) row.slot = ev.slot;
      if (ev && ev.slots) row.slots = ev.slots;
      this.rows.set(k, row);
    } else if (this.now > row._last) {
      row._gaps += this.now - row._last;
      row._n += 1;
      row._last = this.now;
      // A BURST is the run of casts one ATTACHMENT fires. A quota-bounded edge (or a
      // pair of staggered siblings on one holder) empties itself in a fraction of a
      // second and then waits for the buff to be re-added, so the gaps INSIDE a burst
      // are stagger offsets and only the gaps BETWEEN bursts are the barrage's
      // cadence. 르 말랭 13770's buff_13771 fires at 21/22, 41/42, 61/62 — a mean gap
      // of 8.2 against the prose's 20, a between-burst gap of exactly 20.
      //
      // A repetition is THE SAME BUFF attached again. Handing off to a DIFFERENT buff
      // is a parallel branch of one volley, not the volley coming round again, so the
      // time between the two states no cadence: 리나운·META 800540's skill fires the
      // pair 62370/62380 itself and then again 2 s later from buff_800541, and
      // 알자스 150026 hands its 8-volley burst to buff_150027 on the next stack
      // (which is why that row correctly reports the 0.2 s burst and not the salvo
      // gap between the two holders).
      if (row._burstId !== buff.id) {           // handoff: adopt it, claim no cadence
        row._burstId = buff.id;
        row._burstKey = buff.key;
        row._burstAt = this.now;
      } else if (row._burstKey !== buff.key) {  // the same buff, attached again
        row._burstGap = this.now - row._burstAt;
        row._burstKey = buff.key;
        row._burstAt = this.now;
      }                                         // else: still inside the same burst
    }
    // MEASURING the period is only valid when mass accrues discretely, and under
    // probability mass it usually does not: a proc-chance edge accrues a sliver on
    // every trigger while its availability converges, so the mean gap collapses to
    // the TRIGGER's rate rather than the activation's. Measured on this code, a
    // {onUpdate, time:20, rant:7000} edge reads 0.033 s against a true 20, and a
    // {onFire every 3 s, time:10, rant:5000} edge reads 3 against a true ~14.7.
    //
    // So the period is taken from the config wherever the config states it:
    //   * a cooldown (`a.time > 0`) with NO finite quota IS the period — for onUpdate
    //     and onFire alike, and it is also exactly what cadenceLabel wants for
    //     「발사 시 (재사용 N초)」. With a quota the edge cannot fire twice on that
    //     cooldown per attachment, so the number is a stagger offset — see apply().
    //   * a fire/air trigger with NO cooldown has no cadence to report at all; it
    //     fires on the salvo, so 0 keeps the label a bare 「발사 시」 rather than
    //     inventing a 「재사용 3.0초」 out of the salvo gap.
    //   * everything else is measured, and that case is load-bearing: 워싱턴's
    //     branch-2 cast is an onAttach with no `time` of its own, whose real 20 s
    //     cadence comes from the buff that RE-ADDS it. Reading `a.time` there would
    //     be the 4x error the old heuristic made, so this must not become
    //     "always read the config".
    if (stated != null) row.statedPeriod = stated;
    if (statedAlt != null) row.altPeriod = statedAlt;
    row.activations += mass;
  }

  /**
   * True when some path from this root to a weapon runs through a trigger the sim never
   * raises. Such a root must be DISCLOSED rather than counted as inactive: the two notes
   * answer different questions, and 「현재 편성에서 발동하지 않는」 asserts the condition was
   * read and simply not met — wrong for a barrage this sim structurally cannot model.
   *
   * Applied uniformly, including to roots that also fire: a skill with a live barrage AND an
   * onSink death-rattle really does have an unmodelled half. Measured cost of that choice is
   * 18 of 1031 firing roots; the alternative was a special case earning 1.7%.
   */
  _hasUnraisedWeaponPath(root) {
    // Walks BOTH node kinds. An earlier version pushed only `buff_id`, which silently
    // missed every unraised path sitting behind a skill hop — buff -> (raised) cast ->
    // skill -> BattleSkillAddBuff -> buff -> (unraised) cast -> weapon. That shape is
    // common: 인디애나폴리스 10120 reads as silently inactive under it, and Z26 13570
    // fires while hiding an onShieldBroken branch — the very death-rattle case this
    // method's own comment claims to catch. 22 roots were affected.
    const seenB = new Set(); const seenS = new Set();
    const stack = [['b', String(root)]];
    while (stack.length) {
      const [kind, id] = stack.pop();
      if (kind === 's') {
        if (seenS.has(id)) continue;
        seenS.add(id);
        const sn = this.g.s[id];
        if (!sn) continue;
        for (const e of sn.e) {
          if (e.ty === 'BattleSkillAddBuff' && e.a.buff_id != null) stack.push(['b', String(e.a.buff_id)]);
        }
        continue;
      }
      if (seenB.has(id)) continue;
      seenB.add(id);
      const node = this.g.b[id];
      if (!node) continue;
      // An onBattleBuffCount edge looks raised, but it can only fire if some
      // BattleBuffCount actually reaches its threshold. 비토리오 쿠니베르티 18950 counts
      // 「10회 명중할 때마다」 on onBulletCollide — a trigger this sim never raises — so
      // its 특수 어뢰 can never fire, yet the cast sitting on onBattleBuffCount hid that
      // and the root read as silently inactive instead of unmodelled: the exact
      // conflation the two notes exist to prevent. Scoped to counters ON THIS BUFF,
      // because a countType with no counter here has one elsewhere and calling it dead
      // would disclose a barrage that works.
      const counters = new Map();
      for (const e of node.e) {
        if (e.ty !== 'BattleBuffCount' || e.a.countType == null) continue;
        const ok = (e.tr || []).some((t) => RAISED.has(t));
        counters.set(e.a.countType, ok || counters.get(e.a.countType) === true);
      }
      const raisable = (e) => (e.tr || []).some((t) => RAISED.has(t)
        && !(t === 'onBattleBuffCount' && counters.get(e.a.countType) === false));
      for (const e of node.e) {
        const tr = e.tr || [];
        const ids = [e.a.skill_id, ...(e.a.skill_id_list || [])].filter((x) => x != null);
        if (tr.length && !raisable(e)) {
          if (ids.some((x) => this._skillReachesWeapon(String(x)))) return true;
          if (e.a.buff_id != null && this._buffReachesWeapon(String(e.a.buff_id))) return true;
        }
        if (e.a.buff_id != null) stack.push(['b', String(e.a.buff_id)]);
        for (const x of ids) stack.push(['s', String(x)]);
      }
    }
    return false;
  }

  /** Memoised: does this skill reach a BattleSkillFire, directly or through a buff? */
  _skillReachesWeapon(sid) {
    if (this._reachS.has(sid)) return this._reachS.get(sid);
    this._reachS.set(sid, false);          // cycle guard: assume no until proven
    const node = this.g.s[sid];
    let hit = false;
    if (node) {
      for (const e of node.e) {
        if (FIRE_TYPES.has(e.ty)) { hit = true; break; }
        if (e.ty === 'BattleSkillAddBuff' && e.a.buff_id != null
            && this._buffReachesWeapon(String(e.a.buff_id))) { hit = true; break; }
      }
    }
    this._reachS.set(sid, hit);
    return hit;
  }

  /** Memoised twin of the above for buff nodes. */
  _buffReachesWeapon(bid) {
    if (this._reachB.has(bid)) return this._reachB.get(bid);
    this._reachB.set(bid, false);
    const node = this.g.b[bid];
    let hit = false;
    if (node) {
      for (const e of node.e) {
        const ids = [e.a.skill_id, ...(e.a.skill_id_list || [])].filter((x) => x != null);
        if (ids.some((s) => this._skillReachesWeapon(String(s)))) { hit = true; break; }
        if (e.a.buff_id != null && this._buffReachesWeapon(String(e.a.buff_id))) { hit = true; break; }
      }
    }
    this._reachB.set(bid, hit);
    return hit;
  }

  // --- the loop ----------------------------------------------------------
  run(rootSkillIds) {
    for (const id of rootSkillIds) {
      // InitUnitSkill installs buff_<skill_id>; a passive like 알자스 150020 has no
      // skill_150020 at all and exists only as its buff.
      if (this.g.b[String(id)]) this.addBuff(id, String(id), 1, 0);
      if (this._hasUnraisedWeaponPath(id)) this.blocked.add(String(id));
    }
    this.trigger('onStartGame', null, null);

    const events = (this.ctx.events || []).slice().sort((x, y) => x.t - y.t);
    let ei = 0;
    const ticks = Math.floor((this.ctx.window || 0) / TICK);
    // Starts at 0, not 1: BattleUnit:Update raises ON_UPDATE on the first frame
    // too, so an initialCD cast fires at exactly t=0 rather than one frame late.
    for (let i = 0; i <= ticks; i++) {
      this.now = i * TICK;
      const due = this.restores.get(i);
      if (due) {
        for (const r of due) r.edge.avail += r.mass;
        this.restores.delete(i);
      }
      // IsTimeToRemove (battlebuffunit.lua:283) checks _cancelTime beside _RemoveTime,
      // so a delayed BattleBuffCancelBuff expires the buff on the same path a lifetime
      // does. They stay separate fields because a re-add refreshes one and clears the
      // other — see addBuff.
      const dead = (b) => b.expiresAt <= this.now || b.cancelAt <= this.now;
      const expired = this.buffs.filter(dead);
      if (expired.length) {
        this.buffs = this.buffs.filter((b) => !dead(b));
        for (const b of expired) this.trigger('onRemove', b, null);
      }
      while (ei < events.length && events[ei].t <= this.now) {
        const ev = events[ei++];
        const names = (ev.names || []).filter((n) => RAISED.has(n));
        if (names.length) this.trigger(names, null, ev);
      }
      this.trigger('onUpdate', null, null);
    }
  }

  result() {
    const fired = [];
    for (const row of this.rows.values()) {
      const { _gaps, _n, _last, _burstAt, _burstId, _burstKey, _burstGap,
        statedPeriod, altPeriod, ...out } = row;
      // Four sources, weakest last. The LAST between-burst gap beats their mean
      // because an opener sits in the first one — 잉그레이엄 14720 fires at 3/20/40/60,
      // whose mean gap is 19 against the prose's 20, and 타카라다 릿카 108020 at
      // 5/30/60, mean 27.5 vs 30. `altPeriod` (a quota-bounded edge's own `time`)
      // ranks under the measurement but over the mean, because with no second burst
      // there was no re-add and that `time` is a genuine delay-to-fire; the mean is
      // then the intra-burst stagger, which is what 알자스 150026's eight 0.2 s
      // volleys on one never-lapsing holder correctly report.
      out.period = statedPeriod != null ? statedPeriod
        : _burstGap != null ? _burstGap
          : altPeriod != null ? altPeriod
            : (_n > 0 ? _gaps / _n : 0);
      fired.push(out);
    }
    fired.sort((a, b) => a.skillId.localeCompare(b.skillId) || a.weaponId - b.weaponId);
    return { fired, blocked: [...this.blocked] };
  }
}

/**
 * @param {string[]} rootSkillIds  the skills the engine installs at battle start
 * @param {{window:number,
 *          events:{t:number,names:string[],slot?:number,attr?:string}[],
 *          unit:object}} ctx  `names` is a LIST — one event per (time, slot) carrying
 *   every trigger name that salvo raises. A caller writing `name` instead would have
 *   `(ev.names || [])` silently read empty and drop the event with no error.
 * @param {{b:object, s:object}} graph  fleet_sim_graph.json
 */
export function runBattleSim(rootSkillIds, ctx, graph) {
  if (!graph || !graph.b) return { fired: [], blocked: [] };
  const sim = new Sim(graph, ctx);
  sim.run(rootSkillIds || []);
  return sim.result();
}
