/**
 * story.effects.js
 * Per-line screen/dialogue/painting shake, flash curtains, multi-phase flashN
 * blink, and timed sound-effect scheduling for the story viewer — extracted
 * from story-viewer.engine.js.
 *
 * These are the visual/audio "effects" a script line can request (line.shakeTime,
 * line.dialogShake, line.shake / line.action[].shake, line.flashN, line.flashout/
 * flashin, line.soundeffect). All mirror the game's storymgr.lua / dialoguestory-
 * player.lua behavior; see each function's doc for the exact data shape.
 *
 * Every function takes the StoryViewer engine instance as an explicit `ctx`
 * argument. Transient effect state (timers, running Web-Animations, lazily-built
 * overlay elements) lives on `ctx` as `_shakeTimer`, `_dialogShakeTimer`,
 * `_paintingShakeTimer`/`_paintingShakeEl`, `_flashNAnims`/`_flashNTimers`/
 * `_flashNOverlay`, `_flashAnims`/`_flashTimers`/`_flashOverlay`, and `_sfxTimer`.
 * The engine exposes clearLineEffects / handleLine* / clearFlashOverlay as thin
 * wrappers; _clearPaintingShake / _ensureFlashNOverlay / _ensureFlashOverlay are
 * module-private. handleLineSoundEffect defers to ctx.playSfx (audio playback
 * stays in the engine).
 */

/**
 * Cancel any in-flight line-level effects (shake/flashN/sfx). Called on
 * non-advance renders so backward nav / jumps / resume don't leave a
 * stale animation playing after the user has moved past its step.
 */
export function clearLineEffects(ctx) {
    // Shake (whole viewer)
    const container = ctx.elements.viewerContainer;
    if (container) {
        clearTimeout(ctx._shakeTimer);
        container.classList.remove('shake');
        container.style.removeProperty('--shake-x');
        container.style.removeProperty('--shake-y');
        container.style.removeProperty('--shake-duration');
        container.style.removeProperty('--shake-iterations');
    }
    // DialogShake (dialogue box only)
    const dbox = ctx.elements.dialogueBox;
    if (dbox) {
        clearTimeout(ctx._dialogShakeTimer);
        dbox.classList.remove('dialog-shake');
        dbox.style.removeProperty('--dialog-shake-x');
        dbox.style.removeProperty('--dialog-shake-duration');
        dbox.style.removeProperty('--dialog-shake-iterations');
    }
    // PaintingShake (character portrait)
    _clearPaintingShake(ctx);
    // FlashN
    if (ctx._flashNAnims) {
        ctx._flashNAnims.forEach(a => { try { a.cancel(); } catch (_) {} });
        ctx._flashNAnims = null;
    }
    if (ctx._flashNTimers) {
        ctx._flashNTimers.forEach(clearTimeout);
        ctx._flashNTimers = null;
    }
    if (ctx._flashNOverlay) ctx._flashNOverlay.style.opacity = '0';
    // Sound effect (cancel pending delayed SFX only; don't interrupt
    // SFX already playing — those finish naturally via their own
    // cleanup in playSfx).
    if (ctx._sfxTimer) { clearTimeout(ctx._sfxTimer); ctx._sfxTimer = null; }
}

/**
 * Apply full-screen shake from `line.shakeTime`.
 *
 * line.shakeTime — number (seconds)
 *   In the game (storyplayer.lua) this plays a looping Unity animation
 *   for the given duration. Only ~27 occurrences across all story data
 *   — reserved for dramatic moments (explosions, impacts).
 *
 * NOTE: `line.shake` is NOT a screen shake — it's a painting shake
 * handled by handleLinePaintingShake(). See storymgr.lua:991-994.
 */
export function handleLineShake(ctx, line) {
    const container = ctx.elements.viewerContainer;
    if (!container) return;

    // Clear any prior shake first so we can re-apply cleanly.
    clearTimeout(ctx._shakeTimer);
    container.classList.remove('shake');
    container.style.removeProperty('--shake-x');
    container.style.removeProperty('--shake-y');
    container.style.removeProperty('--shake-duration');
    container.style.removeProperty('--shake-iterations');

    if (!Number.isFinite(line.shakeTime) || line.shakeTime <= 0) return;

    // Derive iteration count from duration at a moderate cycle pace.
    const perCycleMs = 520;
    const number = Math.max(1, Math.round(line.shakeTime * 1000 / perCycleMs));
    const ampX = ctx.SHAKE_DEFAULT_X_PX;
    const totalMs = Math.min(ctx.SHAKE_MAX_TOTAL_MS, perCycleMs * number);

    container.style.setProperty('--shake-x', `${ampX}px`);
    container.style.setProperty('--shake-y', '0px');
    container.style.setProperty('--shake-duration', `${perCycleMs}ms`);
    container.style.setProperty('--shake-iterations', String(number));
    container.classList.add('shake');

    ctx._shakeTimer = setTimeout(() => {
        container.classList.remove('shake');
        container.style.removeProperty('--shake-x');
        container.style.removeProperty('--shake-y');
        container.style.removeProperty('--shake-duration');
        container.style.removeProperty('--shake-iterations');
    }, totalMs + 20);
}

/**
 * Dialogue-box shake from `line.dialogShake`.
 *
 * Game data shape: { number, speed, x, delay? }
 *   number — cycles of back-and-forth movement
 *   speed  — SECONDS per cycle (fractional, e.g., 0.08, 0.09, 0.12)
 *            NOTE: completely different semantic from line.shake.speed
 *   x      — horizontal amplitude in px (e.g., 8.5, 11, 15)
 *   delay  — optional seconds before start
 *
 * Per dialoguestoryplayer.lua:303 this is `TweenMovex(dialogueWin, x,
 * origX, speed, delay, number)` — it shakes the dialogue box WINDOW
 * horizontally (not the whole screen). Used on emphatic lines to make
 * the textbox jitter as characters shout.
 */
export function handleLineDialogShake(ctx, line) {
    const dbox = ctx.elements.dialogueBox;
    if (!dbox) return;

    clearTimeout(ctx._dialogShakeTimer);
    dbox.classList.remove('dialog-shake');
    dbox.style.removeProperty('--dialog-shake-x');
    dbox.style.removeProperty('--dialog-shake-duration');
    dbox.style.removeProperty('--dialog-shake-iterations');

    const s = line.dialogShake;
    if (!s || typeof s !== 'object') return;

    const number = Math.max(1, parseInt(s.number, 10) || 1);
    const speedSec = Number.isFinite(s.speed) && s.speed > 0 ? s.speed : 0.1;
    const ampX = Number.isFinite(s.x) ? s.x : 10;
    const delayMs = Math.max(0, (s.delay || 0) * 1000);
    const perCycleMs = Math.max(40, speedSec * 1000);
    const totalMs = perCycleMs * number;

    const start = () => {
        dbox.style.setProperty('--dialog-shake-x', `${ampX}px`);
        dbox.style.setProperty('--dialog-shake-duration', `${perCycleMs}ms`);
        dbox.style.setProperty('--dialog-shake-iterations', String(number));
        // Force a reflow so re-adding the class restarts the animation
        // even if the previous run hadn't fully ended yet.
        void dbox.offsetHeight;
        dbox.classList.add('dialog-shake');
        ctx._dialogShakeTimer = setTimeout(() => {
            dbox.classList.remove('dialog-shake');
            dbox.style.removeProperty('--dialog-shake-x');
            dbox.style.removeProperty('--dialog-shake-duration');
            dbox.style.removeProperty('--dialog-shake-iterations');
        }, totalMs + 20);
    };

    if (delayMs > 0) {
        ctx._dialogShakeTimer = setTimeout(start, delayMs);
    } else {
        start();
    }
}

/**
 * Painting/portrait shake from `line.action[]` entries with type="shake".
 *
 * Game data shape (per action entry):
 *   { type:"shake", x, y, dur, number, delay }
 *   x/y   — displacement in px (game coords, scaled down for web)
 *   dur   — seconds per ping-pong cycle
 *   number — how many ping-pong loops
 *   delay — seconds before start
 *
 * In the game this is TweenMove on the character painting with
 * setLoopPingPong. We apply a CSS animation to the painting element
 * on the active speaker's side.
 */
export function handleLinePaintingShake(ctx, line) {
    // Clear any prior painting shake.
    _clearPaintingShake(ctx);

    // Two sources of painting shake (both use LeanTween.move on the
    // painting in storymgr.lua):
    //
    // 1. line.shake = {number, speed, x?, y?}   (storymgr.lua:991-994)
    //    speed is a divisor: duration = 1/speed seconds per tween
    //    x defaults 0, y defaults 10 (game px)
    //
    // 2. line.action[].type="shake" = {x, y, dur, number, delay}
    //    dur is direct duration in seconds    (storymgr.lua:1002-1003)
    //    x defaults 0, y defaults 10 (game px)
    let ampX, ampY, perCycleMs, number, delayMs;

    const actionShake = Array.isArray(line.action)
        ? line.action.find(a => a && a.type === 'shake')
        : null;
    const lineShake = (line.shake && typeof line.shake === 'object') ? line.shake : null;

    if (!actionShake && !lineShake) return;

    // Scale down game coords — game paintings are much larger than the
    // web viewer's painting layer. Use ~15% of the raw value so the
    // effect is noticeable without being jarring.
    const scale = 0.15;

    if (actionShake) {
        // action shake: dur is seconds per tween cycle
        number = Math.max(1, parseInt(actionShake.number, 10) || 2);
        const dur = Number.isFinite(actionShake.dur) && actionShake.dur > 0 ? actionShake.dur : 0.15;
        delayMs = Math.max(0, (actionShake.delay || 0) * 1000);
        ampX = (Number.isFinite(actionShake.x) ? actionShake.x : 0) * scale;
        ampY = (Number.isFinite(actionShake.y) ? actionShake.y : 10) * scale;
        perCycleMs = Math.max(40, dur * 1000);
    } else {
        // line.shake: speed is a divisor → duration = 1/speed seconds
        number = Math.max(1, parseInt(lineShake.number, 10) || 1);
        const speed = Number.isFinite(lineShake.speed) && lineShake.speed > 0 ? lineShake.speed : 1;
        delayMs = 0;
        ampX = (Number.isFinite(lineShake.x) ? lineShake.x : 0) * scale;
        ampY = (Number.isFinite(lineShake.y) ? lineShake.y : 10) * scale;
        perCycleMs = Math.max(40, (1 / speed) * 1000);
    }

    // Find the painting element for the current speaker's side.
    const side = line.side !== undefined ? line.side : 0;
    const paintingInfo = ctx.paintingsBySide.get(side);
    if (!paintingInfo?.element) return;

    const el = paintingInfo.element;
    const totalMs = perCycleMs * number;

    const start = () => {
        el.style.setProperty('--painting-shake-x', `${ampX}px`);
        el.style.setProperty('--painting-shake-y', `${ampY}px`);
        el.style.setProperty('--painting-shake-duration', `${perCycleMs}ms`);
        el.style.setProperty('--painting-shake-iterations', String(number));
        void el.offsetHeight;
        el.classList.add('painting-shake');
        ctx._paintingShakeTimer = setTimeout(() => {
            _clearPaintingShake(ctx);
        }, totalMs + 20);
    };

    ctx._paintingShakeEl = el;
    if (delayMs > 0) {
        ctx._paintingShakeTimer = setTimeout(start, delayMs);
    } else {
        start();
    }
}

/** Clear any in-flight painting shake animation. */
function _clearPaintingShake(ctx) {
    clearTimeout(ctx._paintingShakeTimer);
    ctx._paintingShakeTimer = null;
    const el = ctx._paintingShakeEl;
    if (el) {
        el.classList.remove('painting-shake');
        el.style.removeProperty('--painting-shake-x');
        el.style.removeProperty('--painting-shake-y');
        el.style.removeProperty('--painting-shake-duration');
        el.style.removeProperty('--painting-shake-iterations');
        ctx._paintingShakeEl = null;
    }
}

/**
 * Multi-phase color blink from `line.flashN`.
 *
 * Game data shape: { alpha: [[from, to, dur, delay?], ...], color: [r,g,b] | [r,g,b,a] }
 *   Each alpha entry is one phase: tween opacity from→to over dur
 *   seconds, starting after `delay` seconds (cumulative from t=0, not
 *   between phases — verified against sample data where delays grow
 *   monotonically: 0, 0.2, 0.4, 0.6).
 *   color is normalized RGB(A) 0..1.
 *
 * Uses the dedicated flash-overlay element to avoid conflicting with
 * flashout/flashin curtains (which use story-flash-overlay).
 */
export function handleLineFlashN(ctx, line) {
    // Cancel any previous flashN animation.
    if (ctx._flashNAnims) {
        ctx._flashNAnims.forEach(a => { try { a.cancel(); } catch (_) {} });
        ctx._flashNAnims = null;
    }
    if (ctx._flashNTimers) {
        ctx._flashNTimers.forEach(clearTimeout);
        ctx._flashNTimers = null;
    }

    const fn = line.flashN;
    if (!fn || !Array.isArray(fn.alpha) || fn.alpha.length === 0) {
        // Hide any lingering flashN overlay.
        if (ctx._flashNOverlay) ctx._flashNOverlay.style.opacity = '0';
        return;
    }

    const overlay = _ensureFlashNOverlay(ctx);
    const c = Array.isArray(fn.color) ? fn.color : [1, 1, 1];
    const r = Math.round((c[0] ?? 1) * 255);
    const g = Math.round((c[1] ?? 1) * 255);
    const b = Math.round((c[2] ?? 1) * 255);
    const a = c[3] != null ? c[3] : 1;
    overlay.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${a})`;

    ctx._flashNAnims = [];
    ctx._flashNTimers = [];
    const lineDelay = Math.max(0, (fn.delay || 0) * 1000);

    let maxEndMs = 0;
    fn.alpha.forEach((phase) => {
        if (!Array.isArray(phase) || phase.length < 3) return;
        const [from, to, durSec, delaySec] = phase;
        const durMs = Math.max(0, (durSec || 0) * 1000);
        const startMs = lineDelay + Math.max(0, (delaySec || 0) * 1000);
        if (durMs === 0) return;
        if (startMs + durMs > maxEndMs) maxEndMs = startMs + durMs;

        const startTimer = setTimeout(() => {
            overlay.style.opacity = String(from);
            const anim = overlay.animate(
                [{ opacity: from }, { opacity: to }],
                { duration: durMs, easing: 'ease-in-out', fill: 'forwards' }
            );
            ctx._flashNAnims?.push(anim);
            anim.onfinish = () => { overlay.style.opacity = String(to); };
        }, startMs);
        ctx._flashNTimers.push(startTimer);
    });

    // Cap total so runaway configurations don't leave the screen tinted.
    if (maxEndMs > ctx.FLASH_MAX_TOTAL_MS) maxEndMs = ctx.FLASH_MAX_TOTAL_MS;
    const cleanupTimer = setTimeout(() => {
        overlay.style.opacity = '0';
    }, maxEndMs + 50);
    ctx._flashNTimers.push(cleanupTimer);
}

function _ensureFlashNOverlay(ctx) {
    if (ctx._flashNOverlay) return ctx._flashNOverlay;
    const el = document.createElement('div');
    el.className = 'story-flashn-overlay';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    ctx._flashNOverlay = el;
    return el;
}

/**
 * Play `line.soundeffect` after `line.seDelay` seconds.
 *
 * FMOD event paths ('event:/battle/boom2') can't be loaded as web audio
 * — they reference FMOD Studio event IDs compiled into the game's audio
 * bank. We skip those and play only plain ID paths. (The existing
 * playSfx URL convention is `${BGM_URL_PREFIX}${id}.ogg`.)
 */
export function handleLineSoundEffect(ctx, line) {
    if (ctx._sfxTimer) { clearTimeout(ctx._sfxTimer); ctx._sfxTimer = null; }
    const sfxId = line.soundeffect;
    if (!sfxId || typeof sfxId !== 'string') return;
    if (sfxId.startsWith('event:/')) return; // FMOD event — not available
    const delayMs = Math.max(0, (line.seDelay || 0) * 1000);
    if (delayMs === 0) {
        ctx.playSfx(sfxId);
    } else {
        ctx._sfxTimer = setTimeout(() => {
            ctx._sfxTimer = null;
            ctx.playSfx(sfxId);
        }, delayMs);
    }
}

/**
 * Cancel any in-flight flash animations/timers and reset the overlay
 * to transparent. Used on non-advance renders (back nav, jumps,
 * resume) so we never leave the screen stuck at a mid-fade opacity.
 */
export function clearFlashOverlay(ctx) {
    if (ctx._flashAnims) {
        ctx._flashAnims.forEach(a => { try { a.cancel(); } catch (_) {} });
        ctx._flashAnims = null;
    }
    if (ctx._flashTimers) {
        ctx._flashTimers.forEach(clearTimeout);
        ctx._flashTimers = null;
    }
    if (ctx._flashOverlay) ctx._flashOverlay.style.opacity = '0';
}

/**
 * Animate the step-level flashout/flashin curtain sequence.
 * `flashout` fades a full-screen overlay IN (black or white) and `flashin`
 * fades it OUT, with an optional delay between them. Distinct from the
 * `flashN` multi-phase blink — uses a separate overlay element.
 */
export function handleLineFlash(ctx, line) {
    if (ctx._flashAnims) {
        ctx._flashAnims.forEach(a => { try { a.cancel(); } catch (_) {} });
        ctx._flashAnims = null;
    }
    if (ctx._flashTimers) {
        ctx._flashTimers.forEach(clearTimeout);
        ctx._flashTimers = null;
    }

    if (!line.flashout && !line.flashin) {
        if (ctx._flashOverlay) ctx._flashOverlay.style.opacity = '0';
        return;
    }

    const overlay = _ensureFlashOverlay(ctx);
    ctx._flashAnims = [];
    ctx._flashTimers = [];

    let offset = 0; // ms since this call

    const schedulePhase = (spec) => {
        const a = spec.alpha || [0, 1];
        const durMs = Math.max(0, (spec.dur || 0.5) * 1000);
        const color = spec.black ? 'rgb(0,0,0)' : 'rgb(255,255,255)';
        const startAt = offset;
        // We queue the start with setTimeout so phases run sequentially.
        const startTimer = setTimeout(() => {
            overlay.style.backgroundColor = color;
            // Pin the starting opacity before the animation so we don't
            // see a flash of the wrong intensity.
            overlay.style.opacity = String(a[0]);
            const anim = overlay.animate(
                [{ opacity: a[0] }, { opacity: a[1] }],
                { duration: durMs, easing: 'linear', fill: 'forwards' }
            );
            ctx._flashAnims?.push(anim);
            anim.onfinish = () => {
                // Commit the end opacity inline so removing `fill` later
                // won't snap the overlay back.
                overlay.style.opacity = String(a[1]);
            };
        }, startAt);
        ctx._flashTimers.push(startTimer);
        offset += durMs;
    };

    if (line.flashout) schedulePhase(line.flashout);

    if (line.flashin) {
        const delayMs = Math.max(0, (line.flashin.delay || 0) * 1000);
        offset += delayMs;
        schedulePhase(line.flashin);
    }
}

function _ensureFlashOverlay(ctx) {
    if (ctx._flashOverlay) return ctx._flashOverlay;
    const el = document.createElement('div');
    el.className = 'story-flash-overlay';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    ctx._flashOverlay = el;
    return el;
}
