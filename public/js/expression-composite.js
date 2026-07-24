/**
 * expression-composite.js
 * Canvas helpers for seam-free base-painting + face compositing, shared by the
 * skin detail viewer (skin/skin.expression.js) and the story viewer painting
 * renderer (story-viewer/story.painting.js).
 *
 * Why this exists: when a painting exceeds the composite cap, the base (whose
 * face hole has hard-cut alpha edges) is downscaled BEFORE the face is drawn,
 * so the hole edge and the face edge are resampled independently and no longer
 * sum to full opacity — a faint square outline around the face box (~25%
 * background bleed, measured in Chromium 148; visibility depends on the page
 * background and display scale, which is why it looked browser-specific).
 *
 * Fix: composite base + face at NATIVE resolution inside a small patch around
 * the face box, then downscale that one pre-filled patch into place — the hole
 * is filled before any resampling, so no seam can exist. The patch draw is
 * clipped to the box + CLIP_PAD because the patch's outermost resampled band
 * has a truncated filter window and must not overwrite base pixels. Validated
 * pixel-equivalent to a full-frame native-resolution composite, without the
 * full-frame cost (the largest paintings would need a ~484 MB canvas, past
 * browser limits — the very reason the composite cap exists).
 */

// Canvas px the patch draw may extend beyond the face box. Covers the seam
// band (hole/face edges spread ~2px under the cap's worst downscale) while
// keeping the patch's unreliable outer band clipped away.
const CLIP_PAD = 3;

/**
 * Cut the native-resolution neighborhood of the face box out of the decoded
 * base image, while the (possibly huge) decoded image is still in hand. The
 * margin covers CLIP_PAD plus the downscale filter window, both converted to
 * native px, so every pixel inside the later clip region resamples from a
 * full filter window. Returns null at scale 1 — the direct integer-coordinate
 * face draw is already exact there.
 * @param {HTMLImageElement|HTMLCanvasElement} baseImg - decoded base at native size
 * @param {number[]|undefined} box - [x, y, w, h] face box in native px
 * @param {number} scale - composite scale (capped canvas / native size)
 * @returns {{canvas: HTMLCanvasElement, x: number, y: number}|null}
 */
function cutFacePatchBase(baseImg, box, scale) {
    if (!box || scale >= 1) return null;
    const nw = baseImg.naturalWidth || baseImg.width;
    const nh = baseImg.naturalHeight || baseImg.height;
    const [bx, by, bw, bh] = box;
    const m = Math.ceil((CLIP_PAD + 4) / scale) + 8;
    const x = Math.max(0, bx - m);
    const y = Math.max(0, by - m);
    const w = Math.min(nw, bx + bw + m) - x;
    const h = Math.min(nh, by + bh + m) - y;
    if (w <= 0 || h <= 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(baseImg, -x, -y);
    return { canvas, x, y };
}

/**
 * Draw `face` onto a canvas already holding the (possibly downscaled) base.
 * Without a patch (scale 1) the direct draw lands on integer coordinates and
 * is exact. With a patch, base + face are composited 1:1 at native res first,
 * then that pre-filled patch is downscaled into place in ONE resample, clipped
 * to the box + CLIP_PAD.
 * @param {CanvasRenderingContext2D} ctx - target canvas context (base already drawn)
 * @param {HTMLImageElement} face - decoded face image
 * @param {number[]} box - [x, y, w, h] face box in manifest-size space
 * @param {number[]} size - [w, h] manifest size (native painting size)
 * @param {{canvas: HTMLCanvasElement, x: number, y: number}|null} patchBase - from cutFacePatchBase
 */
function drawFaceComposite(ctx, face, box, size, patchBase) {
    const [bx, by, bw, bh] = box;
    const [sw, sh] = size;
    const sx = ctx.canvas.width / sw;
    const sy = ctx.canvas.height / sh;
    ctx.imageSmoothingQuality = 'high';

    if (!patchBase) {
        ctx.drawImage(face, bx * sx, by * sy, bw * sx, bh * sy);
        return;
    }

    const patch = document.createElement('canvas');
    patch.width = patchBase.canvas.width;
    patch.height = patchBase.canvas.height;
    const pctx = patch.getContext('2d');
    pctx.drawImage(patchBase.canvas, 0, 0);
    pctx.drawImage(face, bx - patchBase.x, by - patchBase.y);

    ctx.save();
    ctx.beginPath();
    ctx.rect(bx * sx - CLIP_PAD, by * sy - CLIP_PAD, bw * sx + 2 * CLIP_PAD, bh * sy + 2 * CLIP_PAD);
    ctx.clip();
    ctx.drawImage(patch, patchBase.x * sx, patchBase.y * sy, patch.width * sx, patch.height * sy);
    ctx.restore();
}

export { cutFacePatchBase, drawFaceComposite };
