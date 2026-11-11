/**
 * shipgirl-relations.canvas.js
 * Canvas 2D renderer and pointer handling for the 함순이 관계도 map: nation
 * "countries", class "provinces", relationship lines and shipgirl nodes, with
 * wheel/drag/pinch zoom and level-of-detail icons and labels. No library.
 * Owned by shipgirl-relations.js, which passes the parsed model and callbacks.
 */
import { nationColor, SOURCE_COLOR, visibleLinks } from './shipgirl-relations.model.js';
import {
    fitCamera, zoomAt, toScreen, toWorld, hitNode, pointInHull, rectsOverlap, rectHitsCircle, pinLabel,
    CLASS_LABEL_ZOOM,
} from './shipgirl-relations.camera.js';
import { dataForToyUrl, onThemeChange } from '../utils.js';

const ICON_MIN_PX = 7;     // node radius on screen before its icon loads
const LABEL_MIN_PX = 13;   // …before its name shows
const SIDE_PANEL_MIN_W = 700; // narrower viewports use a bottom sheet
const TAU = Math.PI * 2;

// Hull outline drawn as quadratic curves through edge midpoints (rounded corners).
function traceHull(ctx, h) {
    const n = h.length / 2;
    const pt = (i) => [h[(i % n) * 2], h[(i % n) * 2 + 1]];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const s = mid(pt(0), pt(1));
    ctx.moveTo(s[0], s[1]);
    for (let i = 1; i <= n; i++) {
        const q = pt(i), m = mid(q, pt(i + 1));
        ctx.quadraticCurveTo(q[0], q[1], m[0], m[1]);
    }
    ctx.closePath();
}

function hullBounds(h) {
    const xs = h.filter((_, i) => i % 2 === 0), ys = h.filter((_, i) => i % 2 === 1);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * Mount the map on `canvas` inside `wrap`. Calls onSelect(node|null) for clicks
 * on a node or empty space and onNation(nat) for a nation name or the inside of
 * a country. Returns the view API the page entry drives.
 */
export function createRelmapView({ wrap, canvas, tip, model, onSelect, onNation }) {
    const ctx = canvas.getContext('2d');
    const { nodes, nations, provinces, classes } = model;
    const nationOf = new Map(nations.map((n) => [n.nat, n]));
    for (const c of nations) c.bounds = hullBounds(c.hull);
    const nationsBySize = [...nations].sort((a, b) => b.count - a.count);

    let W = 0, H = 0, dpr = 1;
    let cam = { x: 0, y: 0, k: 0.3 };
    let order = [];          // visible links, weakest first
    let showClasses = true;
    let focus = null, hover = null;
    let labelBoxes = [];     // nation names on screen, for click hits
    let theme = readTheme();
    const icons = new Map(); // gid → {state: 1 loading | 2 ready | 3 failed, img}

    function readTheme() {
        const css = getComputedStyle(document.body);
        const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
        return {
            dark: document.body.classList.contains('dark-mode'),
            text: v('--text-primary', '#222'),
            halo: v('--bg-secondary', '#fff'),
            focus: v('--accent-blue', '#0a84ff'),
            font: css.fontFamily || 'system-ui, sans-serif',
        };
    }
    // Nation tint at a lightness that reads on the current background.
    const hsl = (nat, light, darkLight, a = 1) => {
        const { hue, sat } = nationColor(nat);
        return `hsl(${hue} ${sat}% ${theme.dark ? darkLight : light}% / ${a})`;
    };

    // ===== Camera =====
    let anim = 0;
    function flyTo(target) {
        const from = { ...cam }, t0 = performance.now(), dur = 500;
        cancelAnimationFrame(anim);
        const step = (now) => {
            const u = Math.min(1, (now - t0) / dur);
            const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
            cam = {
                x: from.x + (target.x - from.x) * e,
                y: from.y + (target.y - from.y) * e,
                k: Math.exp(Math.log(from.k) + (Math.log(target.k) - Math.log(from.k)) * e),
            };
            draw();
            if (u < 1) anim = requestAnimationFrame(step);
        };
        anim = requestAnimationFrame(step);
    }
    function allBounds() {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const n of nodes) {
            x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r);
            x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r);
        }
        return { x0, y0, x1, y1 };
    }
    const fitAll = () => flyTo(fitCamera(allBounds(), W, H));
    function flyToNode(n) {
        const k = Math.max(cam.k, 1.4);
        // keep the shipgirl clear of the side panel, or between the wrapped toolbar
        // and the 45vh bottom sheet on narrow screens (≈30% down the map)
        const side = W >= SIDE_PANEL_MIN_W;
        flyTo({ x: n.x + (side ? 170 / k : 0), y: n.y + (side ? 0 : (H * 0.2) / k), k });
    }
    function flyToNation(nat) {
        const n = nationOf.get(nat);
        if (n) flyTo(fitCamera(hullBounds(n.hull), W, H));
    }

    // ===== Drawing =====
    let pending = false;
    function requestDraw() {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; draw(); });
    }
    function icon(n) {
        let s = icons.get(n.gid);
        if (!s) {
            s = { state: 1, img: new Image() };
            icons.set(n.gid, s);
            s.img.onload = () => { s.state = 2; requestDraw(); };
            s.img.onerror = () => { s.state = 3; };
            s.img.src = dataForToyUrl(`skin_icon/${n.gid * 10}.webp`);
        }
        return s.state === 2 ? s.img : null;
    }

    function draw() {
        const k = cam.k;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.scale(k, k);
        ctx.translate(-cam.x, -cam.y);
        const [vx0, vy0] = toWorld(cam, -50, -50, W, H);
        const [vx1, vy1] = toWorld(cam, W + 50, H + 50, W, H);
        const f = focus || hover;
        const linked = new Set();
        if (f) {
            linked.add(f.i);
            for (const l of f.adj) if (l.vis) linked.add(l.a === f.i ? l.b : l.a);
        }
        // sisters stay lit, but only relationship-linked ships force a label
        const lit = new Set(linked);
        if (f && showClasses) for (const m of f.mates) lit.add(m);

        // countries
        for (const c of nations) {
            ctx.beginPath(); traceHull(ctx, c.hull);
            ctx.fillStyle = hsl(c.nat, 55, 45, f ? 0.05 : 0.1); ctx.fill();
            ctx.strokeStyle = hsl(c.nat, 50, 60, 0.45); ctx.lineWidth = 1.5 / k; ctx.stroke();
        }
        // provinces; dashed sister lines only for the focus
        ctx.lineCap = 'round';
        if (showClasses) {
            ctx.setLineDash([4 / k, 3 / k]);
            provinces.forEach((p, pi) => {
                const mine = f && f.province === pi;
                ctx.beginPath(); traceHull(ctx, p.hull);
                ctx.fillStyle = hsl(p.nat, 50, 50, mine ? 0.14 : f ? 0.03 : 0.08); ctx.fill();
                ctx.strokeStyle = hsl(p.nat, 40, 65, mine ? 0.9 : f ? 0.15 : 0.45);
                ctx.lineWidth = (mine ? 1.6 : 1) / k; ctx.stroke();
            });
            if (f) {
                ctx.strokeStyle = SOURCE_COLOR.class; ctx.lineWidth = 1.3 / k; ctx.globalAlpha = 0.85;
                for (const m of f.mates) {
                    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(nodes[m].x, nodes[m].y); ctx.stroke();
                }
            }
            ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
        // links: screen-px width growing gently with √zoom, so lines never balloon
        const widthScale = Math.min(1.6, Math.max(0.55, Math.sqrt(k))) / k;
        for (const l of order) {
            const p = nodes[l.a], q = nodes[l.b];
            if ((p.x < vx0 && q.x < vx0) || (p.x > vx1 && q.x > vx1) || (p.y < vy0 && q.y < vy0) || (p.y > vy1 && q.y > vy1)) continue;
            const touch = f && (l.a === f.i || l.b === f.i);
            ctx.globalAlpha = f ? (touch ? 0.9 : 0.035) : 0.14 + (Math.min(l.s, 20) / 20) * 0.4;
            const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, dx = q.x - p.x, dy = q.y - p.y;
            ctx.beginPath(); ctx.moveTo(p.x, p.y);
            ctx.quadraticCurveTo(mx - dy * 0.12, my + dx * 0.12, q.x, q.y);
            ctx.strokeStyle = SOURCE_COLOR[l.d];
            ctx.lineWidth = (0.6 + Math.min(l.s, 30) * 0.15) * widthScale;
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // shipgirls
        for (const n of nodes) {
            if (n.x + n.r < vx0 || n.x - n.r > vx1 || n.y + n.r < vy0 || n.y - n.r > vy1) continue;
            const sr = n.r * k;
            ctx.globalAlpha = f && !lit.has(n.i) ? 0.18 : 1;
            const im = sr >= ICON_MIN_PX ? icon(n) : null;
            ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, TAU);
            if (im) {
                ctx.save(); ctx.clip();
                ctx.fillStyle = theme.halo; ctx.fill();
                ctx.drawImage(im, n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
                ctx.restore();
                ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, TAU);
                ctx.strokeStyle = n === f ? theme.focus : hsl(n.nat, 50, 60);
                ctx.lineWidth = (n === f ? 3.5 : 2) / k; ctx.stroke();
            } else {
                ctx.fillStyle = hsl(n.nat, 55, 60, 0.9); ctx.fill();
                if (n === f) { ctx.strokeStyle = theme.focus; ctx.lineWidth = 3 / k; ctx.stroke(); }
            }
        }
        ctx.globalAlpha = 1;
        ctx.restore();
        drawLabels(k, f, linked, lit);
    }

    // Labels in priority order, each claiming screen space the later ones must avoid:
    // nation names (always shown), class names (always, from CLASS_LABEL_ZOOM, in the strip
    // the layout reserved), then shipgirl names under their portraits — only where they fit,
    // except the selected/hovered shipgirl and her links, who are named first.
    function drawLabels(k, f, linked, lit) {
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';
        const placed = [];
        const free = (b) => !placed.some((p) => rectsOverlap(b, p));
        const halo = (text, x, y, width) => {
            ctx.lineWidth = width; ctx.strokeStyle = theme.halo; ctx.strokeText(text, x, y);
            ctx.fillText(text, x, y);
        };
        labelBoxes = [];
        const tags = [];

        // nation names: biggest first; a collision nudges the smaller name instead of hiding
        // it, and a nation zoomed past its name keeps it as a tag pinned inside the view
        for (const c of nationsBySize) {
            const [bx0, by0] = toScreen(cam, c.bounds.x0, c.bounds.y0, W, H);
            const [bx1, by1] = toScreen(cam, c.bounds.x1, c.bounds.y1, W, H);
            if (bx1 < 0 || bx0 > W || by1 < 0 || by0 > H) continue;
            const size = c.count >= 20 ? 13 + Math.sqrt(c.count) * 0.8 : 12;
            ctx.font = `700 ${size}px ${theme.font}`;
            const w = ctx.measureText(c.name).width;
            const [nx, ny] = toScreen(cam, c.labelX, c.labelY, W, H);
            const { x, y, pinned } = pinLabel(nx, ny, w, size, { x0: bx0, y0: by0, x1: bx1, y1: by1 }, W, H);
            const at = (dx, dy) => ({ x0: x + dx - w / 2 - 6, x1: x + dx + w / 2 + 6, y0: y + dy - size - 2, y1: y + dy + 6, x: x + dx, y: y + dy });
            const step = size + 8;
            let box = [[0, 0], [0, step], [0, -step], [w * 0.6, 0], [-w * 0.6, 0], [0, 2 * step]]
                .map(([dx, dy]) => at(dx, dy)).find(free);
            if (!box) {
                if (c.count < 20 && k < 0.55) continue; // small collab nations yield in the overview
                box = at(0, 0);
            }
            placed.push(box);
            labelBoxes.push({ nat: c.nat, x0: box.x0, x1: box.x1, y0: box.y0, y1: box.y1 });
            if (pinned) { tags.push({ c, box, w, size }); continue; } // overlays: drawn last
            ctx.globalAlpha = f ? 0.35 : 1;
            ctx.fillStyle = hsl(c.nat, 42, 72);
            halo(c.name, box.x, box.y, 4);
        }

        // class names: fade in just below CLASS_LABEL_ZOOM, then always on
        const pf = Math.max(0, Math.min(1, (k - CLASS_LABEL_ZOOM + 0.15) / 0.15));
        if (showClasses && pf > 0) {
            ctx.font = `600 11px ${theme.font}`;
            provinces.forEach((p, pi) => {
                const [sx, sy] = toScreen(cam, p.labelX, p.labelY, W, H);
                if (sx < -80 || sx > W + 80 || sy < -20 || sy > H + 20) return;
                const name = classes[p.cls].kr;
                const w = ctx.measureText(name).width;
                placed.push({ x0: sx - w / 2 - 3, x1: sx + w / 2 + 3, y0: sy - 11, y1: sy + 3 });
                ctx.globalAlpha = pf * (f && f.province !== pi ? 0.3 : 1);
                ctx.fillStyle = hsl(p.nat, 36, 75);
                halo(name, sx, sy, 3);
            });
        }

        // shipgirl names: a plate right under the portrait; dimmed portraits don't block
        const discs = [];
        for (const n of nodes) {
            const sr = n.r * k;
            if (sr < ICON_MIN_PX || (f && !lit.has(n.i))) continue;
            const [sx, sy] = toScreen(cam, n.x, n.y, W, H);
            if (sx + sr < -80 || sx - sr > W + 80 || sy + sr < -40 || sy - sr > H + 40) continue;
            discs.push({ n, sx, sy, sr });
        }
        const cands = [];
        for (const n of nodes) {
            const sr = n.r * k;
            const show = n === f || (f ? linked.has(n.i) || (lit.has(n.i) && sr >= LABEL_MIN_PX) : sr >= LABEL_MIN_PX);
            if (!show) continue;
            const [sx, sy] = toScreen(cam, n.x, n.y, W, H);
            if (sx < -60 || sx > W + 60 || sy < -40 || sy > H + 40) continue;
            cands.push({ n, sx, sy, sr, pri: n === f ? 0 : linked.has(n.i) ? 1 : 2 });
        }
        cands.sort((a, b) => a.pri - b.pri || b.sr - a.sr);
        ctx.textBaseline = 'middle';
        // ponytail: linear scans over placed labels and portraits (~300 each at mid zoom);
        // bucket them in a screen grid if this ever costs frames
        for (const c of cands) {
            const big = c.n === f;
            ctx.font = big ? `700 14px ${theme.font}` : `12px ${theme.font}`;
            const w = ctx.measureText(c.n.name).width + 8, h = big ? 19 : 16;
            const y0 = c.sy + Math.max(c.sr, 3) + 2;
            const b = { x0: c.sx - w / 2, x1: c.sx + w / 2, y0, y1: y0 + h };
            if (!big && (!free(b) || discs.some((d) => d.n !== c.n && rectHitsCircle(b, d.sx, d.sy, d.sr * 0.94)))) continue;
            placed.push(b);
            ctx.globalAlpha = 0.82; ctx.fillStyle = theme.halo;
            ctx.beginPath(); ctx.roundRect(b.x0, b.y0, w, h, 6); ctx.fill();
            ctx.globalAlpha = 1; ctx.fillStyle = big ? theme.focus : theme.text;
            ctx.fillText(c.n.name, c.sx, y0 + h / 2 + 0.5);
        }
        ctx.textBaseline = 'alphabetic';

        // pinned nation tags float over everything under them
        for (const { c, box, w, size } of tags) {
            const alpha = f ? 0.35 : 1, th = size + 10;
            ctx.font = `700 ${size}px ${theme.font}`;
            ctx.beginPath(); ctx.roundRect(box.x - (w + 20) / 2, box.y - size - 3, w + 20, th, th / 2);
            ctx.globalAlpha = alpha * 0.92; ctx.fillStyle = theme.halo; ctx.fill();
            ctx.globalAlpha = alpha; ctx.strokeStyle = hsl(c.nat, 42, 60); ctx.lineWidth = 1.5; ctx.stroke();
            ctx.fillStyle = hsl(c.nat, 42, 72); ctx.fillText(c.name, box.x, box.y);
        }
        ctx.globalAlpha = 1;
    }

    // ===== Pointer input =====
    const pts = new Map();
    let moved = 0, pinch = null;
    const local = (e) => {
        const r = canvas.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
    };
    const nodeAt = (sx, sy) => {
        const [x, y] = toWorld(cam, sx, sy, W, H);
        return hitNode(nodes, x, y, cam.k);
    };
    function nationAt(sx, sy) {
        const box = labelBoxes.find((b) => sx >= b.x0 && sx <= b.x1 && sy >= b.y0 && sy <= b.y1);
        if (box) return box.nat;
        const [x, y] = toWorld(cam, sx, sy, W, H);
        return nations.find((c) => pointInHull(c.hull, x, y))?.nat ?? null;
    }
    function showTip(n, p) {
        if (!n) { tip.classList.add('hidden'); return; }
        const count = n.adj.filter((l) => l.vis).length;
        tip.textContent = `${n.name} · ${nationOf.get(n.nat)?.name ?? ''} · 연결 ${count}명`;
        tip.style.left = `${p[0] + 14}px`;
        tip.style.top = `${p[1] + 10}px`;
        tip.classList.remove('hidden');
    }

    canvas.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, local(e));
        moved = 0;
        cancelAnimationFrame(anim);
        if (pts.size === 2) pinch = null;
    });
    canvas.addEventListener('pointermove', (e) => {
        const p = local(e);
        if (!pts.has(e.pointerId)) {
            const n = e.pointerType === 'mouse' ? nodeAt(...p) : null;
            if (n !== hover) { hover = n; requestDraw(); }
            showTip(n, p);
            return;
        }
        const prev = pts.get(e.pointerId);
        pts.set(e.pointerId, p);
        if (pts.size === 1) {
            moved += Math.abs(p[0] - prev[0]) + Math.abs(p[1] - prev[1]);
            if (moved > 4) {
                canvas.classList.add('is-dragging');
                cam = { ...cam, x: cam.x - (p[0] - prev[0]) / cam.k, y: cam.y - (p[1] - prev[1]) / cam.k };
                requestDraw();
            }
        } else if (pts.size === 2) {
            const [a, b] = [...pts.values()];
            const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
            const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            if (pinch) {
                cam = zoomAt(cam, m[0], m[1], d / pinch.d, W, H);
                cam = { ...cam, x: cam.x - (m[0] - pinch.m[0]) / cam.k, y: cam.y - (m[1] - pinch.m[1]) / cam.k };
                requestDraw();
            }
            pinch = { d, m };
            moved = 99;
        }
    });
    const up = (e) => {
        if (!pts.has(e.pointerId)) return;
        const p = pts.get(e.pointerId);
        pts.delete(e.pointerId);
        canvas.classList.remove('is-dragging');
        if (pts.size < 2) pinch = null;
        if (moved > 4 || e.type !== 'pointerup') return;
        const n = nodeAt(...p);
        if (n) { onSelect(n); return; }
        // empty space: the first click clears a selection, the next one flies to the nation
        if (focus) { onSelect(null); return; }
        const nat = nationAt(...p);
        if (nat !== null) onNation(nat);
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', () => {
        if (hover) { hover = null; requestDraw(); }
        showTip(null);
    });
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const [sx, sy] = local(e);
        cam = zoomAt(cam, sx, sy, Math.exp(-e.deltaY * 0.0015), W, H);
        requestDraw();
    }, { passive: false });

    function resize() {
        dpr = window.devicePixelRatio || 1;
        W = wrap.clientWidth;
        H = wrap.clientHeight;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        requestDraw();
    }
    new ResizeObserver(resize).observe(wrap);
    resize();
    cam = fitCamera(allBounds(), W, H);
    onThemeChange(() => { theme = readTheme(); requestDraw(); });

    return {
        /** Highlight a shipgirl's links (null clears). */
        setFocus(n) { focus = n; hover = null; requestDraw(); },
        /** Re-score lines for the sources/min score; returns the visible link count. */
        setFilter(on, minScore, classesOn) {
            order = visibleLinks(model, on, minScore);
            showClasses = classesOn;
            requestDraw();
            return order.length;
        },
        flyTo, fitAll, flyToNode, flyToNation, draw,
    };
}
