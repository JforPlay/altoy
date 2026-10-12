/**
 * story.frames.js
 * Game-accurate story painting placement. The game never fits a painting to the
 * screen: setPaintingPrefab(slot, name, "duihua") attaches PaintingScaler, which
 * fits the painting prefab's hand-authored frameContain/duihua rect into the
 * actor slot (ui/newstoryui: 647x700, fitter scale 0.9) and lets the rest of the
 * canvas overflow the screen. painting_frames.json carries each rect in
 * painting.png pixels ([x, y, w, h, W, H]); this module is the math, pure.
 * Validated on I404 (dev/active/2026-10-11-story-reader-rework-assets/).
 */
import { fetchJSONWithCache } from '../utils.js';

export const STAGE_W = 1920;
export const STAGE_H = 1080;
const SLOT_W = 647;
const SLOT_H = 700;
const FITTER_SCALE = 0.9;
const SLOT_CY = STAGE_H / 2 + 15;                 // slot anchoredPosition y = -15 (Unity y up)
const SLOT_CX = { 0: STAGE_W / 2 - 591, 1: STAGE_W / 2 + 591, 2: STAGE_W / 2 };
const FIT_MARGIN = 1.04;                         // breathing room beside the outermost frame

let framesPromise = null;

/**
 * Fetch painting_frames.json once per page (first story playback, never boot).
 * A failure resolves null — every painting then uses the fit fallback — and
 * the next call retries.
 * @returns {Promise<object|null>}
 */
export function ensurePaintingFrames() {
    framesPromise ??= fetchJSONWithCache('data/skin/painting_frames.json')
        .then((d) => (d && typeof d === 'object' && !Array.isArray(d)) ? d : null)
        .catch((err) => { console.warn('Painting frames missing', err); framesPromise = null; return null; });
    return framesPromise;
}

/**
 * Where a story painting sits on the 1920x1080 stage (y down). `focus` is the
 * [x0, x1] span that must stay on screen: the duihua rect when there is one,
 * else the whole painting.
 * @param {{frame:number[]|null, size:number[], side:number, dir?:number,
 *          actorPosition?:{x?:number,y?:number}|null, actorScale?:number|null}} p
 * @returns {{left:number, top:number, width:number, height:number, flip:boolean, scale:number, focus:number[]}}
 */
export function framePlacement({ frame, size, side, dir = 1, actorPosition = null, actorScale = null }) {
    const [W, H] = size;
    const k = Math.abs(actorScale ?? 1) || 1;
    const cx = (SLOT_CX[side] ?? SLOT_CX[2]) + (actorPosition?.x ?? 0);
    const cy = SLOT_CY - (actorPosition?.y ?? 0);
    let scale, left, top, focus;
    if (frame) {
        const [fx, fy, fw, fh] = frame;
        scale = FITTER_SCALE * Math.min(SLOT_W / fw, SLOT_H / fh) * k;
        left = cx - (fx + fw / 2) * scale;
        top = cy - (fy + fh / 2) * scale;
        focus = [cx - (fw * scale) / 2, cx + (fw * scale) / 2]; // centred on cx, so a flip keeps it
    } else {
        // No duihua rect (stale or missing frames file): bottom-anchored fit, the
        // pre-rework look — never hide a painting because its frame is unknown.
        scale = Math.min((STAGE_H * 0.92) / H, ((side === 2 ? 0.7 : 0.45) * STAGE_W) / W) * k;
        left = cx - (W * scale) / 2;
        top = STAGE_H - H * scale;
    }
    const width = W * scale;
    const flip = dir === -1;
    if (flip) left = 2 * cx - left - width;          // mirror about the slot centre
    focus ??= [left, left + width];
    return { left, top, width, height: H * scale, flip, scale, focus };
}

/**
 * How much of the stage's width the painting layer must show, in stage px about
 * the centre, so every painting's focus span fits across the viewer. The layer
 * shrinks to this on a viewer narrower than it (CSS --need) — a phone shows two
 * side slots small instead of cropping both off — and never shows past the
 * game's stage. Null with nothing on stage.
 * @param {number[][]} spans - focus spans from framePlacement
 * @returns {number|null}
 */
export function fitWidth(spans) {
    if (!spans.length) return null;
    const half = Math.max(...spans.flat().map((x) => Math.abs(x - STAGE_W / 2)));
    return Math.min(STAGE_W, 2 * half * FIT_MARGIN);
}

/**
 * How far past the stage's top and bottom a layer fitted to `need` shows on a
 * w x h viewer, in stage px — 0 when the layer still covers it. Rounded up to
 * quarter-stage steps so a resize recomposes once per step, not per pixel.
 * @returns {number}
 */
export function fitPad(need, w, h) {
    const extra = need && w && h ? ((need * h) / w - STAGE_H) / 2 : 0;
    return extra > 0 ? Math.ceil(extra / (STAGE_H / 4)) * (STAGE_H / 4) : 0;
}

/**
 * The part of a placed painting that can be on the 16:9 stage, as an integer
 * crop in painting px plus the stage box that crop occupies. Cropping BEFORE the
 * 4096 px composite cap keeps zoomed-in paintings sharp. Null when off-stage.
 * `pad` (fitPad) widens the vertical bounds: a fitted layer is shorter than the
 * viewer, so cropping at the stage's own top and bottom would show hard cuts.
 * @returns {{x:number,y:number,w:number,h:number,left:number,top:number,width:number,height:number}|null}
 */
export function visibleCrop({ left, top, width, height, flip }, [W, H], pad = 0) {
    const s = width / W;
    const ax = Math.max(0, left), bx = Math.min(STAGE_W, left + width);
    const ay = Math.max(-pad, top), by = Math.min(STAGE_H + pad, top + height);
    if (bx <= ax || by <= ay) return null;
    let u0 = (ax - left) / s, u1 = (bx - left) / s;
    if (flip) [u0, u1] = [W - u1, W - u0];
    const x = Math.max(0, Math.floor(u0));
    const y = Math.max(0, Math.floor((ay - top) / s));
    const w = Math.min(W, Math.ceil(u1)) - x;
    const h = Math.min(H, Math.ceil((by - top) / s)) - y;
    return {
        x, y, w, h,
        left: flip ? left + (W - (x + w)) * s : left + x * s,
        top: top + y * s,
        width: w * s,
        height: h * s,
    };
}
