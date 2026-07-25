/**
 * dorm.grid.js
 * Isometric canvas grid renderer and interaction handler for the dorm simulator.
 * Manages camera (pan/zoom), furniture placement/drag/rotation/deletion,
 * sprite loading, and all canvas drawing for the 12×12 isometric grid.
 * Part of the dorm module group (viewer + data + grid + panel).
 */
import { getFurniture, getFurnitureSpriteUrl } from './dorm.data.js';

let state;
let canvas, ctx;

// ===== Constants =====
const GRID_SIZE = 12;
const TILE_W = 48;  // Isometric tile width
const TILE_H = 24;  // Isometric tile height (2:1 ratio)

// ===== Camera =====
const camera = { x: 0, y: 0, zoom: 1 };
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.1;

// ===== Interaction State =====
let hoverCell = null;       // {x, y} grid cell under cursor
let dragFurnitureId = null;  // Furniture ID being dragged from panel
let dragRotated = false;     // Rotation state of drag ghost
let isPanning = false;
let panStart = { x: 0, y: 0 };
let dragPlacedItem = null;   // Placed item being repositioned
let dragPlacedOffset = null; // Offset from item origin to grab point
let pendingDrag = null;      // Click on placed item, becomes drag on mouse move

// ===== Sprite Cache =====
const SPRITE_CACHE_LIMIT = 160;
const spriteCache = new Map();
const spriteLoading = new Set();

// ===== Colors =====
const COLORS = {
    gridLine: 'rgba(120, 140, 180, 0.3)',
    gridBorder: 'rgba(120, 140, 180, 0.6)',
    validGhost: 'rgba(80, 200, 80, 0.35)',
    invalidGhost: 'rgba(220, 60, 60, 0.35)',
    selection: 'rgba(100, 150, 255, 0.4)',
    selectionBorder: 'rgba(100, 150, 255, 0.8)',
    hover: 'rgba(255, 255, 255, 0.08)',
    occupiedCell: 'rgba(180, 140, 100, 0.15)',
    wallEdge: 'rgba(100, 120, 160, 0.2)',
    placeholderFill: 'rgba(100, 120, 160, 0.25)',
    placeholderStroke: 'rgba(100, 120, 160, 0.5)',
    placeholderText: 'rgba(200, 210, 230, 0.8)',
};

/** Receive the shared state reference from dorm.viewer.js. */
export function setup(stateRef) {
    state = stateRef;
}

// ===== Public API =====

/**
 * Initialize the canvas grid: size it, center the camera, bind all events,
 * and start the animation loop.
 */
export function init(canvasElement) {
    canvas = canvasElement;
    ctx = canvas.getContext('2d');
    resizeCanvas();
    centerCamera();
    bindEvents();
    rafId = requestAnimationFrame(renderLoop);
    // Pause the continuous render loop while the tab is hidden — the canvas
    // isn't visible and the loop would otherwise burn CPU/GPU in the background.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = null;
        } else if (rafId === null) {
            rafId = requestAnimationFrame(renderLoop);
        }
    });
}

// Drag-from-panel and click-to-place enter/exit the same internal state,
// but are exposed as two separate pairs for caller clarity.

/** Begin drag-from-panel placement mode for the given furniture ID. */
export function startDrag(furnitureId) {
    dragFurnitureId = furnitureId;
    dragRotated = false;
    canvas.parentElement.classList.add('place-ready');
}

/** Cancel an in-progress drag-from-panel, resetting all drag state. */
export function cancelDrag() {
    dragFurnitureId = null;
    dragPlacedItem = null;
    dragPlacedOffset = null;
    canvas.parentElement.classList.remove('place-ready');
    canvas.parentElement.classList.remove('drag-active');
}

/** Begin click-to-place mode (touch/mobile fallback for drag). */
export function startPlacementMode(furnitureId) {
    dragFurnitureId = furnitureId;
    dragRotated = false;
    canvas.parentElement.classList.add('place-ready');
}

/** Cancel click-to-place mode. */
export function cancelPlacementMode() {
    dragFurnitureId = null;
    canvas.parentElement.classList.remove('place-ready');
}

/**
 * Rotate the selected placed item 90°, or toggle drag ghost rotation if
 * placement mode is active. Reverts if the rotated position would be invalid.
 */
export function rotateSelected() {
    if (state.selected !== null) {
        const item = state.grid.placed[state.selected];
        if (!item) return;
        const furniture = getFurniture(item.furnitureId);
        if (!furniture || !furniture.canRotate) return;
        // Remove occupancy BEFORE flipping (so we clear the correct cells)
        removeFromOccupancy(item);
        item.rotated = !item.rotated;
        const size = getPlacedSize(item);
        if (isInBounds(item.x, item.y, size[0], size[1]) &&
            !hasOverlap(item.x, item.y, size[0], size[1], state.selected)) {
            addToOccupancy(item, state.selected);
        } else {
            // Revert rotation if invalid
            item.rotated = !item.rotated;
            addToOccupancy(item, state.selected);
        }
        updateStats();
    } else if (dragFurnitureId !== null) {
        dragRotated = !dragRotated;
    }
}

/** Remove the currently selected placed item and clear its occupancy cells. */
export function deleteSelected() {
    if (state.selected === null) return;
    const item = state.grid.placed[state.selected];
    if (item) removeFromOccupancy(item);
    state.grid.placed[state.selected] = null;
    state.selected = null;
    updateStats();
    updateToolbarState();
}

/** Remove all placed furniture and reset the occupancy grid. */
export function clearAll() {
    state.grid.placed = [];
    state.grid.cells = createEmptyGrid();
    state.selected = null;
    updateStats();
    updateToolbarState();
}

/** Sum the comfort value of all placed furniture items. */
export function getComfort() {
    let total = 0;
    for (const item of state.grid.placed) {
        if (!item) continue;
        const furniture = getFurniture(item.furnitureId);
        if (furniture) total += furniture.comfortable;
    }
    return total;
}

// ===== Coordinate Transforms =====

function gridToScreen(gx, gy) {
    const sx = (gx - gy) * (TILE_W / 2) * camera.zoom + camera.x;
    const sy = (gx + gy) * (TILE_H / 2) * camera.zoom + camera.y;
    return { x: sx, y: sy };
}

function screenToGrid(sx, sy) {
    const rx = (sx - camera.x) / camera.zoom;
    const ry = (sy - camera.y) / camera.zoom;
    const gx = (rx / (TILE_W / 2) + ry / (TILE_H / 2)) / 2;
    const gy = (ry / (TILE_H / 2) - rx / (TILE_W / 2)) / 2;
    return { x: Math.floor(gx), y: Math.floor(gy) };
}

// ===== Grid State =====

/** Return a fresh GRID_SIZE×GRID_SIZE 2D array of nulls (no occupancy). */
export function createEmptyGrid() {
    const cells = [];
    for (let x = 0; x < GRID_SIZE; x++) {
        cells[x] = [];
        for (let y = 0; y < GRID_SIZE; y++) {
            cells[x][y] = null;
        }
    }
    return cells;
}

function isInBounds(gx, gy, w, h) {
    return gx >= 0 && gy >= 0 && gx + w <= GRID_SIZE && gy + h <= GRID_SIZE;
}

function hasOverlap(gx, gy, w, h, excludeIdx) {
    for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) {
            const cell = state.grid.cells[gx + dx]?.[gy + dy];
            if (cell !== null && cell !== undefined && cell !== excludeIdx) return true;
        }
    }
    return false;
}

function isFloorType(type) {
    return type === 1 || type === 4 || type === 5;
}

function isWallValid(belong, gx, gy, w, h) {
    if (belong === 1) return true; // Floor furniture — no wall restriction
    if (belong === 2) {
        // Wall furniture — at least one edge must touch grid boundary
        return gx === 0 || gy === 0 || gx + w >= GRID_SIZE || gy + h >= GRID_SIZE;
    }
    if (belong === 3) return gy === 0; // Left wall
    if (belong === 4) return gx + w >= GRID_SIZE; // Right wall
    return true;
}

/**
 * Check whether furnitureId can be placed at (gx, gy) with given rotation.
 * Returns false if out of bounds, violates wall rules, or overlaps another item
 * (excluding excludeIdx so a dragged item doesn't block its own prior position).
 */
function canPlace(furnitureId, gx, gy, rotated, excludeIdx) {
    const furniture = getFurniture(furnitureId);
    if (!furniture) return false;
    // Game stores size as [depth, width]; we use [gridX, gridY] — swap here.
    const baseW = furniture.size[1], baseH = furniture.size[0];
    const [w, h] = rotated ? [baseH, baseW] : [baseW, baseH];
    if (!isInBounds(gx, gy, w, h)) return false;
    if (!isWallValid(furniture.belong, gx, gy, w, h)) return false;
    // Floor types don't block placement
    if (isFloorType(furniture.type)) return true; // floor/wallpaper can stack freely
    return !hasOverlap(gx, gy, w, h, excludeIdx !== undefined ? excludeIdx : -1);
}

function addToOccupancy(item, idx) {
    const furniture = getFurniture(item.furnitureId);
    if (!furniture || isFloorType(furniture.type)) return;
    const [w, h] = getPlacedSize(item);
    for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) {
            if (state.grid.cells[item.x + dx]) {
                state.grid.cells[item.x + dx][item.y + dy] = idx;
            }
        }
    }
}

function removeFromOccupancy(item) {
    const furniture = getFurniture(item.furnitureId);
    if (!furniture || isFloorType(furniture.type)) return;
    const [w, h] = getPlacedSize(item);
    for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) {
            if (state.grid.cells[item.x + dx]) {
                state.grid.cells[item.x + dx][item.y + dy] = null;
            }
        }
    }
}

function getPlacedSize(item) {
    const furniture = getFurniture(item.furnitureId);
    if (!furniture) return [1, 1];
    // Game size is [depth, width] — swap to [gridX, gridY] for our coordinate system
    const [w, h] = [furniture.size[1], furniture.size[0]];
    return item.rotated ? [h, w] : [w, h];
}

function placeFurnitureAt(furnitureId, gx, gy, rotated) {
    if (!canPlace(furnitureId, gx, gy, rotated)) return false;
    const idx = state.grid.placed.length;
    const item = { furnitureId, x: gx, y: gy, rotated };
    state.grid.placed.push(item);
    addToOccupancy(item, idx);
    updateStats();
    updateToolbarState();
    return true;
}

// ===== Sprite Loading =====

/**
 * Return a cached sprite Image for the given picture key, or null if it's
 * still loading. Kicks off the background fetch on the first call per key;
 * stores null in the cache on error so repeat calls don't retry endlessly.
 */
function getSprite(picture) {
    if (!picture) return null;
    if (spriteCache.has(picture)) return touchSpriteCache(picture);
    if (spriteLoading.has(picture)) return null;

    spriteLoading.add(picture);
    const img = new Image();
    img.src = getFurnitureSpriteUrl(picture);
    img.onload = () => {
        cacheSprite(picture, img);
        spriteLoading.delete(picture);
    };
    img.onerror = () => {
        cacheSprite(picture, null); // Mark as missing
        spriteLoading.delete(picture);
    };
    return null;
}

function touchSpriteCache(picture) {
    const cached = spriteCache.get(picture);
    spriteCache.delete(picture);
    spriteCache.set(picture, cached);
    return cached;
}

function cacheSprite(picture, sprite) {
    spriteCache.set(picture, sprite);
    pruneSpriteCache();
}

function pruneSpriteCache() {
    if (spriteCache.size <= SPRITE_CACHE_LIMIT) return;

    const activePictures = getActiveSpritePictures();
    for (const picture of spriteCache.keys()) {
        if (spriteCache.size <= SPRITE_CACHE_LIMIT) break;
        if (activePictures.has(picture)) continue;
        spriteCache.delete(picture);
    }
}

function getActiveSpritePictures() {
    const activePictures = new Set();

    for (const item of state.grid.placed) {
        if (item) addSpritePicture(activePictures, item.furnitureId);
    }

    if (dragFurnitureId !== null) addSpritePicture(activePictures, dragFurnitureId);
    if (dragPlacedItem) addSpritePicture(activePictures, dragPlacedItem.furnitureId);

    return activePictures;
}

function addSpritePicture(pictures, furnitureId) {
    const furniture = getFurniture(furnitureId);
    if (furniture?.picture) pictures.add(furniture.picture);
}

// ===== Rendering =====

let rafId = null;

function renderLoop() {
    render();
    rafId = requestAnimationFrame(renderLoop);
}

function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function centerCamera() {
    const rect = canvas.parentElement.getBoundingClientRect();
    camera.x = rect.width / 2;
    camera.y = rect.height * 0.3;
}

function render() {
    const rect = canvas.parentElement.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    drawGrid();
    drawOccupiedCells();
    drawPlacedFurniture();
    drawDragGhost();
    drawSelection();
    drawHoverHighlight();
}

function drawGrid() {
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = 0.5;

    // Draw diamond grid
    for (let i = 0; i <= GRID_SIZE; i++) {
        // Lines parallel to x-axis
        const startX = gridToScreen(i, 0);
        const endX = gridToScreen(i, GRID_SIZE);
        ctx.beginPath();
        ctx.moveTo(startX.x, startX.y);
        ctx.lineTo(endX.x, endX.y);
        ctx.stroke();

        // Lines parallel to y-axis
        const startY = gridToScreen(0, i);
        const endY = gridToScreen(GRID_SIZE, i);
        ctx.beginPath();
        ctx.moveTo(startY.x, startY.y);
        ctx.lineTo(endY.x, endY.y);
        ctx.stroke();
    }

    // Draw border
    ctx.strokeStyle = COLORS.gridBorder;
    ctx.lineWidth = 1.5;
    const tl = gridToScreen(0, 0);
    const tr = gridToScreen(GRID_SIZE, 0);
    const br = gridToScreen(GRID_SIZE, GRID_SIZE);
    const bl = gridToScreen(0, GRID_SIZE);
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.closePath();
    ctx.stroke();
}

function drawOccupiedCells() {
    for (let x = 0; x < GRID_SIZE; x++) {
        for (let y = 0; y < GRID_SIZE; y++) {
            if (state.grid.cells[x][y] !== null) {
                drawCellDiamond(x, y, COLORS.occupiedCell);
            }
        }
    }
}

function drawCellDiamond(gx, gy, fillColor) {
    const top = gridToScreen(gx, gy);
    const right = gridToScreen(gx + 1, gy);
    const bottom = gridToScreen(gx + 1, gy + 1);
    const left = gridToScreen(gx, gy + 1);

    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(right.x, right.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.lineTo(left.x, left.y);
    ctx.closePath();
    ctx.fill();
}

function drawAreaDiamond(gx, gy, w, h, fillColor, strokeColor) {
    const top = gridToScreen(gx, gy);
    const right = gridToScreen(gx + w, gy);
    const bottom = gridToScreen(gx + w, gy + h);
    const left = gridToScreen(gx, gy + h);

    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(right.x, right.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.lineTo(left.x, left.y);
    ctx.closePath();
    ctx.fill();

    if (strokeColor) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
}

function drawPlacedFurniture() {
    // Sort by depth (y + x for isometric ordering)
    const sorted = state.grid.placed
        .map((item, idx) => item ? { ...item, idx } : null)
        .filter(Boolean)
        .sort((a, b) => (a.x + a.y) - (b.x + b.y));

    for (const item of sorted) {
        const furniture = getFurniture(item.furnitureId);
        if (!furniture) continue;

        const [w, h] = getPlacedSize(item);
        const sprite = getSprite(furniture.picture);

        if (sprite) {
            drawFurnitureSprite(item, furniture, sprite, w, h);
        } else {
            drawFurniturePlaceholder(item, furniture, w, h);
        }
    }
}

/**
 * Draw a furniture sprite scaled to fit its isometric diamond footprint.
 * The sprite is centered horizontally on the diamond and bottom-aligned,
 * with the furniture's pixel offset applied afterwards. Rotation is simulated
 * by mirroring the sprite horizontally around the diamond center.
 */
function drawFurnitureSprite(item, furniture, sprite, w, h) {
    const top = gridToScreen(item.x, item.y);
    const right = gridToScreen(item.x + w, item.y);
    const bottom = gridToScreen(item.x + w, item.y + h);
    const left = gridToScreen(item.x, item.y + h);

    const minX = Math.min(top.x, right.x, bottom.x, left.x);
    const maxX = Math.max(top.x, right.x, bottom.x, left.x);
    const diamondW = maxX - minX;

    const scale = diamondW / sprite.width;
    const drawW = sprite.width * scale;
    const drawH = sprite.height * scale;

    const centerX = (minX + maxX) / 2;
    const drawX = centerX - drawW / 2;
    const drawY = bottom.y - drawH;

    const offsetX = (furniture.offset[0] || 0) * camera.zoom;
    const offsetY = (furniture.offset[1] || 0) * camera.zoom;

    const finalX = drawX + offsetX;
    const finalY = drawY + offsetY;

    if (item.rotated) {
        ctx.save();
        ctx.translate(centerX, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(sprite, centerX - (finalX + drawW), finalY, drawW, drawH);
        ctx.restore();
    } else {
        ctx.drawImage(sprite, finalX, finalY, drawW, drawH);
    }
}

function drawFurniturePlaceholder(item, furniture, w, h) {
    drawAreaDiamond(item.x, item.y, w, h, COLORS.placeholderFill, COLORS.placeholderStroke);

    // Draw name text
    const center = gridToScreen(item.x + w / 2, item.y + h / 2);
    ctx.fillStyle = COLORS.placeholderText;
    ctx.font = `${11 * camera.zoom}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = furniture.name.length > 6 ? furniture.name.slice(0, 6) + '…' : furniture.name;
    ctx.fillText(label, center.x, center.y);
}

function drawDragGhost() {
    if (dragFurnitureId === null || hoverCell === null) return;

    const furniture = getFurniture(dragFurnitureId);
    if (!furniture) return;

    const baseW = furniture.size[1], baseH = furniture.size[0];
    const [w, h] = dragRotated ? [baseH, baseW] : [baseW, baseH];
    const valid = canPlace(dragFurnitureId, hoverCell.x, hoverCell.y, dragRotated,
        dragPlacedItem !== null ? dragPlacedItem.idx : undefined);
    const color = valid ? COLORS.validGhost : COLORS.invalidGhost;

    drawAreaDiamond(hoverCell.x, hoverCell.y, w, h, color, null);

    // Also draw sprite ghost if available
    const sprite = getSprite(furniture.picture);
    if (sprite) {
        ctx.globalAlpha = 0.6;
        drawFurnitureSprite(
            { x: hoverCell.x, y: hoverCell.y, furnitureId: furniture.id, rotated: dragRotated },
            furniture, sprite, w, h
        );
        ctx.globalAlpha = 1;
    }
}

function drawSelection() {
    if (state.selected === null) return;
    const item = state.grid.placed[state.selected];
    if (!item) return;

    const [w, h] = getPlacedSize(item);
    drawAreaDiamond(item.x, item.y, w, h, COLORS.selection, COLORS.selectionBorder);
}

function drawHoverHighlight() {
    if (hoverCell === null || dragFurnitureId !== null) return;
    if (hoverCell.x < 0 || hoverCell.y < 0 ||
        hoverCell.x >= GRID_SIZE || hoverCell.y >= GRID_SIZE) return;
    drawCellDiamond(hoverCell.x, hoverCell.y, COLORS.hover);
}

// ===== Hit Testing =====

function findPlacedItemAt(gx, gy) {
    for (let i = state.grid.placed.length - 1; i >= 0; i--) {
        const item = state.grid.placed[i];
        if (!item) continue;
        const [w, h] = getPlacedSize(item);
        if (gx >= item.x && gx < item.x + w && gy >= item.y && gy < item.y + h) {
            return i;
        }
    }
    return -1;
}

// ===== Event Handling =====

function bindEvents() {
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Drag-and-drop from panel
    const container = canvas.parentElement;
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        const rect = canvas.getBoundingClientRect();
        hoverCell = screenToGrid(e.clientX - rect.left, e.clientY - rect.top);
    });
    container.addEventListener('drop', handleDrop);

    // Keyboard
    document.addEventListener('keydown', handleKeyDown);

    // Resize
    window.addEventListener('resize', () => {
        resizeCanvas();
        centerCamera();
    });

    // Zoom buttons
    state.elements.btnZoomIn?.addEventListener('click', () => {
        const rect = canvas.getBoundingClientRect();
        zoomAt(rect.width / 2, rect.height / 2, ZOOM_STEP);
    });
    state.elements.btnZoomOut?.addEventListener('click', () => {
        const rect = canvas.getBoundingClientRect();
        zoomAt(rect.width / 2, rect.height / 2, -ZOOM_STEP);
    });
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function handleMouseMove(e) {
    const pos = getMousePos(e);

    if (isPanning) {
        camera.x += pos.x - panStart.x;
        camera.y += pos.y - panStart.y;
        panStart = pos;
        return;
    }

    // Activate pending drag on first move
    if (pendingDrag && !dragPlacedItem) {
        const item = pendingDrag.item;
        dragPlacedItem = { ...item, idx: pendingDrag.idx };
        dragPlacedOffset = pendingDrag.grabOffset;
        dragFurnitureId = item.furnitureId;
        dragRotated = item.rotated;
        removeFromOccupancy(item);
        pendingDrag = null;
    }

    if (dragPlacedItem) {
        hoverCell = screenToGrid(pos.x, pos.y);
        if (dragPlacedOffset) {
            hoverCell.x -= dragPlacedOffset.x;
            hoverCell.y -= dragPlacedOffset.y;
        }
        return;
    }

    hoverCell = screenToGrid(pos.x, pos.y);
}

/**
 * Handle left-click (place / select) and right/middle-click (start pan).
 * Left-click while in placement mode places furniture; otherwise hits-tests
 * placed items and queues a pending drag that only activates on mousemove.
 */
function handleMouseDown(e) {
    const pos = getMousePos(e);
    const grid = screenToGrid(pos.x, pos.y);

    if (e.button === 1 || e.button === 2) {
        isPanning = true;
        panStart = pos;
        canvas.parentElement.classList.add('drag-active');
        return;
    }

    if (dragFurnitureId !== null && !dragPlacedItem) {
        if (canPlace(dragFurnitureId, grid.x, grid.y, dragRotated)) {
            placeFurnitureAt(dragFurnitureId, grid.x, grid.y, dragRotated);
            // Keep placement mode active so the user can place multiple copies.
        }
        return;
    }

    // Hit-test placed furniture; if found, queue a drag that activates on mousemove.
    const idx = findPlacedItemAt(grid.x, grid.y);
    if (idx >= 0) {
        state.selected = idx;
        updateToolbarState();

        // Prepare for potential drag (only activates on mouse move)
        const item = state.grid.placed[idx];
        pendingDrag = { idx, item, grabOffset: { x: grid.x - item.x, y: grid.y - item.y } };
        return;
    }

    state.selected = null;
    updateToolbarState();
}

function handleMouseUp(e) {
    if (isPanning) {
        isPanning = false;
        canvas.parentElement.classList.remove('drag-active');
        return;
    }

    if (pendingDrag) {
        // Click only — no drag happened, just clear pending.
        pendingDrag = null;
        return;
    }

    if (dragPlacedItem) {
        const item = state.grid.placed[dragPlacedItem.idx];
        if (item && hoverCell) {
            const adjustedX = hoverCell.x;
            const adjustedY = hoverCell.y;
            if (canPlace(item.furnitureId, adjustedX, adjustedY, dragRotated, dragPlacedItem.idx)) {
                item.x = adjustedX;
                item.y = adjustedY;
                item.rotated = dragRotated;
            }
            addToOccupancy(item, dragPlacedItem.idx);
        }
        dragPlacedItem = null;
        dragPlacedOffset = null;
        dragFurnitureId = null;
        canvas.parentElement.classList.remove('place-ready');
        updateStats();
        updateToolbarState();
    }
}

function handleMouseLeave() {
    hoverCell = null;
    if (isPanning) {
        isPanning = false;
        canvas.parentElement.classList.remove('drag-active');
    }
}

function handleDrop(e) {
    e.preventDefault();
    const furnitureId = Number(e.dataTransfer.getData('text/plain'));
    if (!furnitureId) return;

    const rect = canvas.getBoundingClientRect();
    const grid = screenToGrid(e.clientX - rect.left, e.clientY - rect.top);

    if (canPlace(furnitureId, grid.x, grid.y, dragRotated)) {
        placeFurnitureAt(furnitureId, grid.x, grid.y, dragRotated);
    }
    cancelDrag();
}

function handleWheel(e) {
    e.preventDefault();
    const pos = getMousePos(e);
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    zoomAt(pos.x, pos.y, delta);
}

function handleKeyDown(e) {
    if (e.target.tagName === 'INPUT') return;

    switch (e.key) {
        case 'r':
        case 'R':
            rotateSelected();
            break;
        case 'Delete':
        case 'Backspace':
            deleteSelected();
            break;
        case 'Escape':
            if (dragFurnitureId !== null) {
                cancelDrag();
                if (state.onPlacementCancel) state.onPlacementCancel();
            } else {
                state.selected = null;
                updateToolbarState();
            }
            break;
    }
}

function zoomAt(sx, sy, delta) {
    const oldZoom = camera.zoom;
    camera.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, camera.zoom + delta));
    const scale = camera.zoom / oldZoom;
    camera.x = sx - (sx - camera.x) * scale;
    camera.y = sy - (sy - camera.y) * scale;
}

// ===== Stats =====

function updateStats() {
    const comfort = getComfort();
    const count = state.grid.placed.filter(Boolean).length;
    state.comfort = comfort;
    if (state.elements.comfortValue) state.elements.comfortValue.textContent = comfort;
    if (state.elements.itemCount) state.elements.itemCount.textContent = count;
}

function updateToolbarState() {
    const hasSelection = state.selected !== null;
    const selectedItem = hasSelection ? state.grid.placed[state.selected] : null;
    const canRotate = selectedItem ? getFurniture(selectedItem.furnitureId)?.canRotate : false;

    if (state.elements.btnRotate) {
        const disabled = !hasSelection || !canRotate;
        state.elements.btnRotate.disabled = disabled;
        state.elements.btnRotate.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    }
    if (state.elements.btnDelete) {
        const disabled = !hasSelection;
        state.elements.btnDelete.disabled = disabled;
        state.elements.btnDelete.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    }
}
