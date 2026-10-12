/**
 * story.typewriter.js
 * Reveal an already-rendered line character by character. The line is built in
 * full first (renderColoredDialogue keeps <color> spans as DOM), then its text
 * nodes are emptied and refilled at `cps` — so colours and node structure never
 * change mid-reveal. Characters are code points (Array.from), not UTF-16 units.
 */

/** How many characters of each text node are visible after `count` total. */
export function revealCounts(lengths, count) {
    let left = Math.max(0, count);
    return lengths.map((len) => {
        const n = Math.min(len, left);
        left -= n;
        return n;
    });
}

export function createTypewriter() {
    let timer = null, nodes = [], texts = [], done = null;

    function render(count) {
        const counts = revealCounts(texts.map(t => t.length), count);
        nodes.forEach((node, i) => { node.textContent = texts[i].slice(0, counts[i]).join(''); });
    }
    function stop() {
        if (timer != null) clearInterval(timer);
        timer = null;
    }
    return {
        /** Start revealing `el`'s text; `onDone` fires once when fully shown. */
        start(el, cps, onDone) {
            stop();
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            nodes = [];
            for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
            texts = nodes.map(n => Array.from(n.textContent));
            done = onDone;
            const total = texts.reduce((a, t) => a + t.length, 0);
            let shown = 0;
            render(0);
            timer = setInterval(() => {
                shown += 1;
                render(shown);
                if (shown >= total) this.finish();
            }, 1000 / Math.max(1, cps));
        },
        /** Show the rest of the line now and fire onDone. */
        finish() {
            if (timer == null) return;
            stop();
            render(Infinity);
            const cb = done; done = null;
            cb?.();
        },
        /** Abandon the line without firing onDone (navigation away). */
        cancel() { stop(); done = null; },
        isTyping() { return timer != null; },
    };
}
