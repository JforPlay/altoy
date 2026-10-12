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
 * Where a story painting sits on the 1920x1080 stage (y down).
 * @param {{frame:number[]|null, size:number[], side:number, dir?:number,
 *          actorPosition?:{x?:number,y?:number}|null, actorScale?:number|null}} p
 * @returns {{left:number, top:number, width:number, height:number, flip:boolean, scale:number}}
 */
export function framePlacement({ frame, size, side, dir = 1, actorPosition = null, actorScale = null }) {
    const [W, H] = size;
    const k = Math.abs(actorScale ?? 1) || 1;
    const cx = (SLOT_CX[side] ?? SLOT_CX[2]) + (actorPosition?.x ?? 0);
    const cy = SLOT_CY - (actorPosition?.y ?? 0);
    let scale, left, top;
    if (frame) {
        const [fx, fy, fw, fh] = frame;
        scale = FITTER_SCALE * Math.min(SLOT_W / fw, SLOT_H / fh) * k;
        left = cx - (fx + fw / 2) * scale;
        top = cy - (fy + fh / 2) * scale;
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
    return { left, top, width, height: H * scale, flip, scale };
}

/**
 * The part of a placed painting that can be on the 16:9 stage, as an integer
 * crop in painting px plus the stage box that crop occupies. Cropping BEFORE the
 * 4096 px composite cap keeps zoomed-in paintings sharp. Null when off-stage.
 * @returns {{x:number,y:number,w:number,h:number,left:number,top:number,width:number,height:number}|null}
 */
export function visibleCrop({ left, top, width, height, flip }, [W, H]) {
    const s = width / W;
    const ax = Math.max(0, left), bx = Math.min(STAGE_W, left + width);
    const ay = Math.max(0, top), by = Math.min(STAGE_H, top + height);
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
