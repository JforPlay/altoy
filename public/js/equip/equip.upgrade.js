/**
 * equip.upgrade.js
 * Renders the equipment research tree page (gear lab upgrade paths).
 * Standalone page script — not part of the equip viewer module group.
 * Uses equip.data.js for icon/rarity URL helpers but manages its own data and state.
 * Covers: category tabs, tree SVG rendering, node selection, equip info panel, material modal.
 */

import {
    fetchJSON, fetchJSONWithCache, debounce, getUrlParam, setUrlParams,
    getStorageItem, setStorageItem, setupScrollToTop,
    openModal, closeModal, setupModal, resolveUrl,
    getItemIconUrl, escapeHtml, renderStatus
} from '../utils.js';
import { getEquipIconUrl, getRarityBgUrl } from './equip.data.js';

// ===== Data =====
let templateData = {};
let upgradeData = {};
let liteMap = {};
let itemData = {};

// ===== State =====
let currentCat1 = null;
let currentCat2 = null;
let currentTemplate = null;
let selectedEquipId = null;
let matIndex = null;

// ===== Category Structure =====
let categories = {};

const CAT1_NAMES = {
    1: '이글 유니온', 2: '로열 네이비', 3: '사쿠라 엠파이어',
    4: '철혈', 6: '사르데냐 제국', 7: '북방연합', 10: '아이리스/비시아'
};

const CAT2_NAMES = {
    1: '구축함포', 2: '경순함포', 3: '중순함포', 4: '전함함포',
    5: '어뢰', 6: '대공포', 7: '전투기', 8: '뇌격기/폭격기',
    13: '잠수어뢰', 31: '경순함포'
};

function isActivationKey(event) {
    return event.key === 'Enter' || event.key === ' ';
}

// ===== Init =====

/**
 * Load all required data in parallel, then restore state from URL or localStorage.
 * item_data_lite is optional — falls back to prop ID numbers as names if missing.
 */
async function init() {
    const loadingEl = document.getElementById('loading');

    try {
        const [templates, upgrades, liteData] = await Promise.all([
            fetchJSON('data/equip/equip_upgrade_template.json'),
            fetchJSON('data/equip/equip_upgrade_data.json'),
            fetchJSON('data/equip/equip_data_lite.json')
        ]);

        // item_data_lite is optional — page works without it (names fallback to IDs)
        const items = await fetchJSONWithCache('data/equip/item_data_lite.json', { maxAge: 86400000 })
            .catch(() => ({}));

        templateData = templates;
        upgradeData = upgrades;
        itemData = items || {};
        for (const e of liteData) liteMap[e.id] = e;

        buildCategories();
        setupListeners();
    } catch (err) {
        renderStatus(loadingEl, '데이터 로딩 실패. 새로고침 해주세요.', 'error');
        console.error('Failed to initialize:', err);
        return;
    }

    if (loadingEl) loadingEl.style.display = 'none';

    // Handle URL params or restore saved state
    const equipParam = getUrlParam('equip');
    if (equipParam) {
        navigateToEquip(parseInt(equipParam));
    } else {
        const savedCat1 = getStorageItem('upgrade-cat1', null);
        const sortedCat1s = Object.keys(categories).map(Number).sort((a, b) => a - b);
        const startCat1 = savedCat1 != null && categories[savedCat1] ? Number(savedCat1) : sortedCat1s[0];
        selectCategory1(startCat1);
    }

    setupScrollToTop('scroll-to-top');
}

// ===== Build Categories =====

/**
 * Index all templates into a two-level category structure (cat1=nationality, cat2=equip type).
 * Sorts cat2 entries by ID within each cat1.
 */
function buildCategories() {
    for (const [id, tmpl] of Object.entries(templateData)) {
        if (tmpl.category1 == null || tmpl.category2 == null) continue;

        const c1 = tmpl.category1;
        const c2 = tmpl.category2;

        if (!categories[c1]) {
            categories[c1] = { name: CAT1_NAMES[c1] || `진영 ${c1}`, cat2s: [] };
        }

        categories[c1].cat2s.push({
            id: c2,
            name: CAT2_NAMES[c2] || `타입 ${c2}`,
            templateId: id
        });
    }

    for (const cat of Object.values(categories)) {
        cat.cat2s.sort((a, b) => a.id - b.id);
    }

    renderCat1Tabs();
}

// ===== Tab Rendering =====

// Cat1 = nationality tabs (top row), Cat2 = equip type tabs (second row)
function renderCat1Tabs() {
    const container = document.getElementById('cat1Tabs');
    const sorted = Object.keys(categories).map(Number).sort((a, b) => a - b);

    container.innerHTML = sorted.map(c1 =>
        `<button class="cat1-tab" type="button" data-cat1="${c1}">${escapeHtml(categories[c1].name)}</button>`
    ).join('');
}

function renderCat2Tabs(cat1) {
    const container = document.getElementById('cat2Tabs');
    const cat2s = categories[cat1]?.cat2s || [];

    container.innerHTML = cat2s.map(c2 =>
        `<button class="cat2-tab" type="button" data-cat2="${c2.id}">${escapeHtml(c2.name)}</button>`
    ).join('');
}

// ===== Tab Selection =====

/** Select a cat1 tab, save to localStorage, re-render cat2 tabs, and auto-select first cat2. */
function selectCategory1(cat1, autoSelectCat2 = true) {
    currentCat1 = cat1;
    setStorageItem('upgrade-cat1', cat1);

    document.querySelectorAll('.cat1-tab').forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.cat1) === cat1);
    });

    renderCat2Tabs(cat1);

    if (autoSelectCat2) {
        const cat2s = categories[cat1]?.cat2s || [];
        if (cat2s.length > 0) selectCategory2(cat2s[0].id);
    }
}

function selectCategory2(cat2) {
    currentCat2 = cat2;

    document.querySelectorAll('.cat2-tab').forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.cat2) === cat2);
    });

    const cat2Entry = categories[currentCat1]?.cat2s.find(c => c.id === cat2);
    if (cat2Entry) {
        currentTemplate = templateData[cat2Entry.templateId];
        renderTree(currentTemplate);
    }

    selectedEquipId = null;
    document.getElementById('upgradeInfo').innerHTML = '';
}

// ===== Tree Rendering =====

/**
 * Render the research tree into #treeContainer at a responsive scale.
 * SVG polylines with arrowhead polygons show upgrade connections.
 * Nodes are absolutely positioned divs scaled to fit the viewport width.
 */
function renderTree(template) {
    const viewport = document.getElementById('treeViewport');
    const container = document.getElementById('treeContainer');
    const [canvasW, canvasH] = template.canvasSize;

    const containerW = Math.max(viewport.clientWidth - 32, 320); // account for padding
    const scale = Math.min(containerW / canvasW, 1);
    const scaledH = canvasH * scale;
    const nodeIconSize = Math.max(Math.round(48 * (containerW / 1000)), 36);

    // SVG for connection lines
    let svgContent = '';
    for (const points of template.links) {
        const pointsStr = points.map(p => p.join(',')).join(' ');
        svgContent += `<polyline points="${pointsStr}" class="tree-link-line"/>`;

        // Arrow at endpoint
        if (points.length >= 2) {
            svgContent += renderArrow(points[points.length - 2], points[points.length - 1]);
        }
    }

    // Equipment nodes
    let nodesHtml = '';
    for (const equip of template.equipments) {
        const [x, y, equipId] = equip;
        const lite = liteMap[equipId];
        const iconUrl = getEquipIconUrl(lite?.icon || String(equipId));
        const bgUrl = getRarityBgUrl(lite?.rarity || 2);
        const name = lite?.name || `#${equipId}`;
        const safeName = escapeHtml(name);

        const scaledX = x * scale;
        const scaledY = y * scale;

        nodesHtml += `
            <div class="tree-node" role="button" tabindex="0" aria-pressed="false" aria-label="${escapeHtml(name)}" data-equip-id="${equipId}"
                 style="left: ${scaledX}px; top: ${scaledY}px;">
                <div class="tree-node-icon-wrap" style="width: ${nodeIconSize}px; height: ${nodeIconSize}px;">
                    <img class="tree-node-bg" src="${bgUrl}" alt="" draggable="false">
                    ${iconUrl ? `<img class="tree-node-img" src="${iconUrl}" alt="${safeName}" draggable="false">` : ''}
                </div>
                <div class="tree-node-name">${safeName}</div>
            </div>
        `;
    }

    container.innerHTML = `
        <svg class="tree-links-svg" width="${containerW}" height="${scaledH}"
             viewBox="0 0 ${canvasW} ${canvasH}" preserveAspectRatio="xMinYMin meet">
            ${svgContent}
        </svg>
        ${nodesHtml}
    `;

    container.style.height = `${scaledH}px`;
}

/** Render an SVG arrowhead polygon at the endpoint of a link, pointing toward `to`. */
function renderArrow(from, to) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return '';

    const nx = dx / len;
    const ny = dy / len;
    const size = 20;

    const tip = to;
    const left = [tip[0] - size * nx + size * 0.4 * ny, tip[1] - size * ny - size * 0.4 * nx];
    const right = [tip[0] - size * nx - size * 0.4 * ny, tip[1] - size * ny + size * 0.4 * nx];

    return `<polygon points="${tip.join(',')},${left.join(',')},${right.join(',')}" class="tree-arrow"/>`;
}

// ===== Node Selection =====

/** Mark the clicked node as selected, update the URL, and render the info panel. */
function selectNode(equipId) {
    selectedEquipId = equipId;

    document.querySelectorAll('.tree-node').forEach(node => {
        const isSelected = parseInt(node.dataset.equipId) === equipId;
        node.classList.toggle('selected', isSelected);
        node.setAttribute('aria-pressed', String(isSelected));
    });

    setUrlParams({ equip: equipId }, { replace: true });
    renderEquipInfo(equipId);
}

// ===== Item Helpers =====

// Prop name/icon lookups — item_data_lite is optional; IDs are shown as fallback
function getItemName(propId) {
    return itemData[String(propId)]?.name || `아이템 #${propId}`;
}

// ===== Equip Info Panel =====

/**
 * Render the info panel for a selected tree node.
 * Shows icon, name, type, rarity, a link to the equip DB, and upgrade cost details.
 * If no upgrade record exists (base equip), shows an explanatory fallback message.
 */
function renderEquipInfo(equipId) {
    const panel = document.getElementById('upgradeInfo');
    const equip = liteMap[equipId];
    const upgrade = upgradeData[equipId];

    const name = equip?.name || `#${equipId}`;
    const iconUrl = getEquipIconUrl(equip?.icon || String(equipId));
    const bgUrl = getRarityBgUrl(equip?.rarity || 2);
    const safeName = escapeHtml(name);
    const safeTypeName = escapeHtml(equip?.type_name2 || equip?.type_name || '');
    const safeRarityName = escapeHtml(equip?.rarity_name || '');

    let html = `
        <div class="info-header">
            <div class="info-icon">
                <img class="info-icon-bg" src="${bgUrl}" alt="">
                ${iconUrl ? `<img class="info-icon-img" src="${iconUrl}" alt="${safeName}">` : ''}
            </div>
            <div class="info-details">
                <div class="info-name">${safeName}</div>
                <div class="info-meta">
                    ${equip ? `<span class="info-type">${safeTypeName}</span>` : ''}
                    ${equip ? `<span class="info-rarity rarity-${equip.rarity}">${safeRarityName}</span>` : ''}
                </div>
            </div>
            <a class="info-link-btn btn btn-close" href="${resolveUrl(`equip/equip-viewer?equip=${equipId}`)}" title="장비 DB에서 보기">
                <span class="material-symbols-outlined">open_in_new</span>
            </a>
        </div>
    `;

    if (upgrade) {
        const fromEquip = liteMap[upgrade.upgrade_from];
        const fromName = fromEquip?.name || `#${upgrade.upgrade_from}`;
        const fromIconUrl = getEquipIconUrl(fromEquip?.icon || String(upgrade.upgrade_from));
        const fromBgUrl = getRarityBgUrl(fromEquip?.rarity || 2);
        const safeFromName = escapeHtml(fromName);

        html += `
            <div class="info-upgrade">
                <div class="info-section-title">
                    <span class="material-symbols-outlined" style="font-size: 1rem;">science</span>
                    연구 비용
                </div>
                <div class="info-cost-row">
                    <span class="info-cost-label">필요 장비</span>
                    <span class="info-cost-value">
                        <span class="info-from-equip" data-equip-id="${upgrade.upgrade_from}" title="${escapeHtml(fromName)}">
                            <img class="info-from-icon-bg" src="${fromBgUrl}" alt="">
                            ${fromIconUrl ? `<img class="info-from-icon-img" src="${fromIconUrl}" alt="">` : ''}
                        </span>
                        ${safeFromName}
                    </span>
                </div>
                <div class="info-cost-row">
                    <span class="info-cost-label">코인</span>
                    <span class="info-cost-value">${upgrade.coin_consume.toLocaleString()}</span>
                </div>
                ${upgrade.material_consume.length > 0 ? `
                    <div class="info-cost-row">
                        <span class="info-cost-label">재료</span>
                        <span class="info-cost-value info-materials">
                            ${upgrade.material_consume.map(([propId, qty]) => {
                                const itemName = getItemName(propId);
                                const safeItemName = escapeHtml(itemName);
                                return `
                                <span class="info-material" data-prop-id="${propId}" title="${escapeHtml(`${itemName} - 클릭하여 필요 장비 보기`)}">
                                    <img src="${getItemIconUrl(propId)}" alt="${safeItemName}" loading="lazy">
                                    <span class="info-material-info">
                                        <span class="info-material-name">${safeItemName}</span>
                                        <span class="info-material-qty">x${qty}</span>
                                    </span>
                                </span>
                            `;
                            }).join('')}
                        </span>
                    </div>
                ` : ''}
            </div>
        `;
    } else {
        html += `<div class="info-no-upgrade">이 장비는 연구 입력 장비이거나 연구 데이터가 없습니다.</div>`;
    }

    panel.innerHTML = html;
}

// ===== Navigate to Equip =====

/**
 * Find which template contains equipId, switch to that nationality/type tab, and select the node.
 * Falls back to clearing the URL param and loading the default tab if not found.
 */
function navigateToEquip(equipId) {
    for (const [id, tmpl] of Object.entries(templateData)) {
        if (tmpl.category1 == null || tmpl.category2 == null) continue;
        const found = tmpl.equipments.some(e => e[2] === equipId);
        if (found) {
            selectCategory1(tmpl.category1, false);
            selectCategory2(tmpl.category2);
            selectNode(equipId);
            return;
        }
    }

    // Equip not found — clear stale URL param and load default
    setUrlParams({ equip: null }, { replace: true });
    const sortedCat1s = Object.keys(categories).map(Number).sort((a, b) => a - b);
    if (sortedCat1s.length > 0) selectCategory1(sortedCat1s[0]);
}

// ===== Material Modal =====

/**
 * Build (and cache) a reverse index: propId → list of equips that need it.
 * Skips equipment not in liteMap (e.g., filtered-out entries without names).
 * Sorts each list by rarity desc, then name, for consistent display order.
 */
function getMaterialIndex() {
    if (matIndex) return matIndex;

    // Build reverse index: materialId -> [{equipId, qty, equipName, ...}]
    matIndex = {};
    for (const [equipId, info] of Object.entries(upgradeData)) {
        if (!info || !info.material_consume) continue;
        const equip = liteMap[parseInt(equipId)];
        if (!equip) continue; // Skip filtered-out equipment (no name/icon)
        for (const [propId, qty] of info.material_consume) {
            if (!matIndex[propId]) matIndex[propId] = [];
            matIndex[propId].push({
                equipId: parseInt(equipId),
                qty,
                name: equip?.name || `#${equipId}`,
                icon: equip?.icon || String(equipId),
                rarity: equip?.rarity || 2,
                type_name: equip?.type_name2 || equip?.type_name || '',
                rarity_name: equip?.rarity_name || ''
            });
        }
    }

    // Sort each list by rarity desc, then name
    for (const list of Object.values(matIndex)) {
        list.sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name));
    }

    return matIndex;
}

function openMatBrowse() {
    openModal('matModal', { onOpen: () => renderMatBrowseList() });
}

function openMatEquipFilter(propId) {
    openModal('matModal', { onOpen: () => renderMatEquipList(propId) });
}

function renderMatBrowseList() {
    const body = document.getElementById('matModalBody');
    const title = document.getElementById('matModalTitle');
    const subtitle = document.getElementById('matModalSubtitle');
    const headerIcon = document.querySelector('#matModalHeader > .material-symbols-outlined');

    title.textContent = '연구 재료 목록';
    subtitle.textContent = '재료를 선택하면 해당 재료가 필요한 장비를 확인할 수 있습니다';
    if (headerIcon) {
        headerIcon.textContent = 'inventory_2';
        headerIcon.style.display = '';
    }
    // Remove any header icon img if present
    const existingImg = document.querySelector('#matModalHeader > .mat-modal-header-icon');
    if (existingImg) existingImg.remove();

    const index = getMaterialIndex();
    const sortedIds = Object.keys(index).map(Number).sort((a, b) => a - b);

    const fragment = document.createDocumentFragment();
    const grid = document.createElement('div');
    grid.className = 'mat-browse-grid';

    for (const propId of sortedIds) {
        const name = getItemName(propId);
        const safeName = escapeHtml(name);
        const equipCount = index[propId].length;

        const item = document.createElement('div');
        item.className = 'mat-browse-item';
        item.dataset.propId = propId;
        item.setAttribute('role', 'button');
        item.tabIndex = 0;
        item.innerHTML = `
            <img src="${getItemIconUrl(propId)}" alt="${safeName}" loading="lazy">
            <div class="mat-browse-item-info">
                <div class="mat-browse-item-name">${safeName}</div>
                <div class="mat-browse-item-count">장비 ${equipCount}종</div>
            </div>
        `;
        grid.appendChild(item);
    }

    fragment.appendChild(grid);
    body.innerHTML = '';
    body.appendChild(fragment);
}

function renderMatEquipList(propId) {
    const body = document.getElementById('matModalBody');
    const title = document.getElementById('matModalTitle');
    const subtitle = document.getElementById('matModalSubtitle');
    const headerIcon = document.querySelector('#matModalHeader > .material-symbols-outlined');

    const name = getItemName(propId);
    title.textContent = name;
    subtitle.textContent = '이 재료가 필요한 장비 목록';

    // Replace header icon with material image
    if (headerIcon) headerIcon.style.display = 'none';
    let headerImg = document.querySelector('#matModalHeader > .mat-modal-header-icon');
    if (!headerImg) {
        headerImg = document.createElement('img');
        headerImg.className = 'mat-modal-header-icon';
        const headerInfo = document.getElementById('matModalHeader').querySelector('.mat-modal-header-info');
        document.getElementById('matModalHeader').insertBefore(headerImg, headerInfo);
    }
    headerImg.src = getItemIconUrl(propId);
    headerImg.alt = name;

    const index = getMaterialIndex();
    const equips = index[propId] || [];

    const fragment = document.createDocumentFragment();

    // Back button
    const backBtn = document.createElement('button');
    backBtn.className = 'mat-modal-back btn btn-ghost btn-sm';
    backBtn.innerHTML = `<span class="material-symbols-outlined">arrow_back</span> 재료 목록으로`;
    backBtn.addEventListener('click', renderMatBrowseList);
    fragment.appendChild(backBtn);

    // Equipment grid
    const grid = document.createElement('div');
    grid.className = 'mat-equip-grid';

    for (const eq of equips) {
        const iconUrl = getEquipIconUrl(eq.icon);
        const bgUrl = getRarityBgUrl(eq.rarity);
        const safeName = escapeHtml(eq.name);
        const safeTypeName = escapeHtml(eq.type_name);
        const safeRarityName = escapeHtml(eq.rarity_name);

        const card = document.createElement('div');
        card.className = 'mat-equip-card';
        card.dataset.equipId = eq.equipId;
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        card.innerHTML = `
            <div class="mat-equip-card-icon">
                <img class="equip-bg" src="${bgUrl}" alt="">
                ${iconUrl ? `<img class="equip-img" src="${iconUrl}" alt="${safeName}">` : ''}
            </div>
            <div class="mat-equip-card-info">
                <div class="mat-equip-card-name">${safeName}</div>
                <div class="mat-equip-card-meta">
                    <span class="mat-equip-card-type">${safeTypeName}</span>
                    <span class="mat-equip-card-rarity rarity-${eq.rarity}">${safeRarityName}</span>
                    <span class="mat-equip-card-qty">x${eq.qty}</span>
                </div>
            </div>
        `;
        grid.appendChild(card);
    }

    fragment.appendChild(grid);
    body.innerHTML = '';
    body.appendChild(fragment);
}

// ===== Event Listeners =====

/**
 * Wire all event listeners using event delegation where possible.
 * Resize re-renders the current tree and re-applies the selected node highlight.
 */
function setupListeners() {
    // Cat1 tab clicks (event delegation)
    document.getElementById('cat1Tabs').addEventListener('click', (e) => {
        const btn = e.target.closest('.cat1-tab');
        if (btn) selectCategory1(Number(btn.dataset.cat1));
    });

    // Cat2 tab clicks (event delegation)
    document.getElementById('cat2Tabs').addEventListener('click', (e) => {
        const btn = e.target.closest('.cat2-tab');
        if (btn) selectCategory2(Number(btn.dataset.cat2));
    });

    // Tree node clicks (event delegation)
    document.getElementById('treeContainer').addEventListener('click', (e) => {
        const node = e.target.closest('.tree-node');
        if (node) selectNode(parseInt(node.dataset.equipId));
    });

    document.getElementById('treeContainer').addEventListener('keydown', (e) => {
        if (!isActivationKey(e)) return;
        const node = e.target.closest('.tree-node');
        if (!node) return;
        e.preventDefault();
        selectNode(parseInt(node.dataset.equipId));
    });

    // From-equip clicks in info panel (navigate within tree or to DB)
    document.getElementById('upgradeInfo').addEventListener('click', (e) => {
        const fromEquip = e.target.closest('.info-from-equip');
        if (fromEquip) {
            const fromId = parseInt(fromEquip.dataset.equipId);
            const inTree = currentTemplate?.equipments.some(eq => eq[2] === fromId);
            if (inTree) {
                selectNode(fromId);
            } else {
                window.location.href = resolveUrl(`equip/equip-viewer?equip=${fromId}`);
            }
            return;
        }

        // Material chip clicks → open modal with that material's equip list
        const matChip = e.target.closest('.info-material');
        if (matChip) {
            openMatEquipFilter(parseInt(matChip.dataset.propId));
        }
    });

    // Material browse button
    document.getElementById('matBrowseBtn').addEventListener('click', openMatBrowse);

    // Setup modal close handlers (close button, backdrop, ESC)
    setupModal('matModal', {
        closeButtonSelector: '#matModalClose',
        closeOnBackdrop: true,
        closeOnEscape: true,
        restoreFocus: true
    });

    // Material browse/equip card clicks (event delegation on modal body)
    document.getElementById('matModalBody').addEventListener('click', (e) => {
        const browseItem = e.target.closest('.mat-browse-item');
        if (browseItem) {
            renderMatEquipList(parseInt(browseItem.dataset.propId));
            return;
        }

        const equipCard = e.target.closest('.mat-equip-card');
        if (equipCard) {
            const equipId = parseInt(equipCard.dataset.equipId);
            closeModal('matModal');
            navigateToEquip(equipId);
        }
    });

    document.getElementById('matModalBody').addEventListener('keydown', (e) => {
        if (!isActivationKey(e)) return;

        const browseItem = e.target.closest('.mat-browse-item');
        if (browseItem) {
            e.preventDefault();
            renderMatEquipList(parseInt(browseItem.dataset.propId));
            return;
        }

        const equipCard = e.target.closest('.mat-equip-card');
        if (equipCard) {
            e.preventDefault();
            const equipId = parseInt(equipCard.dataset.equipId);
            closeModal('matModal');
            navigateToEquip(equipId);
        }
    });

    // Resize handler
    window.addEventListener('resize', debounce(() => {
        if (currentTemplate) renderTree(currentTemplate);
        // Re-select node after re-render
        if (selectedEquipId) {
            document.querySelectorAll('.tree-node').forEach(node => {
                const isSelected = parseInt(node.dataset.equipId) === selectedEquipId;
                node.classList.toggle('selected', isSelected);
                node.setAttribute('aria-pressed', String(isSelected));
            });
        }
    }, 250));
}

// ===== Start =====
init();
