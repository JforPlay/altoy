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
 * Every function takes the StoryViewer engine instance as an explicit `ctx`
 * argument (state lives on `ctx`: elements, paintingsBySide, currentStoryScript,
 * expressionManifest, scriptIndex, activeOptionFlag, activeSpeakerSide,
 * BASE_URL, PAINTING_FADE_OUT_MS) rather than relying on `this`. The engine
 * exposes getExpressionData / updatePaintings / clearPaintings as thin wrappers;
 * the remaining functions here are module-private helpers.
 */

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

/**
 * Rebuild the painting state for the current script position and apply
 * it to the DOM. Mirrors the game's dialoguestoryplayer.lua model:
 *
 *   - Each side (0=LEFT, 1=RIGHT, 2=CENTER) holds at most one painting.
 *   - When a new step lands on CENTER, LEFT and RIGHT paintings are
 *     cleared (game's GetRecycleActorList rule for SIDE_MIDDLE).
 *   - Lines with `hideOther:true`, `hidePainting:true`, or no renderable
 *     actor clear ALL sides (game's hidePainting/actor==nil path).
 *   - `paintingFadeOut = {side, time}` MOVES the previous painting from
 *     its current side to the specified side.
 *   - The active speaker's painting is at alpha=1.0.
 *   - All other paintings dim to the CURRENT step's `painting.alpha`
 *     (the game fades prev speakers to the current step's alpha).
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

function computePaintingStateAt(ctx, index) {
    /** @type {Map<number, {actorId:number, side:number, dir:number, expression:string, paintingNoise:boolean}>} */
    const paintings = new Map();
    let activeSide = null;
    let dimAlpha = 1; // non-speakers get this alpha (set by latest step with painting.alpha)
    let prevSide = null; // side of the previously-placed painting (for paintingFadeOut)

    const resolveActor = (line) => {
        if (typeof line.actor === 'number') return line.actor;
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

        const actorId = resolveActor(line);
        const hasRenderableActor = actorId != null && getExpressionData(ctx, actorId) != null;
        const hideAll =
            line.hideOther === true ||
            line.hidePainting === true ||
            (line.actor === undefined && line.actorName === undefined);

        if (hideAll) {
            paintings.clear();
            activeSide = null;
            prevSide = null;
            continue;
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
        const expression = line.expression !== undefined ? String(line.expression) : '0';
        const paintingNoise = line.paintingNoise === true;

        if (line.painting?.alpha !== undefined) dimAlpha = line.painting.alpha;

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

    return { paintings, activeSide, dimAlpha };
}

/**
 * Reconcile the DOM with a target painting state. Paintings already
 * matching by (side, actorId) are updated in place; mismatches are
 * evicted and replaced. Opacity is set so the active speaker is fully
 * visible (1.0) and every other painting is dimmed to dimAlpha.
 */
function applyPaintingState(ctx, target) {
    const { paintings: targetMap, activeSide, dimAlpha } = target;

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
                updatePaintingExpression(current.element, expressionData, want.expression);
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
                fadeInSec: 0.25,
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
        // Touch offsetHeight to flush the '0' baseline if present.
        if (p.element.style.getPropertyValue('--painting-opacity') === '0') {
            void p.element.offsetHeight; // force reflow
        }
        const isActive = side === activeSide;
        p.element.classList.toggle('active', isActive);
        p.element.classList.toggle('inactive', !isActive);
        p.element.style.setProperty('--painting-opacity', isActive ? 1 : dimAlpha);
    }
}

/**
 * Build a detached painting-container DOM node. Alpha is controlled
 * entirely by --painting-opacity (set by applyPaintingState); this
 * function only handles the initial fade-in from 0 to the target alpha.
 */
function createPaintingContainer({ actorId, side, dir, expressionData, expression,
                                  hasNoise, fadeInSec }) {
    const container = document.createElement('div');
    container.className = 'painting-container';
    container.dataset.side = side;
    container.dataset.dir = dir;
    container.dataset.actorId = actorId;
    if (hasNoise) container.classList.add('painting-noise');

    if (fadeInSec && fadeInSec > 0) {
        // Seed the custom property to 0 so the CSS-driven transition
        // animates up to whatever applyPaintingState() sets next frame.
        container.style.setProperty('--painting-opacity', 0);
        container.style.transition = `opacity ${fadeInSec}s ease-in`;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'painting-image-wrapper';
    // Publish the painting's natural dimensions so CSS can compute a
    // box that matches the rendered image exactly (see .painting-image-
    // wrapper rules). Face overlay percentages are derived from these
    // same dims, so aligning wrapper to image guarantees face placement.
    if (expressionData.size && expressionData.size[0] && expressionData.size[1]) {
        const [imgW, imgH] = expressionData.size;
        wrapper.style.setProperty('--painting-w', String(imgW));
        wrapper.style.setProperty('--painting-h', String(imgH));
        wrapper.style.aspectRatio = `${imgW} / ${imgH}`;
    }

    const baseImg = document.createElement('img');
    baseImg.className = 'painting-base';
    baseImg.src = expressionData.baseUrl;
    baseImg.alt = '';
    baseImg.loading = 'eager';
    wrapper.appendChild(baseImg);

    if (expressionData.faces && expressionData.faces.length > 0) {
        const faceImg = document.createElement('img');
        faceImg.className = 'painting-face-overlay';
        const defaultFaceId = expressionData.faces[0] || '0';
        faceImg.src = expressionData.faceUrlTemplate.replace('{faceId}', expression);
        faceImg.alt = '';
        faceImg.loading = 'eager';

        faceImg.addEventListener('error', () => {
            const defaultSrc = expressionData.faceUrlTemplate.replace('{faceId}', defaultFaceId);
            if (faceImg.src !== defaultSrc) {
                faceImg.src = defaultSrc;
            } else {
                faceImg.style.display = 'none';
            }
        }, { once: true });

        // Positioning uses percentages, so we can set it immediately —
        // no need to wait for the base image to load.
        applyFaceOverlayPosition(faceImg, expressionData);

        wrapper.appendChild(faceImg);
    }

    container.appendChild(wrapper);
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

/**
 * Apply face overlay positioning based on expression data.
 *
 * The face overlay is positioned relative to the painting-image-wrapper,
 * which sizes itself to the rendered base image. Using percentages of the
 * original image dimensions therefore maps 1:1 to percentages of the
 * rendered image — it's automatic, aspect-ratio-correct, and doesn't
 * depend on offsetWidth/offsetHeight being resolved at load time (which
 * can return 0 or stale values if layout hasn't settled).
 */
function applyFaceOverlayPosition(faceImg, expressionData /*, baseImg */) {
    if (!expressionData.box || !expressionData.size) return;
    const [x, y, w, h] = expressionData.box;
    const [imgW, imgH] = expressionData.size;
    if (!imgW || !imgH) return;

    faceImg.style.left = `${(x / imgW) * 100}%`;
    faceImg.style.top = `${(y / imgH) * 100}%`;
    faceImg.style.width = `${(w / imgW) * 100}%`;
    faceImg.style.height = `${(h / imgH) * 100}%`;
}

/**
 * Swap the face overlay src on an existing painting container when only
 * the expression changes (actor and side are the same). Falls back to the
 * default face ID if the requested expression image fails to load.
 */
function updatePaintingExpression(container, expressionData, newExpression) {
    const faceImg = container.querySelector('.painting-face-overlay');
    if (!faceImg) return;

    faceImg.style.display = '';

    const newSrc = expressionData.faceUrlTemplate.replace('{faceId}', newExpression);
    const defaultFaceId = expressionData.faces?.[0] || '0';
    const defaultSrc = expressionData.faceUrlTemplate.replace('{faceId}', defaultFaceId);

    faceImg.src = newSrc;
    faceImg.onerror = () => {
        if (faceImg.src !== defaultSrc) {
            faceImg.src = defaultSrc;
        } else {
            faceImg.style.display = 'none';
        }
    };
}

/** Clear all paintings when starting a new story. */
export function clearPaintings(ctx) {
    if (ctx.elements.paintingLayer) {
        ctx.elements.paintingLayer.textContent = '';
    }
    ctx.paintingsBySide.clear();
    ctx.activeSpeakerSide = null;
}
