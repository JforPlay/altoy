/**
 * Equipment Research Tree
 * Renders gear lab upgrade trees with tabs for nationality/equip type
 */

import {
    fetchJSON, fetchJSONWithCache, debounce, getUrlParam, setUrlParams,
    getStorageItem, setStorageItem, setupScrollToTop,
    openModal, closeModal, setupModal
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

const PROP_ICON_URL = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/props';

// ===== Init =====

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
        if (loadingEl) loadingEl.textContent = '데이터 로딩 실패. 새로고침 해주세요.';
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

function renderCat1Tabs() {
    const container = document.getElementById('cat1Tabs');
    const sorted = Object.keys(categories).map(Number).sort((a, b) => a - b);

    container.innerHTML = sorted.map(c1 =>
        `<button class="cat1-tab" data-cat1="${c1}">${categories[c1].name}</button>`
    ).join('');
}

function renderCat2Tabs(cat1) {
    const container = document.getElementById('cat2Tabs');
    const cat2s = categories[cat1]?.cat2s || [];

    container.innerHTML = cat2s.map(c2 =>
        `<button class="cat2-tab" data-cat2="${c2.id}">${c2.name}</button>`
    ).join('');
}

// ===== Tab Selection =====

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

function renderTree(template) {
    const viewport = document.getElementById('treeViewport');
    const container = document.getElementById('treeContainer');
    const [canvasW, canvasH] = template.canvasSize;

    const containerW = viewport.clientWidth - 32; // account for padding
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

        const scaledX = x * scale;
        const scaledY = y * scale;

        nodesHtml += `
            <div class="tree-node" data-equip-id="${equipId}"
                 style="left: ${scaledX}px; top: ${scaledY}px;">
                <div class="tree-node-icon-wrap" style="width: ${nodeIconSize}px; height: ${nodeIconSize}px;">
                    <img class="tree-node-bg" src="${bgUrl}" alt="" draggable="false">
                    ${iconUrl ? `<img class="tree-node-img" src="${iconUrl}" alt="${name}" draggable="false">` : ''}
                </div>
                <div class="tree-node-name">${name}</div>
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

function selectNode(equipId) {
    selectedEquipId = equipId;

    document.querySelectorAll('.tree-node').forEach(node => {
        node.classList.toggle('selected', parseInt(node.dataset.equipId) === equipId);
    });

    setUrlParams({ equip: equipId }, { replace: true });
    renderEquipInfo(equipId);
}

// ===== Item Helpers =====

function getItemName(propId) {
    return itemData[String(propId)]?.name || `아이템 #${propId}`;
}

function getItemIconUrl(propId) {
    return `${PROP_ICON_URL}/${propId}.png`;
}

// ===== Equip Info Panel =====

function renderEquipInfo(equipId) {
    const panel = document.getElementById('upgradeInfo');
    const equip = liteMap[equipId];
    const upgrade = upgradeData[equipId];

    const name = equip?.name || `#${equipId}`;
    const iconUrl = getEquipIconUrl(equip?.icon || String(equipId));
    const bgUrl = getRarityBgUrl(equip?.rarity || 2);

    let html = `
        <div class="info-header">
            <div class="info-icon">
                <img class="info-icon-bg" src="${bgUrl}" alt="">
                ${iconUrl ? `<img class="info-icon-img" src="${iconUrl}" alt="${name}">` : ''}
            </div>
            <div class="info-details">
                <div class="info-name">${name}</div>
                <div class="info-meta">
                    ${equip ? `<span class="info-type">${equip.type_name2 || equip.type_name}</span>` : ''}
                    ${equip ? `<span class="info-rarity rarity-${equip.rarity}">${equip.rarity_name}</span>` : ''}
                </div>
            </div>
            <a class="info-link-btn" href="/altoy/equip/equip-viewer?equip=${equipId}" title="장비 DB에서 보기">
                <span class="material-symbols-outlined">open_in_new</span>
            </a>
        </div>
    `;

    if (upgrade) {
        const fromEquip = liteMap[upgrade.upgrade_from];
        const fromName = fromEquip?.name || `#${upgrade.upgrade_from}`;
        const fromIconUrl = getEquipIconUrl(fromEquip?.icon || String(upgrade.upgrade_from));
        const fromBgUrl = getRarityBgUrl(fromEquip?.rarity || 2);

        html += `
            <div class="info-upgrade">
                <div class="info-section-title">
                    <span class="material-symbols-outlined" style="font-size: 1rem;">science</span>
                    연구 비용
                </div>
                <div class="info-cost-row">
                    <span class="info-cost-label">필요 장비</span>
                    <span class="info-cost-value">
                        <span class="info-from-equip" data-equip-id="${upgrade.upgrade_from}" title="${fromName}">
                            <img class="info-from-icon-bg" src="${fromBgUrl}" alt="">
                            ${fromIconUrl ? `<img class="info-from-icon-img" src="${fromIconUrl}" alt="">` : ''}
                        </span>
                        ${fromName}
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
                            ${upgrade.material_consume.map(([propId, qty]) => `
                                <span class="info-material" data-prop-id="${propId}" title="${getItemName(propId)} - 클릭하여 필요 장비 보기">
                                    <img src="${getItemIconUrl(propId)}" alt="${getItemName(propId)}" loading="lazy">
                                    <span class="info-material-info">
                                        <span class="info-material-name">${getItemName(propId)}</span>
                                        <span class="info-material-qty">x${qty}</span>
                                    </span>
                                </span>
                            `).join('')}
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
        const equipCount = index[propId].length;

        const item = document.createElement('div');
        item.className = 'mat-browse-item';
        item.dataset.propId = propId;
        item.innerHTML = `
            <img src="${getItemIconUrl(propId)}" alt="${name}" loading="lazy">
            <div class="mat-browse-item-info">
                <div class="mat-browse-item-name">${name}</div>
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
    backBtn.className = 'mat-modal-back';
    backBtn.innerHTML = `<span class="material-symbols-outlined">arrow_back</span> 재료 목록으로`;
    backBtn.addEventListener('click', renderMatBrowseList);
    fragment.appendChild(backBtn);

    // Equipment grid
    const grid = document.createElement('div');
    grid.className = 'mat-equip-grid';

    for (const eq of equips) {
        const iconUrl = getEquipIconUrl(eq.icon);
        const bgUrl = getRarityBgUrl(eq.rarity);

        const card = document.createElement('div');
        card.className = 'mat-equip-card';
        card.dataset.equipId = eq.equipId;
        card.innerHTML = `
            <div class="mat-equip-card-icon">
                <img class="equip-bg" src="${bgUrl}" alt="">
                ${iconUrl ? `<img class="equip-img" src="${iconUrl}" alt="${eq.name}">` : ''}
            </div>
            <div class="mat-equip-card-info">
                <div class="mat-equip-card-name">${eq.name}</div>
                <div class="mat-equip-card-meta">
                    <span class="mat-equip-card-type">${eq.type_name}</span>
                    <span class="mat-equip-card-rarity rarity-${eq.rarity}">${eq.rarity_name}</span>
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

    // From-equip clicks in info panel (navigate within tree or to DB)
    document.getElementById('upgradeInfo').addEventListener('click', (e) => {
        const fromEquip = e.target.closest('.info-from-equip');
        if (fromEquip) {
            const fromId = parseInt(fromEquip.dataset.equipId);
            const inTree = currentTemplate?.equipments.some(eq => eq[2] === fromId);
            if (inTree) {
                selectNode(fromId);
            } else {
                window.location.href = `/altoy/equip/equip-viewer?equip=${fromId}`;
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
        closeOnEscape: true
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

    // Resize handler
    window.addEventListener('resize', debounce(() => {
        if (currentTemplate) renderTree(currentTemplate);
        // Re-select node after re-render
        if (selectedEquipId) {
            document.querySelectorAll('.tree-node').forEach(node => {
                node.classList.toggle('selected', parseInt(node.dataset.equipId) === selectedEquipId);
            });
        }
    }, 250));
}

// ===== Start =====
init();
