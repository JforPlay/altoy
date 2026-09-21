/**
 * skin.detail.stage.js
 * The art stage of the renewed skin detail viewer: one art object at a time,
 * an asset selector rail, the expression shelf beneath the art, the 전체 표정
 * overlay and the fullscreen viewer that owns 이미지 저장.
 *
 * Compositing is NOT reimplemented here. Extracted base paintings
 * (output_expressions/<id>/painting.png) carry a transparent face hole, and the
 * seam-free base+face composite that fills it lives in skin.expression.js
 * (buildOverlayContainer / composeOverlay). This module only decides WHICH art
 * is on screen and WHICH face is in it; every pixel still goes through that one
 * path, so there is a single place where the hole can be reopened and it is
 * already correct.
 *
 * Two rules from that module carry over and are load-bearing here:
 *   - the default face comes from pickFaceCandidates(entry, null)[0], never
 *     faces[0] — `faces` is atlas order and is the wrong base for ~77% of
 *     paintings;
 *   - a composite <canvas> is snapshotted with toBlob, never toDataURL — these
 *     canvases run to 4096² and a synchronous encode freezes the main thread.
 *
 * Owns: #skin-stage's children, #stage-tools, #stage-dock, #asset-rail's
 * children, #face-grid, #stage-viewer.
 * Wired by skin.detail.viewer.js: initStage() once, then renderStage() per skin.
 */
import {
    createImgElement, createIcon, lockBodyScroll, unlockBodyScroll,
    downloadImage, sanitizeFilename, showElement, hideElement, toggleElement,
    DATA_FOR_TOY_BASE
} from '../utils.js';
import { pickFaceCandidates } from '../expression-face.js';
import { buildOverlayContainer, composeOverlay, expUrl } from './skin.expression.js';

// ===== Asset catalogue =====

/**
 * The art objects a skin can have, in rail order. `suffix`/`baseName` are set
 * only on the two that carry expressions: those resolve to an extracted,
 * hole-punched painting keyed in the expression manifest as `<id>` and
 * `<id>_n`, and must be composited. The rest are flat images on the record.
 * `field` is the skin record key holding the plain URL — also the fallback for
 * 전체/확대 when a skin has no manifest entry.
 */
const ASSET_DEFS = [
    { key: '전체', label: '전체', field: '전체 일러', suffix: '', baseName: 'painting' },
    { key: '확대', label: '확대', field: '확대 일러', suffix: '_n', baseName: 'painting_n' },
    { key: '깔끔', label: '깔끔', field: '깔끔한 일러' },
    { key: 'SD', label: 'SD', field: 'sd 일러' },
    { key: '아이콘', label: '아이콘', field: '아이콘 일러' },
    { key: '쥬스타', label: '쥬스타', field: '쥬스타 아이콘 일러' }
];

// Face shelf geometry. The rail tile height is fixed and its WIDTH is derived
// from the manifest box aspect ratio, so the patch fills the tile edge to edge.
const TILE_H = 74;
// Rail thumbs past this index load lazily: a 21-expression skin otherwise pulls
// ~12.6 MB of full-size face PNGs just to draw a row of thumbnails.
const EAGER_TILES = 12;
// Below this count every expression already fits the rail, so 전체 표정 is noise.
const FACE_GRID_THRESHOLD = 8;

// ===== State =====

const state = {
    els: null,      // stage chrome, built once by initStage()
    viewer: null,   // #stage-viewer parts
    grid: null,     // #face-grid parts
    assets: [],
    active: -1,
    faceId: null,   // shared across 전체 and 확대: they show one expression
    skinName: '',
    railObserver: null,  // defers off-screen rail thumbs (see railThumb)
    gridObserver: null   // same, for the 전체 표정 grid
};

// ===== Init =====

/**
 * Build the stage chrome inside #skin-stage plus the two full-screen overlays,
 * and wire every listener. Idempotent-by-construction: the controller calls it
 * once at page init, renderStage() does the per-skin work.
 * @returns {boolean} false when the page ships no #skin-stage (nothing to own)
 */
function initStage() {
    const stage = document.getElementById('skin-stage');
    const assetRail = document.getElementById('asset-rail');
    const dock = document.getElementById('stage-dock');
    const tools = document.getElementById('stage-tools');
    if (!stage) return false;

    const art = el('div', 'sdv-art');

    // Both live on the sticky stage head, not floating over the art: the frame is
    // free to run several screens tall now, so anything pinned inside it would
    // scroll away from the art it describes — and reserving 46px of frame height
    // for them is exactly the space the bigger fit needed back.
    const label = el('div', 'sdv-art-label');
    const fullBtn = el('button', 'sdv-art-full');
    fullBtn.type = 'button';
    fullBtn.textContent = '전체화면 · 저장';
    fullBtn.addEventListener('click', openViewer);
    tools?.replaceChildren(label, fullBtn);

    const view = el('div', 'sdv-art-view');
    const fit = el('div', 'sdv-art-fit');
    view.appendChild(fit);

    art.appendChild(view);
    stage.replaceChildren(art);

    // The expression shelf joins the 일러 rail in the dock: two pickers for one
    // image belong on one bar, and the bar has to outlive the art's scroll.
    const shelf = buildShelf();
    dock?.appendChild(shelf.root);

    state.els = { stage, assetRail, dock, tools, art, view, fit, label, fullBtn, shelf };
    state.viewer = buildViewer();
    state.grid = buildFaceGrid();

    // One handler for both overlays; they are mutually exclusive by construction
    // (전체 표정 is only reachable from the shelf, the viewer only from the art).
    document.addEventListener('keydown', onKeydown);
    showStage(false);
    return true;
}

/** Art frame, its head-row tools and the dock appear and disappear together. */
function showStage(on) {
    toggleElement(state.els.art, on);
    toggleElement(state.els.dock, on);
    toggleElement(state.els.tools, on);
}

// ===== Render =====

/**
 * Show a skin on the stage: rebuild the asset list, repaint the rail, select the
 * first asset. Any open overlay is closed first — both hold a live reference to
 * the outgoing skin's art node.
 * @param {Object} skin - a skin record from the skin index
 * @param {Object} manifest - the full expression manifest, keyed by skin id
 * @param {string} [skinName] - human-readable name, used in the viewer + filenames
 */
function renderStage(skin, manifest, skinName = '') {
    if (!state.els) return;
    closeViewer();
    closeFaceGrid();

    state.skinName = skinName;
    state.assets = buildAssets(skin || {}, manifest || {});
    state.active = -1;
    state.faceId = null;

    renderAssetRail();
    if (state.assets.length === 0) {
        showStage(false);
        state.els.fit.replaceChildren();
        return;
    }
    showStage(true);
    selectAsset(0);
}

/** Tear the stage down between skins (and on an error state). */
function clearStage() {
    if (!state.els) return;
    closeViewer();
    closeFaceGrid();
    state.assets = [];
    state.active = -1;
    state.faceId = null;
    state.skinName = '';
    state.railObserver?.disconnect();
    state.railObserver = null;
    state.els.fit.replaceChildren();
    state.els.assetRail?.replaceChildren();
    showStage(false);
}

/**
 * Resolve the skin's art objects in rail order, dropping the ones it lacks.
 * An asset is composited when the manifest knows it and lists faces; otherwise
 * it is the record's plain URL, which is also how 전체/확대 degrade for skins
 * that were never extracted.
 */
function buildAssets(skin, manifest) {
    const skinId = skin['클뜯 id'];
    const baseDir = skinId ? `${DATA_FOR_TOY_BASE}/output_expressions/${skinId}` : '';
    const out = [];

    for (const def of ASSET_DEFS) {
        const entry = (skinId && def.baseName) ? manifest[`${skinId}${def.suffix}`] : null;
        // Sorted numerically for DISPLAY only. The manifest stores `faces` in atlas
        // order, which is arbitrary: the game's no-expression face is usually '0' but
        // can sit anywhere in the array, so the untouched order made the default read
        // as 「2 / 6」 and gave the rail no stable sequence between skins. This changes
        // presentation only; which face is the DEFAULT still comes from
        // pickFaceCandidates, never from position.
        const faces = entry?.faces?.length
            ? entry.faces.map(String).sort((a, b) => (Number(a) || 0) - (Number(b) || 0))
            : null;
        if (faces) {
            const [w, h] = entry.size || [];
            out.push({
                ...def, entry, faces, baseDir, node: null,
                url: expUrl(`${baseDir}/${def.baseName}.png`),
                w: w || 0, h: h || 0
            });
        } else if (skin[def.field]) {
            out.push({ ...def, entry: null, faces: null, baseDir: '', node: null, url: skin[def.field], w: 0, h: 0 });
        }
    }
    return out;
}

// ===== Asset rail =====

/**
 * One thumbnail card per art object: the art itself, contained on a dark tile,
 * with its name under it.
 *
 * 전체 and 확대 preview the hole-punched base painting, face gap and all. That is
 * a deliberate user call (2026-09-21) over the text chips this rail shipped with:
 * at 56px the gap reads as a detail, and compositing six previews just to draw a
 * selector would pull the whole gallery. The thumbnails are NOT deferred — six
 * cards are always on screen, so an observer would only add bookkeeping.
 */
function renderAssetRail() {
    const rail = state.els.assetRail;
    if (!rail) return;
    rail.replaceChildren(...state.assets.map((asset, i) => {
        const btn = el('button', 'sdv-asset');
        btn.type = 'button';
        btn.dataset.asset = asset.key;
        btn.title = `${asset.label} 일러스트`;
        btn.setAttribute('aria-pressed', 'false');

        const thumb = el('span', 'sdv-asset-thumb');
        thumb.appendChild(createImgElement(asset.url, '', { eager: true }));

        const name = el('span', 'sdv-asset-name');
        name.textContent = asset.label;

        btn.append(thumb, name);
        btn.addEventListener('click', () => selectAsset(i));
        return btn;
    }));
}

/** Move the stage (and the viewer, when open) to asset `index`. */
function selectAsset(index) {
    const asset = state.assets[index];
    if (!asset) return;
    state.active = index;

    state.els.assetRail?.querySelectorAll('.sdv-asset').forEach((btn, i) => {
        btn.setAttribute('aria-pressed', String(i === index));
    });

    // The face is shared across 전체/확대, so adopt the active asset's default
    // only when nothing has been picked yet or the picked face does not exist
    // here. The default is pickFaceCandidates(entry, null)[0] — the game's
    // no-expression face — and never faces[0], which is atlas order.
    let adopted = false;
    if (asset.faces && (!state.faceId || !asset.faces.includes(state.faceId))) {
        state.faceId = pickFaceCandidates(asset.entry, null)[0] || asset.faces[0];
        adopted = true;
    }

    state.els.fit.replaceChildren(assetNode(asset));
    applyFit(state.els.fit, asset, 'width');
    renderLabel();
    renderShelf();
    // Adopting a new default leaves any previously built overlay on the old
    // face, so re-composite them all — the two paintings must never disagree
    // with each other or with the counter the shelf just printed.
    if (adopted) setFace(state.faceId);
    if (isOpen(state.viewer.root)) renderViewer();
}

/**
 * Build (and cache) the art node for an asset. Composited assets get the shared
 * overlay container; everything else is a plain <img> whose native size is only
 * known once it loads, so the frame caps and the label are refreshed then.
 */
function assetNode(asset) {
    if (asset.node) return asset.node;

    if (asset.faces) {
        asset.node = buildOverlayContainer({
            baseName: asset.baseName,
            baseImageUrl: asset.url,
            overlayUrl: faceUrl(asset, state.faceId),
            manifest: asset.entry,
            alt: `${asset.label} 일러스트`
        });
        return asset.node;
    }

    const img = createImgElement(asset.url, `${asset.label} 일러스트`, { className: 'sdv-art-img', eager: true });
    img.addEventListener('load', () => {
        asset.w = img.naturalWidth;
        asset.h = img.naturalHeight;
        if (state.assets[state.active] === asset) {
            applyFit(state.els.fit, asset, 'width');
            renderLabel();
            if (isOpen(state.viewer.root)) renderViewer();
        }
    }, { once: true });
    asset.node = img;
    return img;
}

/**
 * Size the art wrapper. Two modes, because the stage and the lightbox answer
 * different questions:
 *
 *   'width'   (the stage) — take the whole column, bounded by the art's own
 *             native size and by --sdv-art-cap. The column is no longer one
 *             viewport tall, so fitting by HEIGHT is what made a 3002 × 2800
 *             painting render 928px wide inside a 1500px stage.
 *   'contain' (the fullscreen viewer) — fit inside one screen on both axes. A
 *             lightbox that scrolls is not a lightbox.
 *
 * Either way the art is never upscaled: that cap is the `${asset.w}px` term.
 */
function applyFit(fit, asset, mode = 'width') {
    const known = asset.w > 0 && asset.h > 0;

    if (mode === 'contain') {
        fit.style.width = '';
        fit.style.height = '100%';
        fit.style.aspectRatio = known ? `${asset.w} / ${asset.h}` : '';
        fit.style.maxWidth = known ? `${asset.w}px` : '';
        fit.style.maxHeight = known ? `${asset.h}px` : '';
        return;
    }

    fit.style.height = '';
    fit.style.aspectRatio = '';
    fit.style.maxHeight = '';
    fit.style.maxWidth = known ? `${asset.w}px` : '';
    // The cap is a height, so it converts to a width through the art's own ratio.
    fit.style.width = known
        ? `min(100%, ${asset.w}px, var(--sdv-art-cap) * ${(asset.w / asset.h).toFixed(4)})`
        : '';
}

function renderLabel() {
    const asset = state.assets[state.active];
    if (!asset) return;
    state.els.label.textContent = (asset.w && asset.h)
        ? `${asset.label} 일러스트 · ${asset.w} × ${asset.h}`
        : `${asset.label} 일러스트`;
}

// ===== Expression shelf =====

/** Build the shelf chrome once; renderShelf() refills it per asset. */
function buildShelf() {
    const root = el('div', 'sdv-dock-group sdv-dock-faces');

    const head = el('div', 'sdv-face-head');
    const prev = stepButton(-1, '이전 표정');
    const count = el('span', 'sdv-face-count');
    const next = stepButton(1, '다음 표정');
    const spacer = el('span', 'sdv-face-spacer');

    const all = el('button', 'sdv-face-all');
    all.type = 'button';
    all.textContent = '전체 표정';
    all.addEventListener('click', openFaceGrid);

    head.append(prev, count, next, spacer, all);

    const wrap = el('div', 'sdv-face-rail-wrap');
    const rail = el('div', 'sdv-face-rail scroll-styled');
    const fade = el('div', 'sdv-face-fade');
    fade.setAttribute('aria-hidden', 'true');
    rail.addEventListener('scroll', () => updateFade(wrap, rail));
    wrap.append(rail, fade);

    root.append(head, wrap);
    return { root, count, all, wrap, rail };
}

function stepButton(delta, ariaLabel) {
    const btn = el('button', 'sdv-face-step');
    btn.type = 'button';
    btn.setAttribute('aria-label', ariaLabel);
    btn.appendChild(createIcon(delta < 0 ? 'fas fa-chevron-left' : 'fas fa-chevron-right'));
    btn.addEventListener('click', () => stepFace(delta));
    return btn;
}

/** The shelf exists only for assets that have expressions. */
function renderShelf() {
    const { shelf } = state.els;
    const asset = state.assets[state.active];
    if (!asset?.faces) {
        toggleElement(shelf.root, false);
        shelf.rail.replaceChildren();
        return;
    }
    toggleElement(shelf.root, true);
    toggleElement(shelf.all, asset.faces.length > FACE_GRID_THRESHOLD);

    shelf.rail.replaceChildren(...asset.faces.map((faceId, i) => {
        const tile = el('button', 'sdv-face-tile');
        tile.type = 'button';
        tile.dataset.faceId = faceId;
        tile.style.width = `${tileWidth(asset.entry)}px`;
        tile.setAttribute('aria-label', `표정 ${i + 1}`);
        tile.appendChild(railThumb(thumbUrl(asset.baseDir, faceId), `표정 ${i + 1}`, i < EAGER_TILES));
        tile.addEventListener('click', () => setFace(faceId));
        return tile;
    }));

    renderFaceSelection();
    state.railObserver = observeThumbs(shelf.rail, state.railObserver);
    requestAnimationFrame(() => updateFade(shelf.wrap, shelf.rail));
}

/**
 * A rail thumbnail, deferred unless it is one of the first EAGER_TILES.
 *
 * NOT `createImgElement`: that helper does `new Image(); img.src = src;` and only
 * then sets `img.loading`, so the fetch has already started AND the element is
 * detached, which the lazy machinery requires it not to be. `loading="lazy"`
 * through it is a silent no-op repo-wide. Deferred tiles therefore carry the URL
 * on `data-src` and are swapped in by observeRailThumbs once they scroll near the
 * viewport. Worth the ~12 lines: a 21-expression skin otherwise pulls ~12.6 MB of
 * full-size face PNGs just to paint one row of thumbnails.
 */
function railThumb(src, alt, eager) {
    const img = document.createElement('img');
    img.alt = alt;
    img.decoding = 'async';
    if (eager) {
        img.src = src;
    } else {
        img.loading = 'lazy';
        img.dataset.src = src;
    }
    return img;
}

/**
 * Swap `data-src` into `src` as deferred tiles come near view, and return the
 * observer so the caller can replace its previous one.
 *
 * Deliberately viewport-rooted (`root: null`) rather than rooted at the scroller:
 * the intersection rect is computed against every ancestor clip box, so one
 * observer handles the shelf rail's HORIZONTAL overflow and the grid's vertical
 * scroll alike. It also sidesteps the trap that an observer rooted at a
 * `display: none` element reports everything as non-intersecting forever.
 */
function observeThumbs(root, previous) {
    previous?.disconnect();
    const pending = root.querySelectorAll('img[data-src]');
    if (pending.length === 0) return null;

    const observer = new IntersectionObserver((entries, obs) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const img = entry.target;
            img.src = img.dataset.src;
            delete img.dataset.src;
            obs.unobserve(img);
        }
    }, { rootMargin: '300px' });

    pending.forEach(img => observer.observe(img));
    return observer;
}

/**
 * The tile carries the face patch's OWN aspect ratio, straight off the manifest
 * box, so the patch fills it edge to edge. Never `object-fit: contain` inside a
 * square (a 629×1042 patch becomes an invisible sliver) and never a crop rect
 * derived from `box`: skins exist that are upside down or whose face box is
 * wider than it is tall.
 */
function tileWidth(entry) {
    const [, , bw, bh] = entry?.box || [];
    if (!bw || !bh) return TILE_H;
    return Math.max(24, Math.round(TILE_H * bw / bh));
}

/**
 * Prefer the webp thumbnail tier when the manifest says the pipeline emitted it.
 * The flag is absent from today's data, so the PNG path is what ships; the gate
 * exists so a future pipeline run costs zero 404s instead of one per face. The
 * full-size render and the image save always use the original PNG.
 */
function thumbUrl(baseDir, faceId) {
    const entry = state.assets[state.active]?.entry;
    return entry?.thumbs
        ? expUrl(`${baseDir}/thumbs/painting_face_${faceId}.webp`)
        : expUrl(`${baseDir}/painting_face_${faceId}.png`);
}

function faceUrl(asset, faceId) {
    return expUrl(`${asset.baseDir}/${asset.baseName}_face_${faceId}.png`);
}

/**
 * Apply an expression. Every built overlay container on the page re-composites,
 * because 전체 and 확대 show the same face — but only those whose own manifest
 * lists the id: applying a face the zoomed painting never had would 404 and
 * leave its hole bare.
 */
function setFace(faceId) {
    state.faceId = String(faceId);
    for (const asset of state.assets) {
        if (!asset.node?._overlay || !asset.faces?.includes(state.faceId)) continue;
        asset.node._overlay.faceUrl = faceUrl(asset, state.faceId);
        asset.node._composePromise = composeOverlay(asset.node);
    }
    renderFaceSelection();
}

/** Step the expression by `delta`, wrapping at both ends. */
function stepFace(delta) {
    const faces = state.assets[state.active]?.faces;
    if (!faces?.length) return;
    const at = Math.max(0, faces.indexOf(state.faceId));
    setFace(faces[(at + delta + faces.length) % faces.length]);
}

/** Repaint every place the current face index is shown. */
function renderFaceSelection() {
    const asset = state.assets[state.active];
    if (!asset?.faces) return;
    const at = Math.max(0, asset.faces.indexOf(state.faceId));
    const total = asset.faces.length;

    state.els.shelf.count.textContent = `${at + 1} / ${total}`;
    state.els.shelf.rail.querySelectorAll('.sdv-face-tile').forEach(tile => {
        const on = tile.dataset.faceId === state.faceId;
        tile.classList.toggle('is-active', on);
        tile.setAttribute('aria-pressed', String(on));
    });
    state.grid.body.querySelectorAll('.sdv-facegrid-tile').forEach(tile => {
        tile.classList.toggle('is-active', tile.dataset.faceId === state.faceId);
    });
    if (state.viewer.count) state.viewer.count.textContent = `표정 ${at + 1} / ${total}`;

    keepTileInView(state.els.shelf.rail);
}

/**
 * Bring the active tile into the rail's own scrollport by moving ONLY the rail.
 *
 * Not `scrollIntoView`: even with `block: 'nearest'` it walks the whole scrollable
 * ancestor chain up to the document, so on mobile (where the shelf sits ~1000px
 * down a block-flow page) selecting a face scrolled the window 390px and dropped
 * the visitor below the search box on a deep link.
 */
function keepTileInView(rail) {
    const tile = rail?.querySelector('.sdv-face-tile.is-active');
    if (!tile) return;
    const railBox = rail.getBoundingClientRect();
    const tileBox = tile.getBoundingClientRect();
    const pad = 8;
    if (tileBox.left < railBox.left) {
        rail.scrollLeft -= (railBox.left - tileBox.left) + pad;
    } else if (tileBox.right > railBox.right) {
        rail.scrollLeft += (tileBox.right - railBox.right) + pad;
    }
}

/** The right-edge fade is a hint that the rail scrolls, so it drops at the end. */
function updateFade(wrap, rail) {
    const more = rail.scrollWidth - rail.clientWidth - rail.scrollLeft > 4;
    wrap.classList.toggle('has-more', more);
}

// ===== 전체 표정 overlay =====

function buildFaceGrid() {
    const root = ensureOverlay('face-grid', 'sdv-facegrid');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');

    const head = el('div', 'sdv-facegrid-head');
    const title = el('h2', 'sdv-facegrid-title');
    const sub = el('p', 'sdv-facegrid-sub');
    const hint = el('p', 'sdv-facegrid-hint');
    hint.textContent = '클릭하면 일러스트에 적용됩니다';
    const text = el('div', 'sdv-facegrid-titles');
    text.append(title, sub, hint);

    const close = el('button', 'btn btn-close sdv-facegrid-close');
    close.type = 'button';
    close.setAttribute('aria-label', '닫기');
    close.appendChild(createIcon('fas fa-times'));
    close.addEventListener('click', closeFaceGrid);
    head.append(text, close);

    const body = el('div', 'sdv-facegrid-body scroll-styled');
    root.replaceChildren(head, body);
    return { root, title, sub, body };
}

function openFaceGrid() {
    const asset = state.assets[state.active];
    if (!asset?.faces || isOpen(state.grid.root)) return;
    const [, , bw, bh] = asset.entry?.box || [];

    state.grid.title.textContent = `전체 표정 ${asset.faces.length}`;
    state.grid.sub.textContent = (bw && bh)
        ? `${state.skinName} · 표정 영역 ${bw} × ${bh}`
        : state.skinName;

    state.grid.body.replaceChildren(...asset.faces.map((faceId, i) => {
        const tile = el('button', 'sdv-facegrid-tile');
        tile.type = 'button';
        tile.dataset.faceId = faceId;
        const img = railThumb(thumbUrl(asset.baseDir, faceId), `표정 ${i + 1}`, i < EAGER_TILES);
        const badge = el('span', 'sdv-facegrid-num');
        badge.textContent = String(i + 1);
        tile.append(img, badge);
        tile.addEventListener('click', () => { setFace(faceId); closeFaceGrid(); });
        return tile;
    }));

    renderFaceSelection();
    showElement(state.grid.root);
    // Observe AFTER the overlay is visible: an IntersectionObserver rooted at a
    // display:none element reports every target as non-intersecting, so nothing
    // would ever load.
    state.gridObserver = observeThumbs(state.grid.body, state.gridObserver);
    lockBodyScroll();
}

function closeFaceGrid() {
    if (!isOpen(state.grid?.root)) return;
    hideElement(state.grid.root);
    // Drop the observer before the tiles it watches: the grid rebuilds its body on
    // every open, so a surviving observer would hold ~21 detached <img> alive.
    state.gridObserver?.disconnect();
    state.gridObserver = null;
    state.grid.body.replaceChildren();
    unlockBodyScroll();
}

// ===== Fullscreen viewer =====

function buildViewer() {
    const root = ensureOverlay('stage-viewer', 'sdv-viewer');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');

    const name = el('strong', 'sdv-viewer-name');
    const meta = el('span', 'sdv-viewer-meta');
    const titles = el('div', 'sdv-viewer-titles');
    titles.append(name, meta);

    const save = el('button', 'btn btn-primary sdv-viewer-save');
    save.type = 'button';
    save.textContent = '이미지 저장';
    save.addEventListener('click', saveCurrentArt);

    const close = el('button', 'btn btn-close sdv-viewer-close');
    close.type = 'button';
    close.setAttribute('aria-label', '닫기');
    close.appendChild(createIcon('fas fa-times'));
    close.addEventListener('click', closeViewer);

    const head = el('div', 'sdv-viewer-head');
    head.append(titles, save, close);

    const fit = el('div', 'sdv-art-fit');
    const body = el('div', 'sdv-viewer-body');
    body.appendChild(fit);

    const count = el('span', 'sdv-viewer-count');
    const note = el('span', 'sdv-viewer-note');
    note.textContent = '선택한 표정 그대로 저장됩니다';
    const foot = el('div', 'sdv-viewer-foot');
    foot.append(stepButton(-1, '이전 표정'), count, stepButton(1, '다음 표정'), note);

    root.replaceChildren(head, body, foot);
    return { root, name, meta, body, fit, count, foot };
}

/**
 * Open the fullscreen viewer. The live art node MOVES into the viewer rather
 * than being copied: a <canvas> clone carries no pixels, and re-building the
 * overlay would decode the base painting a second time. closeViewer() moves it
 * back, and every path that replaces the stage closes the viewer first.
 */
function openViewer() {
    if (!state.assets[state.active] || isOpen(state.viewer.root)) return;
    renderViewer();
    showElement(state.viewer.root);
    lockBodyScroll();
}

function renderViewer() {
    const asset = state.assets[state.active];
    if (!asset) return;
    state.viewer.name.textContent = state.skinName;
    state.viewer.meta.textContent = (asset.w && asset.h)
        ? `${asset.label} 일러스트 · 원본 ${asset.w} × ${asset.h}`
        : `${asset.label} 일러스트`;
    state.viewer.fit.replaceChildren(assetNode(asset));
    applyFit(state.viewer.fit, asset, 'contain');
    toggleElement(state.viewer.foot, !!asset.faces);
    if (asset.faces) renderFaceSelection();
}

function closeViewer() {
    if (!isOpen(state.viewer?.root)) return;
    hideElement(state.viewer.root);
    const asset = state.assets[state.active];
    if (asset?.node) state.els.fit.replaceChildren(asset.node);
    unlockBodyScroll();
}

/**
 * Save the art as displayed, expression included. A composited asset is
 * snapshotted off its live <canvas> with toBlob — never toDataURL, which would
 * block the main thread for seconds on a 4096² canvas and hand back a 10-20 MB
 * base64 string. A plain <img> asset downloads straight from its source URL.
 */
async function saveCurrentArt() {
    const asset = state.assets[state.active];
    if (!asset) return;
    const filename = `${sanitizeFilename(`${state.skinName} ${asset.label} 일러스트`)}.png`;

    if (asset.node?._overlay) {
        if (asset.node._composePromise) await asset.node._composePromise;
        const canvas = asset.node.querySelector('canvas.base-image');
        if (asset.node._composed && canvas) {
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (blob) {
                const url = URL.createObjectURL(blob);
                await downloadImage(url, filename);
                // downloadImage anchors a blob: URL as-is and leaves revocation
                // to its creator; revoking in the same tick can cancel a
                // download the browser has only just been handed.
                setTimeout(() => URL.revokeObjectURL(url), 2000);
                return;
            }
        }
    }
    downloadImage(asset.url, filename);
}

// ===== Keyboard =====

/**
 * Escape closes whichever overlay is up; arrows step the expression while the
 * viewer is open. The overlays never stack, so first-match wins is enough.
 */
function onKeydown(e) {
    if (isOpen(state.grid?.root)) {
        if (e.key === 'Escape') { e.preventDefault(); closeFaceGrid(); }
        return;
    }
    if (!isOpen(state.viewer?.root)) return;
    switch (e.key) {
        case 'Escape': e.preventDefault(); closeViewer(); break;
        case 'ArrowLeft': e.preventDefault(); stepFace(-1); break;
        case 'ArrowRight': e.preventDefault(); stepFace(1); break;
    }
}

// ===== DOM helpers =====

function el(tag, className) {
    const node = document.createElement(tag);
    node.className = className;
    return node;
}

/**
 * The overlays are page-level siblings per the layout contract, but whether the
 * markup ships the empty shell or not is not worth coupling to — take the
 * element when it exists, otherwise create it. Either way this module owns the
 * children and the element starts hidden.
 */
function ensureOverlay(id, className) {
    let node = document.getElementById(id);
    if (!node) {
        node = document.createElement('div');
        node.id = id;
        document.body.appendChild(node);
    }
    node.className = className;
    hideElement(node);
    return node;
}

function isOpen(node) {
    return !!node && !node.classList.contains('hidden');
}

export { initStage, renderStage, clearStage };
