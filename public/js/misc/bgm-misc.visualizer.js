/**
 * bgm-misc.visualizer.js
 * Cosmetic visualizer for the bgm-misc sticky player. No Web Audio analysis —
 * pure triple-sine animation. Same vibe as bgm-player.js, sized for a bar.
 *
 * Colors are read from CSS custom properties once on start() and re-read when
 * the body's dark-mode class toggles (via utils.js onThemeChange). Cached
 * colors avoid recomputing per frame.
 */

import { onThemeChange } from '../utils.js';

export function createVisualizer(canvas, { barCount = 32 } = {}) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return { start() {}, stop() {}, resize() {} };

    let rafId = null;
    let colors = null;
    let themeSubscribed = false;

    function readColors() {
        const style = getComputedStyle(document.body);
        colors = {
            start: style.getPropertyValue('--primary-color').trim() || '#5e72e4',
            end: style.getPropertyValue('--accent-blue').trim() || '#825ee4',
        };
    }

    function resize() {
        const rect = canvas.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(rect.width * ratio));
        canvas.height = Math.max(1, Math.round(rect.height * ratio));
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function frame(opacity = 1) {
        const ratio = window.devicePixelRatio || 1;
        const w = canvas.width / ratio;
        const h = canvas.height / ratio;
        ctx.clearRect(0, 0, w, h);
        ctx.globalAlpha = opacity;

        const barW = w / barCount;
        const gap = 1.5;
        const t = Date.now() / 1000;
        for (let i = 0; i < barCount; i++) {
            const w1 = Math.sin(t * 2 + i * 0.15) * 0.3;
            const w2 = Math.sin(t * 3 - i * 0.1) * 0.2;
            const w3 = Math.sin(t * 1.5 + i * 0.2) * 0.25;
            const amp = (w1 + w2 + w3 + 1) / 2;
            const bh = Math.max(2, amp * h * 0.8);
            const x = i * barW;
            const y = h - bh;
            const grad = ctx.createLinearGradient(x, y, x, h);
            grad.addColorStop(0, colors.start);
            grad.addColorStop(1, colors.end);
            ctx.fillStyle = grad;
            ctx.fillRect(x, y, barW - gap, bh);
        }
        ctx.globalAlpha = 1;
    }

    function loop() {
        rafId = requestAnimationFrame(loop);
        frame(1);
    }

    function start() {
        if (rafId != null) return;
        if (!colors) readColors();
        if (!themeSubscribed) {
            themeSubscribed = true;
            onThemeChange(() => readColors());
        }
        resize();
        loop();
    }

    function stop() {
        if (rafId != null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        // Render a final dim frame so the bar still has visual presence.
        if (colors) frame(0.4);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && rafId != null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    });

    return { start, stop, resize };
}
