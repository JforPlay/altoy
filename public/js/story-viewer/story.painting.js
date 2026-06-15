/**
 * story.painting.js
 * Painting & expression rendering for the story viewer — extracted from
 * story-viewer.engine.js.
 *
 * Mirrors the game's dialoguestoryplayer.lua painting model: at most one
 * painting per side (0=LEFT, 1=RIGHT, 2=CENTER), rebuilt from the script on
 * every render so Back/Resume navigation always produces the correct visual
 * state without "undoing" transitions.
 *
 * Rendering composites base painting + face onto a single <canvas> at native
 * resolution (same approach as skin.expression.js): the extracted base has a
 * transparent face hole, and stacking two separately-scaled <img>s leaves a
 * semi-transparent seam where their downscaled edges meet. One canvas draw,
 * scaled once by CSS, can't reopen it.
 *
 * Every function takes the StoryViewer engine instance as an explicit `ctx`
 * argument (state lives on `ctx`: elements, paintingsBySide, currentStoryScript,
 * expressionManifest, scriptIndex, activeOptionFlag, activeSpeakerSide,
 * BASE_URL, PAINTING_FADE_OUT_MS) rather than relying on `this`. The engine
 * exposes getExpressionData / updatePaintings / clearPaintings as thin wrappers.
 * computePaintingStateAt is exported for node tests — it reads only plain data
 * off ctx and touches no DOM.
 */

import { pickFaceCandidates } from '../expression-face.js';

// =========================================================================
// Expression manifest lookup
// =========================================================================

/**
 * Look up expression manifest data for a character.
 * Prefers painting_n (zoomed variant used in story mode) over the
 * standard painting, and returns null if neither variant is present.
 */
export function getExpressionData(ctx, actorId) {
    if (!actorId || !ctx.expressionManifest) return null;

    const idStr = String(actorId);

    // First try painting_n (zoomed version, used in story mode)
    const paintingN = ctx.expressionManifest[`${idStr}_n`];
    if (paintingN) {
        return {
            ...paintingN,
            type: 'painting_n',
            baseUrl: `${ctx.BASE_URL}output_expressions/${idStr}/painting_n.png`,
            faceUrlTemplate: `${ctx.BASE_URL}output_expressions/${idStr}/painting_n_face_{faceId}.png`
        };
    }

    // Fall back to regular painting
    const painting = ctx.expressionManifest[idStr];
    if (painting) {
        return {
            ...painting,
            type: 'painting',
            baseUrl: `${ctx.BASE_URL}output_expressions/${idStr}/painting.png`,
            faceUrlTemplate: `${ctx.BASE_URL}output_expressions/${idStr}/painting_face_{faceId}.png`
        };
    }

    return null;
}

// =========================================================================
// Painting state (pure — node-testable)
// =========================================================================

/**
 * Rebuild the painting state for the current script position and apply
 * it to the DOM. Mirrors the game's dialoguestoryplayer.lua model:
 *
 *   - Each side (0=LEFT, 1=RIGHT, 2=CENTER) holds at most one painting.
 *   - When a new step lands on CENTER, LEFT and RIGHT paintings are
 *     cleared (game's GetRecycleActorList rule for SIDE_MIDDLE).
 *   - `withoutPainting:true`, `hidePainting:true`, or no actor/actorName
 *     clear ALL sides and render nothing (DialogueStep.Ctor :127-139 nulls
 *     the actor for all three; `hidePainting` keeps only the name box).
 *   - `hideOther:true` clears ALL sides but the current speaker is then
 *     re-rendered (GetRecycleActorList :102-107 recycles everything, then
 *     UpdatePainting reloads the current step's painting).
 *   - `paintingFadeOut = {side, time}` MOVES the previous painting from
 *     its current side to the specified side.
 *   - The active speaker's painting is at alpha=1.0.
 *   - All other paintings dim to the CURRENT step's `painting.alpha`,
 *     default 0.3 over `painting.time` (default 1s) — GetPaintingData
 *     defaults apply even when the step carries no painting field.
 *
 * We rebuild the full state on every render rather than tracking deltas
 * so that Back/Resume navigation always produces the correct visual
 * state without needing to "undo" transitions.
 */
export function updatePaintings(ctx) {
    if (!ctx.elements.paintingLayer) return;
    const target = computePaintingStateAt(ctx, ctx.scriptIndex);
    applyPaintingState(ctx, target);
}

export function computePaintingStateAt(ctx, index) {
    /** @type {Map<number, {actorId:number, side:number, dir:number, expression:string, paintingNoise:boolean}>} */
    const paintings = new Map();
    let activeSide = null;
    let dimAlpha = 0.3; // game default: GetPaintingData → alpha or 0.3
    let dimTime = 1;    // game default: GetPaintingData → time or 1 (seconds)
    let prevSide = null; // side of the previously-placed painting (for paintingFadeOut)

    const resolveActor = (line) => {
        if (typeof line.actor === 'number') return line.actor;
        // The pipeline emits actor/actorName as numeric STRINGS when the raw
        // value carried a {namecode:N} placeholder it resolved to a ship id.
        if (typeof line.actor === 'string' && !isNaN(parseInt(line.actor, 10))) {
            return parseInt(line.actor, 10);
        }
        if (line.actorName && !isNaN(parseInt(line.actorName, 10))) {
            return parseInt(line.actorName, 10);
        }
        return null;
    };

    // In branching stories, skip lines that aren't reachable in the
    // currently-selected branch. Matches the nav-cache logic: when
    // activeOptionFlag is null we only include unflagged lines; when
    // a flag is active we include unflagged lines and lines with
    // matching flag.
    const activeFlag = ctx.activeOptionFlag;
    const lineReachable = (line) => {
        if (line.optionFlag === undefined) return true;
        return activeFlag !== null && line.optionFlag === activeFlag;
    };

    for (let i = 0; i <= index && i < ctx.currentStoryScript.length; i++) {
        const line = ctx.currentStoryScript[i];
        if (!line) continue;
        if (!lineReachable(line)) continue;

        // withoutPainting / hidePainting / narration → hide everything,
        // including the current speaker (the game nulls the actor).
        const hideAll =
            line.withoutPainting === true ||
            line.hidePainting === true ||
            (line.actor === undefined && line.actorName === undefined);

        if (hideAll) {
            paintings.clear();
            activeSide = null;
            prevSide = null;
            continue;
        }

        // hideOther → clear every side, then fall through so the current
        // speaker's painting is placed fresh (game re-renders it).
        if (line.hideOther === true) {
            paintings.clear();
            prevSide = null;
        }

        const actorId = resolveActor(line);
        const hasRenderableActor = actorId != null && getExpressionData(ctx, actorId) != null;

        // Dim parameters come from the CURRENT step (defaults apply when the
        // painting field is absent — Lua GetPaintingData).
        if (actorId != null) {
            dimAlpha = line.painting?.alpha ?? 0.3;
            dimTime = line.painting?.time ?? 1;
        }

        // Actor exists but has no expression data (missing from manifest).
        // Don't clear other paintings — just skip painting placement and
        // update the active speaker side for dimming.
        if (!hasRenderableActor) {
            activeSide = line.side !== undefined ? line.side : null;
            continue;
        }

        const targetSide = line.side !== undefined ? line.side : 0;
        const dir = line.dir !== undefined ? line.dir : 1;
        // No expression on the step → null sentinel. pickFaceCandidates then
        // ranks the manifest `default` first; coercing to '0' here would
        // shadow it (face '0' outranks `default` when both exist).
        const expression = line.expression != null ? String(line.expression) : null;
        const paintingNoise = line.paintingNoise === true;

        // paintingFadeOut: move the previously-placed painting to a new side.
        // This runs BEFORE recycle, so the moved painting survives the recycle pass.
        let movedToSide = null;
        if (line.paintingFadeOut && prevSide !== null && prevSide !== targetSide) {
            const fadeDest = line.paintingFadeOut.side;
            const prevPainting = paintings.get(prevSide);
            if (prevPainting && fadeDest !== targetSide) {
                paintings.delete(prevSide);
                paintings.delete(fadeDest); // overwrite anything at the destination
                paintings.set(fadeDest, { ...prevPainting, side: fadeDest });
                movedToSide = fadeDest;
            }
        }

        // Recycle: replace the target side if a different actor is there;
        // CENTER additionally clears LEFT and RIGHT (game rule).
        const existing = paintings.get(targetSide);
        if (existing && existing.actorId !== actorId) paintings.delete(targetSide);
        if (targetSide === 2) {
            if (movedToSide !== 0) paintings.delete(0);
            if (movedToSide !== 1) paintings.delete(1);
        }

        // Place (or update) the new painting on the target side.
        paintings.set(targetSide, {
            actorId, side: targetSide, dir, expression, paintingNoise,
        });

        activeSide = targetSide;
        prevSide = targetSide;
    }

    return { paintings, activeSide, dimAlpha, dimTime };
}

// =========================================================================
// Canvas compositing (same approach as skin.expression.js)
// =========================================================================

// Composite at native resolution so face/hole edges align pixel-perfect;
// CSS then scales the single composite. Past this dim a canvas risks
// browser limits and composites to blank.
const MAX_COMPOSITE_DIM = 4096;
// Decoded base canvases are ~16 MB each at 2048² — keep only a few. Story
// navigation evicts/recreates containers constantly, so caching by URL is
// what makes Back/expression swaps cheap.
const BASE_CANVAS_CACHE_MAX = 4;
const baseCanvasCache = new Map(); // baseUrl -> Promise<HTMLCanvasElement>

/**
 * Load an image cross-origin. crossOrigin is set before src so the response
 * is CORS-enabled and a canvas drawn from it stays untainted.
 */
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`failed to load ${url}`));
        img.src = url;
    });
}

/** Decode the base painting once into an offscreen canvas at composite resolution. */
async function buildBaseCanvas(url) {
    const base = await loadImage(url);
    const nw = base.naturalWidth;
    const nh = base.naturalHeight;
    if (!nw || !nh) throw new Error('base painting has no dimensions');

    const scale = Math.min(1, MAX_COMPOSITE_DIM / Math.max(nw, nh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(nw * scale);
    canvas.height = Math.round(nh * scale);
    const c2d = canvas.getContext('2d');
    c2d.imageSmoothingQuality = 'high';
    c2d.drawImage(base, 0, 0, canvas.width, canvas.height);
    return canvas;
}

/** Get (or build) the cached base canvas for a painting URL. LRU on access. */
function getBaseCanvas(url) {
    let promise = baseCanvasCache.get(url);
    if (promise) {
        // Refresh recency (Map iteration order doubles as the LRU order).
        baseCanvasCache.delete(url);
        baseCanvasCache.set(url, promise);
        return promise;
    }
    promise = buildBaseCanvas(url);
    promise.catch(() => baseCanvasCache.delete(url)); // don't cache failures
    baseCanvasCache.set(url, promise);
    if (baseCanvasCache.size > BASE_CANVAS_CACHE_MAX) {
        baseCanvasCache.delete(baseCanvasCache.keys().next().value);
    }
    return promise;
}

// pickFaceCandidates lives in ../expression-face.js now (shared with the skin pages);
// imported at the top of this file.

/**
 * Resolve the dialog-portrait face URL for a speaker's expression data and
 * the step's raw `expression` value (number, string, or absent). Runs the
 * SAME candidate chain as the painting compositor so the dialog face and
 * the mid-screen face can't drift apart. Returns null when the painting has
 * no usable face (caller falls back to the ship icon). Pure — node-testable.
 */
export function resolvePortraitFaceUrl(expressionData, expression) {
    if (!expressionData) return null;
    const candidates = pickFaceCandidates(
        expressionData,
        expression != null ? String(expression) : null
    );
    return candidates.length
        ? expressionData.faceUrlTemplate.replace('{faceId}', candidates[0])
        : null;
}

/**
 * Draw base painting + face for `expression` onto the container's <canvas>.
 * Face candidates come from pickFaceCandidates; later candidates are only
 * tried if an earlier fetch fails (stale manifest). A per-canvas generation
 * counter discards superseded runs (rapid expression swaps / navigation).
 */
async function composePainting(container, expressionData, expression) {
    const canvas = container.querySelector('canvas.painting-base');
    if (!canvas) return;
    const gen = (canvas._gen = (canvas._gen || 0) + 1);

    let baseCanvas;
    try {
        baseCanvas = await getBaseCanvas(expressionData.baseUrl);
    } catch (e) {
        console.warn('Painting base load failed', e);
        return;
    }
    if (gen !== canvas._gen) return;

    // Resolve the face image, falling back through the candidate chain.
    let face = null;
    if (expressionData.faces && expressionData.faces.length > 0) {
        const candidates = pickFaceCandidates(expressionData, expression);
        for (const faceId of candidates) {
            try {
                face = await loadImage(expressionData.faceUrlTemplate.replace('{faceId}', faceId));
                break;
            } catch (_) { /* try next candidate */ }
        }
        if (gen !== canvas._gen) return;
    }

    if (canvas.width !== baseCanvas.width || canvas.height !== baseCanvas.height) {
        canvas.width = baseCanvas.width;
        canvas.height = baseCanvas.height;
    }
    const c2d = canvas.getContext('2d');
    c2d.clearRect(0, 0, canvas.width, canvas.height);
    c2d.drawImage(baseCanvas, 0, 0);

    if (face && expressionData.box && expressionData.size) {
        const [bx, by, bw, bh] = expressionData.box;
        const [sw, sh] = expressionData.size;
        // box is in manifest-size space; scale it into the (capped) canvas.
        const sx = canvas.width / sw;
        const sy = canvas.height / sh;
        c2d.imageSmoothingQuality = 'high';
        c2d.drawImage(face, bx * sx, by * sy, bw * sx, bh * sy);
    }
}

// =========================================================================
// DOM reconciliation
// =========================================================================

/**
 * Reconcile the DOM with a target painting state. Paintings already
 * matching by (side, actorId) are updated in place; mismatches are
 * evicted and replaced. Opacity is set so the active speaker is fully
 * visible (1.0) and every other painting is dimmed to dimAlpha.
 */
function applyPaintingState(ctx, target) {
    const { paintings: targetMap, activeSide, dimAlpha, dimTime } = target;

    // Evict paintings that don't belong in the target state.
    const currentSides = Array.from(ctx.paintingsBySide.keys());
    for (const side of currentSides) {
        const current = ctx.paintingsBySide.get(side);
        const want = targetMap.get(side);
        if (!want || want.actorId !== current.actorId) {
            evictSidePainting(ctx, side);
        }
    }

    // Create or update paintings to match the target.
    for (const [side, want] of targetMap) {
        const current = ctx.paintingsBySide.get(side);
        const expressionData = getExpressionData(ctx, want.actorId);
        if (!expressionData) continue;

        if (current && current.actorId === want.actorId) {
            // Same actor, same side — reuse the element and update fields.
            if (current.expression !== want.expression) {
                composePainting(current.element, expressionData, want.expression);
                current.expression = want.expression;
            }
            if (current.dir !== want.dir) {
                current.element.dataset.dir = want.dir;
                current.dir = want.dir;
            }
            current.element.classList.toggle('painting-noise', want.paintingNoise);
        } else {
            const container = createPaintingContainer({
                actorId: want.actorId,
                side: want.side,
                dir: want.dir,
                expressionData,
                expression: want.expression,
                hasNoise: want.paintingNoise,
            });
            ctx.elements.paintingLayer.appendChild(container);
            ctx.paintingsBySide.set(side, {
                actorId: want.actorId,
                element: container,
                expression: want.expression,
                side: want.side,
                dir: want.dir,
            });
        }
    }

    // Apply speaker highlight: active = 1.0, others = dimAlpha.
    //
    // Newly-created containers were seeded with --painting-opacity: 0
    // for fade-in. The browser may batch style writes into a single
    // frame, which would skip the 0 state and show no animation. We
    // force a layout read on the new containers to commit the 0, then
    // set the real opacity so the CSS transition runs. Existing
    // containers update immediately — no flash possible there.
    ctx.activeSpeakerSide = activeSide;
    for (const [side, p] of ctx.paintingsBySide) {
        const isNew = p.element.style.getPropertyValue('--painting-opacity') === '0';
        if (isNew) {
            void p.element.offsetHeight; // force reflow to flush the '0' baseline
        }
        // New paintings fade in over the game's fadeInPaintingTime default
        // (0.15s); dim changes on existing paintings run at the current
        // step's painting.time (default 1s — Lua GetPaintingData).
        p.element.style.setProperty('--painting-fade-duration', isNew ? '0.15s' : `${dimTime}s`);
        const isActive = side === activeSide;
        p.element.classList.toggle('active', isActive);
        p.element.classList.toggle('inactive', !isActive);
        p.element.style.setProperty('--painting-opacity', isActive ? 1 : dimAlpha);
    }
}

/**
 * Build a detached painting-container DOM node holding the composite
 * <canvas>. Alpha is controlled entirely by --painting-opacity (set by
 * applyPaintingState); the container is seeded at 0 for the fade-in.
 */
function createPaintingContainer({ actorId, side, dir, expressionData, expression, hasNoise }) {
    const container = document.createElement('div');
    container.className = 'painting-container';
    container.dataset.side = side;
    container.dataset.dir = dir;
    container.dataset.actorId = actorId;
    if (hasNoise) container.classList.add('painting-noise');

    // Seed the custom property to 0 so the CSS-driven transition
    // animates up to whatever applyPaintingState() sets next frame.
    container.style.setProperty('--painting-opacity', 0);

    const wrapper = document.createElement('div');
    wrapper.className = 'painting-image-wrapper';
    // Publish the painting's natural dimensions so CSS can compute a box
    // that matches the rendered composite exactly (see .painting-image-
    // wrapper rules).
    if (expressionData.size && expressionData.size[0] && expressionData.size[1]) {
        const [imgW, imgH] = expressionData.size;
        wrapper.style.setProperty('--painting-w', String(imgW));
        wrapper.style.setProperty('--painting-h', String(imgH));
        wrapper.style.aspectRatio = `${imgW} / ${imgH}`;
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'painting-base';
    canvas.setAttribute('role', 'img');
    wrapper.appendChild(canvas);
    container.appendChild(wrapper);

    // After appendChild — composePainting locates the canvas via the container.
    composePainting(container, expressionData, expression);

    return container;
}

/**
 * Fade out and remove the painting currently on `side`.
 */
function evictSidePainting(ctx, side) {
    const existing = ctx.paintingsBySide.get(side);
    if (!existing) return;
    const el = existing.element;
    el.style.transition = `opacity ${ctx.PAINTING_FADE_OUT_MS}ms ease-out`;
    el.style.opacity = '0';
    const removeAfter = ctx.PAINTING_FADE_OUT_MS + 20;
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, removeAfter);
    ctx.paintingsBySide.delete(side);
}

/** Clear all paintings when starting a new story. */
export function clearPaintings(ctx) {
    if (ctx.elements.paintingLayer) {
        ctx.elements.paintingLayer.textContent = '';
    }
    ctx.paintingsBySide.clear();
    ctx.activeSpeakerSide = null;
}
