/**
 * skin.poll.virtual-scroll.js
 * Virtual scroll manager for the skin poll grid.
 * Only renders cards visible in the viewport plus a buffer,
 * keeping the DOM light regardless of total dataset size.
 * Used by skin.poll.js via createVirtualScroll(). Part of the skin module group.
 */

import { throttle, renderStatus } from '../utils.js';

// ===== Constants =====

const RESIZE_THROTTLE_MS = 200;
const SAMPLE_CARD_ID = '__vs-sample-card__';

// ===== Public API =====

/**
 * Create a virtual scroll manager for a CSS grid container.
 *
 * @param {object} options
 * @param {HTMLElement} options.container     - The grid container element
 * @param {function} options.renderCard       - (itemData) => HTMLElement
 * @param {number}   [options.buffer=10]      - Extra rows to render above/below viewport
 * @returns {{ setItems, refresh, getRenderedRange, destroy }}
 */
export function createVirtualScroll({ container, renderCard, buffer = 10 }) {
    // ===== Module State =====

    let items = [];
    let columns = 1;
    let rowHeight = 300;       // estimated; measured from a sample card
    let gapY = 15;             // gap between rows (px)
    let renderedRange = { start: 0, end: 0 };
    let rafId = null;
    let needsRender = false;

    // Spacer elements that give the scrollbar correct height
    let topSpacer = null;
    let bottomSpacer = null;

    // ===== Internal Helpers =====

    /**
     * Parse the number of columns from the container's computed grid style.
     * @returns {number}
     */
    function getColumnCount() {
        const style = getComputedStyle(container);
        const cols = style.gridTemplateColumns;
        if (!cols || cols === 'none') return 1;
        return cols.trim().split(/\s+/).length;
    }

    /**
     * Parse the row gap (gap-Y) from computed style in pixels.
     * @returns {number}
     */
    function getRowGap() {
        const style = getComputedStyle(container);
        // row-gap takes priority; fall back to gap shorthand
        const rawRowGap = style.rowGap || style.gridRowGap || '0px';
        return parseFloat(rawRowGap) || 0;
    }

    /**
     * Render a single off-screen sample card to measure its rendered height.
     * The card is removed from the DOM once measured.
     * @returns {number} Card height in px (including border/padding).
     */
    function measureCardHeight() {
        if (items.length === 0) return rowHeight;

        // Remove any stale sample
        const stale = container.querySelector(`#${SAMPLE_CARD_ID}`);
        if (stale) stale.remove();

        const sample = renderCard(items[0]);
        sample.id = SAMPLE_CARD_ID;
        sample.style.cssText = 'visibility:hidden;position:absolute;pointer-events:none;';
        container.appendChild(sample);

        const h = sample.getBoundingClientRect().height;
        sample.remove();

        return h > 0 ? h : rowHeight;
    }

    /**
     * Ensure the top/bottom spacer elements exist in the container.
     */
    function ensureSpacers() {
        if (!topSpacer) {
            topSpacer = document.createElement('div');
            topSpacer.className = 'vs-spacer vs-spacer-top';
            topSpacer.style.cssText = 'grid-column: 1 / -1; height: 0px;';
        }
        if (!bottomSpacer) {
            bottomSpacer = document.createElement('div');
            bottomSpacer.className = 'vs-spacer vs-spacer-bottom';
            bottomSpacer.style.cssText = 'grid-column: 1 / -1; height: 0px;';
        }
    }

    /**
     * Remove all rendered cards (not spacers) from the container.
     * Blurs any focused element inside first: Chromium's scroll anchoring
     * treats the focused element as a priority anchor candidate, and removing
     * it mid-render yanks the viewport up by thousands of px (the
     * "vote a star then scroll → page jumps to top" bug).
     */
    function clearCards() {
        if (container.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        const children = Array.from(container.children);
        for (const child of children) {
            if (child !== topSpacer && child !== bottomSpacer &&
                !child.classList.contains('page-status')) {
                container.removeChild(child);
            }
        }
    }

    /**
     * Calculate which item indices are visible given current scroll position.
     * Returns { startItem, endItem } (inclusive item indices).
     */
    function calcVisibleRange() {
        const containerTop = container.getBoundingClientRect().top + window.scrollY;
        const viewportTop = window.scrollY;
        const viewportBottom = viewportTop + window.innerHeight;

        // Scroll position relative to the container's top
        const relTop = viewportTop - containerTop;
        const relBottom = viewportBottom - containerTop;

        const rowPitch = rowHeight + gapY; // row height + gap

        // Which rows are visible?
        const firstVisibleRow = Math.max(0, Math.floor(relTop / rowPitch));
        const lastVisibleRow = Math.max(0, Math.ceil(relBottom / rowPitch));

        // Add buffer rows
        const firstRow = Math.max(0, firstVisibleRow - buffer);
        const lastRow = lastVisibleRow + buffer;

        // Convert rows → item indices
        const startItem = firstRow * columns;
        const endItem = Math.min(items.length - 1, (lastRow + 1) * columns - 1);

        return { startItem, endItem };
    }

    /**
     * Perform the actual DOM render for the given item range.
     * Adjusts spacer heights so the scrollbar height stays correct.
     * @param {number} startItem
     * @param {number} endItem
     */
    function renderRange(startItem, endItem) {
        ensureSpacers();
        clearCards();

        // Remove any "no results" status element
        const noResults = container.querySelector('.page-status');
        if (noResults) noResults.remove();

        const totalRows = Math.ceil(items.length / columns);
        const rowPitch = rowHeight + gapY;

        const startRow = Math.floor(startItem / columns);
        const endRow = Math.floor(endItem / columns);

        const topHeight = startRow * rowPitch;
        // Rows below: from endRow+1 to totalRows-1, minus gap on the very last row
        const bottomRows = Math.max(0, totalRows - 1 - endRow);
        const bottomHeight = bottomRows * rowPitch;

        topSpacer.style.height = `${topHeight}px`;
        bottomSpacer.style.height = `${bottomHeight}px`;

        // Build fragment with rendered cards
        const fragment = document.createDocumentFragment();

        // Top spacer goes first
        fragment.appendChild(topSpacer);

        for (let i = startItem; i <= endItem; i++) {
            if (i < 0 || i >= items.length) continue;
            const card = renderCard(items[i]);
            fragment.appendChild(card);
        }

        // Bottom spacer goes last
        fragment.appendChild(bottomSpacer);

        container.appendChild(fragment);

        renderedRange = { start: startItem, end: endItem };
    }

    /**
     * Show the empty-state message and clear spacers.
     */
    function showNoResults() {
        renderStatus(container, '표시할 스킨이 없습니다.', 'empty');
        renderedRange = { start: 0, end: 0 };
    }

    /**
     * Recalculate grid metrics (columns, row height, gap) then re-render.
     */
    function recalcAndRender() {
        if (items.length === 0) {
            showNoResults();
            return;
        }

        columns = getColumnCount();
        gapY = getRowGap();
        rowHeight = measureCardHeight();

        const { startItem, endItem } = calcVisibleRange();
        renderRange(startItem, endItem);
    }

    // ===== Scroll Handler (rAF-throttled) =====

    function onScroll() {
        if (needsRender) return;     // already queued
        if (items.length === 0) return;

        needsRender = true;
        rafId = requestAnimationFrame(() => {
            needsRender = false;

            const { startItem, endItem } = calcVisibleRange();

            // Skip re-render if the range hasn't changed
            if (startItem === renderedRange.start && endItem === renderedRange.end) return;

            renderRange(startItem, endItem);
        });
    }

    // ===== Resize Handler (throttled at 200ms) =====

    const onResize = throttle(() => {
        recalcAndRender();
    }, RESIZE_THROTTLE_MS);

    // ===== Event Listeners =====

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    // ===== Public Methods =====

    /**
     * Replace the full dataset, recalculate dimensions, and re-render from top.
     * @param {Array} newItems
     */
    function setItems(newItems) {
        items = newItems || [];
        recalcAndRender();
    }

    /**
     * Force a re-render at the current scroll position.
     * Useful after external data updates (e.g., vote score changes).
     */
    function refresh() {
        if (items.length === 0) {
            showNoResults();
            return;
        }
        const { startItem, endItem } = calcVisibleRange();
        renderRange(startItem, endItem);
    }

    /**
     * Return the index range of currently rendered items.
     * @returns {{ start: number, end: number }}
     */
    function getRenderedRange() {
        return { ...renderedRange };
    }

    /**
     * Remove scroll/resize listeners and cancel any pending rAF.
     */
    function destroy() {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onResize);
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    }

    return { setItems, refresh, getRenderedRange, destroy };
}
