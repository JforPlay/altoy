/**
 * shipgirl-tracker.js
 * Fleet tech point tracker for all shipgirls.
 * Cards render all ships with get/level/upgrade checkboxes; scores update live as boxes are checked.
 * Features: filter drawer (rarity/nationality/type/stat chips), bulk operations, goal tracker modal,
 * faction tech bonus display, and cross-tab sync via the storage event (shares SAVE_KEY with research-tracker.js).
 */

import { debounce, fetchJSON, getStorageItem, setStorageItem, openModal, closeModal, setupModal, showElement, hideElement, syncedStorage, escapeHtml, RARITY_TIERS_DESC as rarityOrder, requireElements, renderStatus, loadPageData } from '../utils.js';
import { parseInvestment, nextBreakCost, sumInvestment, rosterTotal, BREAK_LEVELS, applyCapChange, applyMaskChange, AFF_LABELS, SKL_LABELS, MEMO_MAX } from './tracker-investment.js';
import { ShipgirlTrackerUtils } from './shipgirl-tracker-utils.js';
import { createStatusMenu } from './shipgirl-tracker.status-menu.js';
document.addEventListener('DOMContentLoaded', () => {
    let fullShipData, nationalityData, shipTypeData, attrTypeData, fleetTechGoalData, factionTechData;
    let filteredShipIds = [];
    const SAVE_KEY = 'shipgirlTrackerProgress';
    const GOAL_KEY = 'shipgirlTrackerSelectedGoal';
    const FILTER_KEY = 'shipgirlTrackerFilters';
    const VIEW_KEY = 'shipgirlTrackerView'; // UI pref — NOT in SYNCED_KEYS, on purpose

    // ===== State =====

    let maxFleetTech = 0;

    // Cached DOM elements for performance
    let cachedElements = {
        fleetTechContainer: null,
        statTechContainer: null,
        shipListContainer: null,
        filterDrawerBody: null,
        totalScoreValue: null,
        totalScoreMax: null
    };
    const shipCardById = new Map();

    function getShipCards() {
        return Array.from(shipCardById.values());
    }

    function getCardProgressState(card) {
        let state = 0;
        if (card?._cb?.get?.checked) state |= 1;
        if (card?._cb?.level?.checked) state |= 2;
        if (card?._cb?.upgrade?.checked) state |= 4;
        return state;
    }

    // Assumes a card exists for every shipId that should be persisted.
    // If card creation ever becomes filtered, switch back to merge-with-storage.
    function collectProgressFromCards() {
        const progress = {};
        getShipCards().forEach(card => {
            const state = getCardProgressState(card);
            if (state > 0) {
                progress[card.dataset.shipId] = state;
            }
        });
        return progress;
    }

    function isProgressFilterActive() {
        const progressFilter = document.getElementById('progress-filter');
        return progressFilter && progressFilter.value !== 'all';
    }

    /**
     * Caches frequently accessed DOM elements for performance optimization.
     */
    function cacheDOMElements() {
        cachedElements.fleetTechContainer = document.getElementById('fleet-tech-container');
        cachedElements.statTechContainer = document.getElementById('stat-tech-container');
        cachedElements.shipListContainer = document.getElementById('ship-list-container');
        cachedElements.filterDrawerBody = document.getElementById('filter-drawer-body');
        cachedElements.totalScoreValue = document.getElementById('total-score-value');
        cachedElements.totalScoreMax = document.getElementById('total-score-max');
    }

    // ===== View Toggle (ledger/cards — local pref, not synced) =====

    /** Switches #ship-list-container between ledger rows and vertical cards. */
    function applyView(view) {
        cachedElements.shipListContainer.dataset.view = view;
        // #ledger-head visibility is owned by inline style.display ONLY — never mix with hideElement.
        const head = document.getElementById('ledger-head');
        if (head) head.style.display = view === 'ledger' ? '' : 'none';
        document.getElementById('view-toggle-icon').textContent = view === 'ledger' ? 'grid_view' : 'view_list';
        document.getElementById('view-toggle-label').textContent = view === 'ledger' ? '카드' : '목록';
        setStorageItem(VIEW_KEY, view);
    }

    /**
     * Pins #ledger-head just below the sticky control surface. Both stick at
     * navbar height, but the surface wins on z-index — pinning the head at
     * --navbar-height alone slides it invisibly under the surface on scroll,
     * so the head's offset must add the surface's live height (it wraps).
     */
    function updateStickyOffset() {
        const surface = document.querySelector('.st-control-surface');
        if (!surface) return;
        const nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--navbar-height')) || 65;
        document.documentElement.style.setProperty('--st-sticky-h', `${nav + surface.offsetHeight}px`);
    }

    // Use utilities from external file
    const { parseDatasetInt, filterSearchDropdown, setupDropdownToggle, parseProgress } = ShipgirlTrackerUtils;

    // Progress (SAVE_KEY) is shared with research-tracker.js via cross-tab storage events.
    // syncedStorage handles persistence + cross-tab sync; onRemoteChange runs only when
    // ANOTHER tab writes the key.
    const progressStore = syncedStorage(SAVE_KEY, {
        parse: parseProgress,
        onRemoteChange: (next) => {
            applyProgress(next);
            if (isProgressFilterActive()) {
                applyFilters();
            } else {
                calculateAndDisplayScores();
            }
        },
    });

    const INVEST_KEY = 'shipgirlInvestment';
    let investment = {};
    let rarityByGid = {};
    const statusMenu = createStatusMenu();

    // Investment records (cap/ret/fav/aff/skl/memo) — state-as-truth in this map,
    // unlike progress where the checkboxes are truth. v1 envelope from day 1.
    const investmentStore = syncedStorage(INVEST_KEY, {
        parse: parseInvestment,
        version: 1,
        debounce: 200,
        onRemoteChange: (next) => {
            investment = next;
            getShipCards().forEach(card => renderInvestmentCells(card, card.dataset.shipId));
            updateInvestmentSummary();
            if (isInvestmentFilterActive()) applyFilters();
        },
    });

    function isInvestmentFilterActive() {
        return ['fav-filter', 'retro-filter', 'aff-filter', 'skl-filter', 'memo-filter']
            .some(id => (document.getElementById(id)?.value || 'all') !== 'all');
    }

    function getInv(gid) { return investment[gid] || {}; }

    function setInv(gid, patch) {
        const next = { ...getInv(gid), ...patch };
        // drop zero/empty fields to keep the payload sparse
        Object.keys(next).forEach(k => { if (!next[k]) delete next[k]; });
        if (Object.keys(next).length === 0) delete investment[gid];
        else investment[gid] = next;
        investmentStore.save(investment);
    }

    /**
     * Lookup ship data by name for goal tracker.
     * @param {string} shipName - Ship name to search for.
     * @returns {object|null} Ship data or null if not found.
     */
    function getShipDataByName(shipName) {
        return Object.values(fullShipData).find(ship => ship.name === shipName) ||
               Object.values(fullShipData).find(ship =>
                   ship.name && (ship.name.includes(shipName) || shipName.includes(ship.name))
               ) || null;
    }

    // ===== Card Rendering =====

    /**
     * Build a ship card DOM element with fleet tech checkboxes, stat bonus info, and metadata badges.
     * All filter-relevant data is stored as data-* attributes for fast applyFilters() queries.
     */
    function createShipCard(ship, shipId) {
        const card = document.createElement('div');
        card.className = 'ship-card';

        card.dataset.shipId = shipId;
        card.dataset.nationality = ship.nationality;
        card.dataset.type = ship.type;
        card.dataset.rarity = ship.rarity;
        card.dataset.name = ship.name;
        card.dataset.ptGet = ship.pt_get ?? 0;
        card.dataset.ptLevel = ship.pt_level ?? 0;
        card.dataset.ptUpgrade = ship.pt_upgrage ?? 0;

        if (ship.add_get_attr) {
            card.dataset.addGetAttr = ship.add_get_attr;
            card.dataset.addGetShiptype = ship.add_get_shiptype.join(',');
            card.dataset.addGetValue = ship.add_get_value;
        }
        if (ship.add_level_attr) {
            card.dataset.addLevelAttr = ship.add_level_attr;
            card.dataset.addLevelShiptype = ship.add_level_shiptype.join(',');
            card.dataset.addLevelValue = ship.add_level_value;
        }

        const icon = document.createElement('img');
        icon.src = ship.icon;
        icon.alt = ship.name;
        icon.className = 'ship-icon';
        icon.loading = 'lazy';
        const iconCell = document.createElement('div');
        iconCell.className = 'lr-icon';
        iconCell.appendChild(icon);
        card.appendChild(iconCell);

        // Name cell: ★ + name + expander, sub-line with 진영/함종 icons + rarity badge
        // (rarity.css badge — ledger view compacts it, cards view shows it full-size)
        const nameCell = document.createElement('div');
        nameCell.className = 'lr-name';
        const nationInfo = nationalityData[ship.nationality];
        const typeInfo = shipTypeData[ship.type];
        let subHtml = '';
        if (nationInfo) subHtml +=
            `<span class="lr-sub-item">${nationInfo.image ? `<img src="${escapeHtml(nationInfo.image)}" alt="" class="lr-sub-icon" loading="lazy">` : ''}${escapeHtml(nationInfo.name)}</span>`;
        if (typeInfo) subHtml +=
            `<span class="lr-sub-item">${typeInfo.icon ? `<img src="${escapeHtml(typeInfo.icon)}" alt="" class="lr-sub-icon" loading="lazy">` : ''}${escapeHtml(typeInfo.type_name)}</span>`;
        if (ship.rarity) subHtml +=
            `<span class="rarity-badge rarity-${escapeHtml(String(ship.rarity))}">${escapeHtml(String(ship.rarity))}</span>`;
        nameCell.innerHTML =
            `<div class="lr-nm">` +
            `<button type="button" class="lr-star" data-action="fav" aria-label="즐겨찾기" aria-pressed="false">☆</button>` +
            `<span class="lr-nm-text">${escapeHtml(ship.name)}</span>` +
            `<button type="button" class="lr-expander" data-action="expand" aria-label="상세 정보" aria-expanded="false">` +
            `<span class="material-symbols-outlined">expand_more</span></button></div>` +
            `<div class="lr-sub">${subHtml}</div>`;
        card.appendChild(nameCell);

        // Progress group: 보유 → 풀돌 → Lv120 (tracker order; mask bits unchanged).
        // display:contents in the desktop ledger keeps the three grid tracks.
        const progress = document.createElement('div');
        progress.className = 'lr-progress';
        [['get', '보유'], ['upgrade', '풀돌'], ['level', 'Lv120']].forEach(([type, label]) => {
            const cell = document.createElement('label');
            cell.className = 'lr-ck';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'tracker-checkbox';
            cb.dataset.type = type;
            cb.setAttribute('aria-label', `${ship.name} ${label}`);
            const mLabel = document.createElement('i');
            mLabel.className = 'lr-ck-label';
            mLabel.textContent = label;
            cell.appendChild(cb);
            cell.appendChild(mLabel);
            progress.appendChild(cell);
        });
        card.appendChild(progress);

        // Placeholder cells — tasks 3 fills these (cap bar, chips, memo).
        const capCell = document.createElement('div');
        capCell.className = 'lr-cap';
        card.appendChild(capCell);
        const chipsCell = document.createElement('div');
        chipsCell.className = 'lr-chips';
        card.appendChild(chipsCell);
        const memoCell = document.createElement('div');
        memoCell.className = 'lr-memo';
        card.appendChild(memoCell);

        // Per-ship tech points
        const ptCell = document.createElement('div');
        ptCell.className = 'lr-pt';
        card.appendChild(ptCell);
        card._pt = ptCell;

        // Cards-view detail affordance (ledger uses the name-row expander;
        // display:none there keeps it out of the ledger grid's track count).
        const detailToggle = document.createElement('button');
        detailToggle.type = 'button';
        detailToggle.className = 'lr-detail-toggle';
        detailToggle.dataset.action = 'expand';
        detailToggle.setAttribute('aria-expanded', 'false');
        detailToggle.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">expand_more</span>입수·기술 정보`;
        card.appendChild(detailToggle);

        // Detail strip (hidden until expanded in either view).
        const detail = document.createElement('div');
        detail.className = 'lr-detail';
        const descHtml = (ship.description || []).map(d => `<li>• ${escapeHtml(d)}</li>`).join('');
        let statHtml = '';
        if (ship.add_get_attr) {
            const attrName = attrTypeData[ship.add_get_attr]?.condition || '';
            const types = ship.add_get_shiptype.map(t => shipTypeData[t]?.type_name || '').filter(Boolean).join('/');
            statHtml += `<span><i class="lr-dk">입수 스탯</i>${escapeHtml(types)} ${escapeHtml(attrName)} +${escapeHtml(ship.add_get_value)}</span>`;
        }
        if (ship.add_level_attr) {
            const attrName = attrTypeData[ship.add_level_attr]?.condition || '';
            const types = ship.add_level_shiptype.map(t => shipTypeData[t]?.type_name || '').filter(Boolean).join('/');
            statHtml += `<span><i class="lr-dk">120 스탯</i>${escapeHtml(types)} ${escapeHtml(attrName)} +${escapeHtml(ship.add_level_value)}</span>`;
        }
        detail.innerHTML =
            (descHtml ? `<span><i class="lr-dk">입수 방법</i><ul class="lr-desc">${descHtml}</ul></span>` : '') +
            statHtml +
            `<span class="lr-nextbreak"></span>`;
        card.appendChild(detail);

        // Rarity edge color
        if (ship.rarity) card.classList.add(`lr-rar-${String(ship.rarity).toLowerCase()}`);

        // Cache checkbox references to avoid repeated querySelector calls
        card._cb = {
            get: card.querySelector('[data-type="get"]'),
            level: card.querySelector('[data-type="level"]'),
            upgrade: card.querySelector('[data-type="upgrade"]')
        };

        return card;
    }

    /**
     * Fills a card's investment cells (cap bar, 육성 chips, memo button, next-break hint)
     * from the current `investment` record for `gid`. Called once per card from
     * renderAllCards (after loadProgress), and again after any mutation.
     */
    function renderInvestmentCells(card, gid) {
        const ship = fullShipData[gid];
        const rec = getInv(gid);
        const cap = rec.cap || 0;

        const capCell = card.querySelector('.lr-cap');
        // data-break = target cap value 0..5; 100 = no breaks (direct reset).
        capCell.innerHTML = `<span class="lr-cell-label">상한 해제 (성정 유닛)</span>`
            + [100, ...BREAK_LEVELS].map((lvl, i) => {
                const on = cap >= i;
                const cls = on ? (i === 5 ? 'on u2' : 'on') : '';
                const name = i === 0 ? `${ship.name} 상한 해제 없음 (Lv100)` : `${ship.name} Lv${lvl} 상한 해제`;
                return `<button type="button" data-action="cap" data-break="${i}" class="${cls}" aria-pressed="${on}" aria-label="${escapeHtml(name)}">${lvl}</button>`;
            }).join('');

        const chipsCell = card.querySelector('.lr-chips');
        const retChip = ship.retrofit
            ? `<button type="button" class="chip lr-chip ${rec.ret ? 'is-done' : ''}" data-action="ret"`
                + ` aria-pressed="${!!rec.ret}" aria-label="${escapeHtml(ship.name)} 개장 ${rec.ret ? '완료' : '미완'}">개장</button>`
            : `<span class="lr-chip-ghost"></span>`;
        const aff = rec.aff || 0;
        const skl = rec.skl || 0;
        const stateCls = (v, max) => v === 0 ? '' : (v === max ? 'is-done' : 'is-mid');
        const affLabel = aff === 0 ? '호감작' : `호감 · ${AFF_LABELS[aff]}`;
        const sklLabel = SKL_LABELS[skl]; // 스작 labels self-identify
        const menuChip = (action, cls, label, name) =>
            `<button type="button" class="chip lr-chip ${cls}" data-action="${action}"`
            + ` aria-haspopup="menu" aria-expanded="false" aria-label="${escapeHtml(name)}">`
            + `${escapeHtml(label)}<span class="material-symbols-outlined lr-chip-caret" aria-hidden="true">arrow_drop_down</span></button>`;
        chipsCell.innerHTML = `<span class="lr-cell-label">육성</span>` + retChip
            + menuChip('aff', stateCls(aff, 4), affLabel, `${ship.name} 호감작: ${AFF_LABELS[aff]}`)
            + menuChip('skl', stateCls(skl, 3), sklLabel, `${ship.name} 스작: ${SKL_LABELS[skl]}`);

        const star = card.querySelector('.lr-star');
        star.textContent = rec.fav ? '★' : '☆';
        star.classList.toggle('on', !!rec.fav);
        star.setAttribute('aria-pressed', String(!!rec.fav));

        const memoCell = card.querySelector('.lr-memo');
        memoCell.innerHTML = `<button type="button" class="lr-memo-btn ${rec.memo ? 'has' : ''}" data-action="memo" aria-label="${escapeHtml(ship.name)} 메모">`
            + `<span class="material-symbols-outlined">edit_note</span><span class="lr-memo-txt">메모</span></button>`;

        const next = nextBreakCost(cap, ship.rarity);
        const nb = card.querySelector('.lr-nextbreak');
        if (nb) nb.innerHTML = next
            ? `<i class="lr-dk">다음 돌파</i>Lv${next.level} → 성정 유닛 ${next.u1.toLocaleString()}${next.u2 ? ` + 유닛II ${next.u2.toLocaleString()}` : ''}`
            : (cap >= 5 ? `<i class="lr-dk">돌파</i>완료 (Lv125)` : '');
    }

    /** Updates the 유닛/유닛II invested-vs-roster-total counters in the score bar. */
    function updateInvestmentSummary() {
        const spent = sumInvestment(investment, rarityByGid);
        const total = rosterTotal(rarityByGid);
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v.toLocaleString(); };
        set('unit1-invested', spent.u1); set('unit1-total', total.u1);
        set('unit2-invested', spent.u2); set('unit2-total', total.u2);
    }

    /**
     * Handles the logic for checkbox interactions within a ship card.
     * For example, checking "120 달성시" will also check "입수 시".
     * @param {HTMLInputElement} checkbox - The checkbox that was changed.
     */
    function handleCheckboxLogic(checkbox) {
        const card = checkbox.closest('.ship-card');
        if (!card) return;
        const { get: getCheckbox, level: levelCheckbox, upgrade: upgradeCheckbox } = card._cb;
        if (checkbox.checked) {
            // If level or upgrade is checked, 'get' must also be checked.
            if ((checkbox.dataset.type === 'level' || checkbox.dataset.type === 'upgrade') && getCheckbox) {
                getCheckbox.checked = true;
            }
        } else {
            // If 'get' is unchecked, level and upgrade must also be unchecked.
            if (checkbox.dataset.type === 'get') {
                if (levelCheckbox) levelCheckbox.checked = false;
                if (upgradeCheckbox) upgradeCheckbox.checked = false;
            }
        }
    }

    /** Write a 3-bit mask into a card's cached checkboxes (shared by save/couple/apply paths). */
    function writeMaskToCheckboxes(card, mask) {
        if (card._cb.get) card._cb.get.checked = (mask & 1) > 0;
        if (card._cb.level) card._cb.level.checked = (mask & 2) > 0;
        if (card._cb.upgrade) card._cb.upgrade.checked = (mask & 4) > 0;
    }

    /** Write a 3-bit mask back into a card's checkboxes + persist. */
    function setCardMask(card, mask) {
        writeMaskToCheckboxes(card, mask);
        autoSaveProgress();
        if (isProgressFilterActive()) applyFilters(); else debouncedCalculateScores();
    }

    /**
     * Shared coupling step after a progress checkbox changed: keeps cap in sync with
     * the mask via applyMaskChange, writes back any resulting mask/cap changes, and
     * re-renders. Used by both the container `change` listener and bulkCheck (which
     * drives checkboxes directly via handleCheckboxLogic, bypassing that listener).
     */
    function coupleCardAfterChange(card, changedType, nowChecked) {
        const gid = card.dataset.shipId;
        const { mask, cap } = applyMaskChange(
            getCardProgressState(card), getInv(gid).cap || 0,
            changedType, nowChecked);
        if (cap !== (getInv(gid).cap || 0)) setInv(gid, { cap });
        if (mask !== getCardProgressState(card)) writeMaskToCheckboxes(card, mask);
        renderInvestmentCells(card, gid);
        updateInvestmentSummary();
    }

    /**
     * Calculates the scores based on the checked items and updates the display.
     * Returns calculated scores for reuse by goal tracker.
     */
    function calculateAndDisplayScores() {
        // Initialize score objects efficiently
        const fleetTech = Object.fromEntries(Object.keys(nationalityData).map(id => [id, 0]));
        const statTech = Object.fromEntries(Object.keys(attrTypeData).map(id => [id, {}]));
        const fleetTechByName = {}; // For goal tracker (by nationality name)
        const positionCounts = {}; // For goal tracker (by position)
        let ownedCount = 0;

        // Iterate over all ship cards to calculate scores (cached card map — no DOM query)
        const shipCards = getShipCards();
        shipCards.forEach(card => {
            const data = card.dataset;
            const nationId = data.nationality;
            // A ship can carry a nationality absent from nationality_mapping.json
            // (발파라이소 = 12). Without this seed the three `+=` below land on
            // undefined and NaN the whole total. renderFleetTechTable already
            // skips unmapped ids, so the points only count toward the total —
            // which is right, since maxFleetTech counts them too.
            if (fleetTech[nationId] === undefined) fleetTech[nationId] = 0;
            const nationalityName = nationalityData[nationId]?.name;
            const typeId = data.type;
            const position = shipTypeData[typeId]?.position;
            const isGetChecked = card._cb.get?.checked;
            const isLevelChecked = card._cb.level?.checked;
            const isUpgradeChecked = card._cb.upgrade?.checked;
            if (isGetChecked) ownedCount++;

            if (isGetChecked) {
                fleetTech[nationId] += parseDatasetInt(data.ptGet);

                // Calculate for goal tracker (avoid duplicate calculation)
                if (nationalityName) {
                    if (!fleetTechByName[nationalityName]) fleetTechByName[nationalityName] = 0;
                    fleetTechByName[nationalityName] += parseDatasetInt(data.ptGet);
                }
                if (nationalityName && position) {
                    if (!positionCounts[nationalityName]) positionCounts[nationalityName] = {};
                    if (!positionCounts[nationalityName][position]) positionCounts[nationalityName][position] = 0;
                    positionCounts[nationalityName][position]++;
                }

                if (data.addGetAttr) {
                    data.addGetShiptype.split(',').forEach(type => {
                        if (!statTech[data.addGetAttr]) statTech[data.addGetAttr] = {};
                        if (!statTech[data.addGetAttr][type]) statTech[data.addGetAttr][type] = { get: 0, level: 0 };
                        statTech[data.addGetAttr][type].get += parseDatasetInt(data.addGetValue);
                    });
                }
            }
            if (isLevelChecked) {
                fleetTech[nationId] += parseDatasetInt(data.ptLevel);

                // Add to goal tracker scores
                if (nationalityName) {
                    if (!fleetTechByName[nationalityName]) fleetTechByName[nationalityName] = 0;
                    fleetTechByName[nationalityName] += parseDatasetInt(data.ptLevel);
                }

                if (data.addLevelAttr) {
                    data.addLevelShiptype.split(',').forEach(type => {
                        if (!statTech[data.addLevelAttr]) statTech[data.addLevelAttr] = {};
                        if (!statTech[data.addLevelAttr][type]) statTech[data.addLevelAttr][type] = { get: 0, level: 0 };
                        statTech[data.addLevelAttr][type].level += parseDatasetInt(data.addLevelValue);
                    });
                }
            }
            if (isUpgradeChecked) {
                fleetTech[nationId] += parseDatasetInt(data.ptUpgrade);

                // Add to goal tracker scores
                if (nationalityName) {
                    if (!fleetTechByName[nationalityName]) fleetTechByName[nationalityName] = 0;
                    fleetTechByName[nationalityName] += parseDatasetInt(data.ptUpgrade);
                }
            }

            const earned = (isGetChecked ? parseDatasetInt(data.ptGet) : 0)
                + (isLevelChecked ? parseDatasetInt(data.ptLevel) : 0)
                + (isUpgradeChecked ? parseDatasetInt(data.ptUpgrade) : 0);
            const totalPt = parseDatasetInt(data.ptGet) + parseDatasetInt(data.ptLevel) + parseDatasetInt(data.ptUpgrade);
            const ptCell = card._pt;
            if (ptCell) ptCell.innerHTML = `<span class="lr-cell-label">기술 Pt</span><b>${earned}</b>${earned < totalPt ? ` <small>/ ${totalPt}</small>` : ''}`;
            card.classList.toggle('lr-unowned', !isGetChecked);
        });

        // Update total fleet tech score indicator
        const totalCurrent = Object.values(fleetTech).reduce((sum, v) => sum + v, 0);
        if (cachedElements.totalScoreValue) {
            cachedElements.totalScoreValue.textContent = totalCurrent.toLocaleString();
        }

        // 보유 n/881 counter
        const ownedCountEl = document.getElementById('owned-count');
        const ownedTotalEl = document.getElementById('owned-total');
        if (ownedCountEl) ownedCountEl.textContent = ownedCount.toLocaleString();
        if (ownedTotalEl) ownedTotalEl.textContent = shipCards.length.toLocaleString();

        // Render the updated score tables.
        renderFleetTechTable(fleetTech);
        renderStatTechTable(statTech);
        updateGoalDisplay(fleetTechByName, positionCounts); // Pass pre-calculated data

        // Calculate and render faction tech bonuses
        const factionBonuses = calculateFactionTechBonuses(fleetTechByName);
        renderFactionTechBonuses(factionBonuses);
    }

    // ===== Scores =====

    // Create debounced version for checkbox changes (150ms delay)
    const debouncedCalculateScores = debounce(calculateAndDisplayScores, 150);

    /**
     * Calculates faction tech levels and bonuses based on current scores.
     * Only uses: id, groupid, pt, add fields from fleet_tech_template.json
     * @param {object} fleetTechByName - Fleet tech scores by nationality name.
     * @returns {object} Faction tech levels and bonuses for each faction.
     */
    function calculateFactionTechBonuses(fleetTechByName) {
        const factionBonuses = {};

        // Process each nationality to find their faction groupid
        Object.entries(nationalityData).forEach(([natId, natData]) => {
            const groupId = parseInt(natId);
            if (isNaN(groupId) || groupId < 1 || groupId > 4) return;

            const nationName = natData.name;
            const currentScore = fleetTechByName[nationName] || 0;

            // Find highest tech level achieved based on pt (required score)
            let currentLevel = 0;
            let activeTechData = null;

            for (let level = 1; level <= 9; level++) {
                const techId = `${groupId}00${level}`;
                const techData = factionTechData[techId];

                if (techData && currentScore >= techData.pt) {
                    currentLevel = level;
                    activeTechData = techData;
                } else {
                    break;
                }
            }

            if (activeTechData && currentLevel > 0) {
                // Build per-shipType per-attr bonus map
                // add field format: [[ship_type_ids], attr_type, value]
                // bonusByShipType: { shipTypeId: { attrType: value, ... }, ... }
                const bonusByShipType = {};

                activeTechData.add.forEach(([shipTypes, attrType, value]) => {
                    shipTypes.forEach(typeId => {
                        if (!bonusByShipType[typeId]) bonusByShipType[typeId] = {};
                        bonusByShipType[typeId][attrType] = (bonusByShipType[typeId][attrType] || 0) + value;
                    });
                });

                factionBonuses[groupId] = {
                    name: nationName,
                    level: currentLevel,
                    score: currentScore,
                    nextLevelScore: factionTechData[`${groupId}00${currentLevel + 1}`]?.pt || null,
                    bonusByShipType
                };
            }
        });

        return factionBonuses;
    }

    /**
     * Renders the faction tech bonuses display.
     * Layout: compact faction level cards at top, then one bonus table per faction.
     * @param {object} factionBonuses - Calculated faction bonuses.
     */
    function renderFactionTechBonuses(factionBonuses) {
        const container = document.getElementById('faction-tech-container');
        if (!container) return;

        container.innerHTML = '';
        container.className = 'faction-tech-wrapper';

        const factionEntries = Object.entries(factionBonuses).filter(([, d]) => d && d.level > 0);
        if (factionEntries.length === 0) return;

        // Header
        const header = document.createElement('div');
        header.className = 'faction-tech-header';
        header.textContent = '진영 기술 보너스';
        container.appendChild(header);

        // Compact faction level cards row
        const levelRow = document.createElement('div');
        levelRow.className = 'faction-level-row';

        factionEntries.forEach(([, data]) => {
            const card = document.createElement('div');
            card.className = 'faction-level-card';

            const nameEl = document.createElement('span');
            nameEl.className = 'faction-name';
            nameEl.textContent = data.name;

            const levelEl = document.createElement('span');
            levelEl.className = `faction-level${data.level === 9 ? ' max-level' : ''}`;
            levelEl.textContent = `Lv ${data.level}`;

            card.appendChild(nameEl);
            card.appendChild(levelEl);

            if (data.nextLevelScore) {
                const progressEl = document.createElement('span');
                progressEl.className = 'faction-progress';
                progressEl.textContent = `${data.score} / ${data.nextLevelScore}`;
                card.appendChild(progressEl);
            } else {
                const maxEl = document.createElement('span');
                maxEl.className = 'faction-progress faction-max';
                maxEl.textContent = 'MAX';
                card.appendChild(maxEl);
            }

            levelRow.appendChild(card);
        });
        container.appendChild(levelRow);

        // Aggregate all factions into one combined table
        const combined = {}; // { shipTypeId: { attrType: totalValue } }
        const allAttrs = new Set();

        factionEntries.forEach(([, data]) => {
            Object.entries(data.bonusByShipType).forEach(([typeId, attrs]) => {
                if (!combined[typeId]) combined[typeId] = {};
                Object.entries(attrs).forEach(([attrId, value]) => {
                    combined[typeId][attrId] = (combined[typeId][attrId] || 0) + value;
                    allAttrs.add(attrId);
                });
            });
        });

        if (Object.keys(combined).length === 0) return;

        const sortedAttrs = Array.from(allAttrs).sort((a, b) => a - b);
        const sortedShipTypes = Object.keys(combined).sort((a, b) => a - b);

        const table = document.createElement('table');
        table.className = 'score-table faction-bonus-table';

        // Header: 함종 | attr columns
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        const thShipType = document.createElement('th');
        thShipType.textContent = '함종';
        headerRow.appendChild(thShipType);
        sortedAttrs.forEach(attrId => {
            const th = document.createElement('th');
            th.textContent = attrTypeData[attrId]?.condition || `속성 ${attrId}`;
            headerRow.appendChild(th);
        });

        // Body: one row per ship type
        const tbody = table.createTBody();
        sortedShipTypes.forEach(typeId => {
            const row = tbody.insertRow();
            const typeCell = row.insertCell();
            typeCell.className = 'header-col';
            typeCell.textContent = shipTypeData[typeId]?.type_name || `타입 ${typeId}`;

            sortedAttrs.forEach(attrId => {
                const cell = row.insertCell();
                const val = combined[typeId][attrId];
                if (val) {
                    cell.textContent = `+${val}`;
                    cell.className = 'bonus-cell';
                } else {
                    cell.textContent = '-';
                    cell.className = 'bonus-cell empty';
                }
            });
        });

        container.appendChild(table);
    }

    /**
     * Renders the fleet tech score table.
     * @param {object} scores - The calculated fleet tech scores.
     */
    function renderFleetTechTable(scores) {
        const container = cachedElements.fleetTechContainer;
        if (!container) return;
        container.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'score-table-wrapper';

        const title = document.createElement('h2');
        title.textContent = '진영 점수';
        wrapper.appendChild(title);

        const table = document.createElement('table');
        table.className = 'score-table';

        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        headerRow.innerHTML = '<th>진영</th><th>점수</th>';

        const tbody = table.createTBody();
        Object.keys(scores).forEach(id => {
            if (nationalityData[id] && scores[id] > 0) {
                const row = tbody.insertRow();
                const cell1 = row.insertCell();
                cell1.className = 'header-col';
                cell1.textContent = nationalityData[id].name;
                const cell2 = row.insertCell();
                cell2.textContent = scores[id];
            }
        });

        wrapper.appendChild(table);
        container.appendChild(wrapper);
    }

    /**
     * Renders the stat tech score table (transposed: ship types as rows, attrs as columns).
     * @param {object} scores - { attrId: { shipTypeId: { get, level } } }
     */
    function renderStatTechTable(scores) {
        const container = cachedElements.statTechContainer;
        if (!container) return;
        container.innerHTML = '';

        // Collect all ship types and attr types that have data
        const shipTypeSet = new Set();
        const attrSet = new Set();
        for (const attrId in scores) {
            for (const typeId in scores[attrId]) {
                const s = scores[attrId][typeId];
                if (s.get > 0 || s.level > 0) {
                    shipTypeSet.add(typeId);
                    attrSet.add(attrId);
                }
            }
        }

        if (shipTypeSet.size === 0) return;

        const sortedAttrs = Array.from(attrSet).sort((a, b) => a - b);
        const sortedShipTypes = Array.from(shipTypeSet).sort((a, b) => a - b);

        const wrapper = document.createElement('div');
        wrapper.className = 'score-table-wrapper';

        const title = document.createElement('h2');
        title.textContent = '함대 기술점수 (획득/120렙)';
        wrapper.appendChild(title);

        const table = document.createElement('table');
        table.className = 'score-table faction-bonus-table';

        // Header: 함종 | attr columns
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        const thType = document.createElement('th');
        thType.textContent = '함종';
        headerRow.appendChild(thType);
        sortedAttrs.forEach(attrId => {
            const th = document.createElement('th');
            th.textContent = attrTypeData[attrId]?.condition || `스탯 ${attrId}`;
            headerRow.appendChild(th);
        });

        // Body: one row per ship type
        const tbody = table.createTBody();
        sortedShipTypes.forEach(typeId => {
            const row = tbody.insertRow();
            const typeCell = row.insertCell();
            typeCell.className = 'header-col';
            typeCell.textContent = shipTypeData[typeId]?.type_name || `타입 ${typeId}`;

            sortedAttrs.forEach(attrId => {
                const cell = row.insertCell();
                const s = scores[attrId]?.[typeId] || { get: 0, level: 0 };
                if (s.get > 0 || s.level > 0) {
                    cell.textContent = `+${s.get} / +${s.level}`;
                    cell.className = 'bonus-cell';
                } else {
                    cell.textContent = '-';
                    cell.className = 'bonus-cell empty';
                }
            });
        });

        wrapper.appendChild(table);
        container.appendChild(wrapper);
    }

    /**
     * Gets or sets the selected goal ship name.
     */
    function getSelectedGoal() {
        const saved = getStorageItem(GOAL_KEY, null);
        if (saved && fleetTechGoalData[saved]) {
            return saved;
        }
        // Default to first ship
        return Object.keys(fleetTechGoalData)[0];
    }

    function setSelectedGoal(shipName) {
        setStorageItem(GOAL_KEY, shipName);
    }

    /**
     * Renders the goal tracker content inside #goal-modal-body.
     */
    function renderGoalTracker() {
        const goalModalBody = document.getElementById('goal-modal-body');
        if (!goalModalBody) return;

        goalModalBody.innerHTML = '';

        // Create selection controls container
        const selectionContainer = document.createElement('div');
        selectionContainer.className = 'goal-selection-container';

        // Create dropdown for goal selection
        const dropdownWrapper = document.createElement('div');
        dropdownWrapper.className = 'goal-dropdown-wrapper';

        const dropdownLabel = document.createElement('label');
        dropdownLabel.textContent = '현재 목표:';
        dropdownLabel.className = 'goal-dropdown-label';

        const dropdown = document.createElement('select');
        dropdown.id = 'goal-select-dropdown';
        dropdown.className = 'goal-select-dropdown';

        // Group ships by project
        const projects = [...new Set(Object.values(fleetTechGoalData).map(ship => ship.project))].sort((a, b) => a - b);

        projects.forEach(project => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = `${project}기`;

            Object.entries(fleetTechGoalData)
                .filter(([name, data]) => data.project === project)
                .forEach(([shipName, goalData]) => {
                    const option = document.createElement('option');
                    option.value = shipName;
                    option.textContent = `${shipName} (${goalData.rarity_type})`;
                    optgroup.appendChild(option);
                });

            dropdown.appendChild(optgroup);
        });

        const selectedGoal = getSelectedGoal();
        dropdown.value = selectedGoal;

        dropdown.addEventListener('change', (e) => {
            setSelectedGoal(e.target.value);
            updateGoalDisplay();
            updateQuickButtons();
        });

        dropdownWrapper.appendChild(dropdownLabel);
        dropdownWrapper.appendChild(dropdown);
        selectionContainer.appendChild(dropdownWrapper);

        // Create quick selection buttons container
        const quickButtonsWrapper = document.createElement('div');
        quickButtonsWrapper.className = 'goal-quick-buttons-wrapper';

        const quickLabel = document.createElement('div');
        quickLabel.textContent = '빠른 선택:';
        quickLabel.className = 'goal-quick-label';
        quickButtonsWrapper.appendChild(quickLabel);

        const quickButtonsContainer = document.createElement('div');
        quickButtonsContainer.id = 'goal-quick-buttons';
        quickButtonsContainer.className = 'goal-quick-buttons';

        quickButtonsWrapper.appendChild(quickButtonsContainer);
        selectionContainer.appendChild(quickButtonsWrapper);

        // Create detail card container
        const detailContainer = document.createElement('div');
        detailContainer.id = 'goal-detail-container';
        detailContainer.className = 'goal-detail-container';

        // Assemble into modal body
        goalModalBody.appendChild(selectionContainer);
        goalModalBody.appendChild(detailContainer);

        // Initial render
        updateQuickButtons();
        updateGoalDisplay();
    }

    /**
     * Updates the quick selection buttons based on current goal's project.
     */
    function updateQuickButtons() {
        const quickButtonsContainer = document.getElementById('goal-quick-buttons');
        if (!quickButtonsContainer) return;

        quickButtonsContainer.innerHTML = '';

        const selectedGoal = getSelectedGoal();
        const selectedProject = fleetTechGoalData[selectedGoal]?.project;

        // Get all ships from the same project
        const projectShips = Object.entries(fleetTechGoalData)
            .filter(([name, data]) => data.project === selectedProject)
            .sort((a, b) => a[0].localeCompare(b[0]));

        projectShips.forEach(([shipName, goalData]) => {
            const button = document.createElement('button');
            button.className = 'goal-quick-button';
            button.textContent = shipName;

            if (shipName === selectedGoal) {
                button.classList.add('active');
            }

            button.addEventListener('click', () => {
                setSelectedGoal(shipName);
                document.getElementById('goal-select-dropdown').value = shipName;
                updateGoalDisplay();
                updateQuickButtons();
            });

            quickButtonsContainer.appendChild(button);
        });
    }

    /**
     * Updates the goal detail display for the selected ship.
     * @param {object} currentScores - Pre-calculated fleet tech scores from calculateAndDisplayScores
     * @param {object} positionCounts - Pre-calculated position counts from calculateAndDisplayScores
     */
    function updateGoalDisplay(currentScores, positionCounts) {
        const detailContainer = document.getElementById('goal-detail-container');
        if (!detailContainer) return;

        const selectedGoal = getSelectedGoal();
        const goalData = fleetTechGoalData[selectedGoal];

        if (!goalData) return;

        // If scores not provided (e.g., goal selection changed), recalculate by calling calculateAndDisplayScores
        if (!currentScores || !positionCounts) {
            calculateAndDisplayScores(); // This will call updateGoalDisplay with scores
            return;
        }

        // Data provided - update progress bars efficiently
        updateGoalProgressBars(selectedGoal, goalData, currentScores, positionCounts);
    }

    /**
     * Efficiently updates only the progress bars without recreating the entire card.
     */
    function updateGoalProgressBars(shipName, goalData, currentScores, positionCounts) {
        const detailContainer = document.getElementById('goal-detail-container');
        if (!detailContainer) return;

        const card = detailContainer.querySelector('.goal-card');
        const currentShipName = card?.querySelector('.goal-ship-name')?.textContent;

        // Card doesn't exist OR different ship selected - do full render
        if (!card || currentShipName !== shipName) {
            detailContainer.innerHTML = '';
            const newCard = createDetailedGoalCard(shipName, goalData, currentScores, positionCounts);
            detailContainer.appendChild(newCard);
            return;
        }

        // Update each requirement's progress bar + track overall completion
        const requirements = card.querySelectorAll('.goal-requirement');
        let reqIndex = 0;
        let allComplete = true;

        for (let i = 1; i <= 3; i++) {
            const nationality = goalData[`unlock_${i}`];
            const reqType = goalData[`unlock_${i}_req_type`];
            const reqValue = parseDatasetInt(goalData[`unlock_${i}_req_type_value`]);

            if (!nationality || !reqType || !reqValue) continue;

            const req = requirements[reqIndex];
            if (!req) continue;

            let current = 0;
            let isComplete = false;

            if (reqType === '점수') {
                current = currentScores[nationality] || 0;
                isComplete = current >= reqValue;
            } else {
                current = positionCounts[nationality]?.[reqType] || 0;
                isComplete = current >= reqValue;
            }

            if (!isComplete) allComplete = false;

            // Update progress bar
            const progressFill = req.querySelector('.goal-progress-fill');
            const progressText = req.querySelector('.goal-progress-text');

            if (progressFill && progressText) {
                const percentage = Math.min((current / reqValue) * 100, 100);
                progressFill.style.width = `${percentage}%`;

                if (isComplete) {
                    progressFill.classList.add('complete');
                    progressText.classList.add('complete');
                    progressText.innerHTML = `${current} / ${reqValue} <span class="checkmark">✓</span>`;
                } else {
                    progressFill.classList.remove('complete');
                    progressText.classList.remove('complete');
                    progressText.textContent = `${current} / ${reqValue}`;
                }
            }

            reqIndex++;
        }

        // Toggle complete state on card
        const completeLabel = card.querySelector('.goal-complete-label');
        if (allComplete) {
            card.classList.add('complete');
            if (!completeLabel) {
                const label = document.createElement('div');
                label.className = 'goal-complete-label';
                label.textContent = '✓ 해금 가능';
                card.querySelector('.goal-card-content').appendChild(label);
            }
        } else {
            card.classList.remove('complete');
            if (completeLabel) completeLabel.remove();
        }
    }

    /**
     * Creates a detailed goal card for a single ship (larger, more detailed version).
     */
    function createDetailedGoalCard(shipName, goalData, currentScores, positionCounts) {
        const card = document.createElement('div');
        card.className = 'goal-card goal-card-detailed';

        // Use cached ship data lookup (much faster than repeated searches)
        const shipData = getShipDataByName(shipName);

        // Create main content wrapper (left side)
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'goal-card-content';

        // Header with ship name and rarity
        const header = document.createElement('div');
        header.className = 'goal-card-header';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'goal-ship-name';
        nameSpan.textContent = shipName;

        const raritySpan = document.createElement('span');
        raritySpan.className = `goal-rarity rarity-${goalData.rarity_type}`;
        raritySpan.textContent = goalData.rarity_type;

        header.appendChild(nameSpan);
        header.appendChild(raritySpan);
        contentWrapper.appendChild(header);

        // Requirements container
        const reqsContainer = document.createElement('div');
        reqsContainer.className = 'goal-requirements';

        let allComplete = true;

        // Process up to 3 unlock requirements
        for (let i = 1; i <= 3; i++) {
            const nationality = goalData[`unlock_${i}`];
            const reqType = goalData[`unlock_${i}_req_type`];
            const reqValue = parseDatasetInt(goalData[`unlock_${i}_req_type_value`]);

            if (!nationality || !reqType || !reqValue) continue;

            const req = document.createElement('div');
            req.className = 'goal-requirement';

            let current = 0;
            let label = '';
            let isComplete = false;

            if (reqType === '점수') {
                // Fleet tech score requirement
                current = currentScores[nationality] || 0;
                label = `${nationality} 점수`;
                isComplete = current >= reqValue;
            } else {
                // Position-based requirement (전열 or 후열)
                current = positionCounts[nationality]?.[reqType] || 0;
                label = `${nationality} ${reqType}`;
                isComplete = current >= reqValue;
            }

            if (!isComplete) allComplete = false;

            // Requirement label
            const reqLabel = document.createElement('div');
            reqLabel.className = 'goal-req-label';
            reqLabel.textContent = label;

            // Progress bar
            const progressBar = document.createElement('div');
            progressBar.className = 'goal-progress-bar';

            const progressFill = document.createElement('div');
            progressFill.className = 'goal-progress-fill';
            const percentage = Math.min((current / reqValue) * 100, 100);
            progressFill.style.width = `${percentage}%`;
            if (isComplete) progressFill.classList.add('complete');

            progressBar.appendChild(progressFill);

            // Progress text
            const progressText = document.createElement('div');
            progressText.className = 'goal-progress-text';
            progressText.textContent = `${current} / ${reqValue}`;
            if (isComplete) {
                progressText.classList.add('complete');
                progressText.innerHTML = `${current} / ${reqValue} <span class="checkmark">✓</span>`;
            }

            req.appendChild(reqLabel);
            req.appendChild(progressBar);
            req.appendChild(progressText);
            reqsContainer.appendChild(req);
        }

        contentWrapper.appendChild(reqsContainer);

        // Overall completion status
        if (allComplete) {
            card.classList.add('complete');
            const completeLabel = document.createElement('div');
            completeLabel.className = 'goal-complete-label';
            completeLabel.textContent = '✓ 해금 가능';
            contentWrapper.appendChild(completeLabel);
        }

        // Add content to card
        card.appendChild(contentWrapper);

        // Add ship image (right side) - always create wrapper for consistent layout
        const imageWrapper = document.createElement('div');
        imageWrapper.className = 'goal-card-image-wrapper';

        if (shipData && shipData.icon) {
            const image = document.createElement('img');
            image.src = shipData.icon;
            image.alt = shipName;
            image.className = 'goal-card-image';
            image.loading = 'lazy';

            // Add error handling for missing images
            image.onerror = () => {
                // Show placeholder instead of hiding
                image.style.display = 'none';
                const placeholder = document.createElement('div');
                placeholder.className = 'goal-card-image-placeholder';
                placeholder.textContent = '?';
                imageWrapper.appendChild(placeholder);
            };

            imageWrapper.appendChild(image);
        } else {
            // No ship data found - show placeholder
            const placeholder = document.createElement('div');
            placeholder.className = 'goal-card-image-placeholder';
            placeholder.textContent = '?';
            imageWrapper.appendChild(placeholder);
        }

        card.appendChild(imageWrapper);

        return card;
    }

    // ===== Filter Drawer =====

    function openDrawer() {
        const drawer = document.getElementById('filter-drawer');
        const backdrop = document.getElementById('filter-drawer-backdrop');
        backdrop.classList.add('visible');
        drawer.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeDrawer() {
        const drawer = document.getElementById('filter-drawer');
        const backdrop = document.getElementById('filter-drawer-backdrop');
        drawer.classList.remove('open');
        backdrop.classList.remove('visible');
        document.body.style.overflow = '';
    }

    // Debounced filter apply (used throughout drawer)
    const debouncedApplyFilters = debounce(applyFilters, 150);

    /**
     * Populates the filter drawer body with all filter controls.
     */
    function populateDrawerFilters() {
        const drawerBody = cachedElements.filterDrawerBody;
        if (!drawerBody) return;
        drawerBody.innerHTML = '';

        // --- Dropdown options section (진행/육성) ---
        const dropdownSection = document.createElement('div');
        dropdownSection.className = 'st-drawer-section';
        dropdownSection.innerHTML = '<h3>진행/육성</h3>';

        const dropdownControlsContainer = document.createElement('div');
        dropdownControlsContainer.className = 'dropdown-controls-container';

        const dropdownFilters = [
            { id: 'progress-filter', label: '체크 상태', options: { all: '체크여부 - 전체', checked: '하나라도 체크됨', unchecked: '체크 안됨' } },
            { id: 'get-attr-filter', label: '입수 스탯', data: attrTypeData, allOptionText: '입수스탯 - 전체', prefix: '입수: ' },
            { id: 'level-attr-filter', label: '120렙 스탯', data: attrTypeData, allOptionText: '120스탯 - 전체', prefix: '120렙: ' },
            { id: 'fav-filter', label: '즐겨찾기', options: { all: '즐겨찾기 - 전체', fav: '즐겨찾기만' } },
            { id: 'retro-filter', label: '개장', options: { all: '개장 - 전체', able: '개장 가능', done: '개장 완료', todo: '개장 미완' } },
            { id: 'aff-filter', label: '호감작', options: { all: '호감작 - 전체', 0: '호감작 안함', 1: '100 예정', 2: '100 완료', 3: '200 예정', 4: '200 완료' } },
            { id: 'skl-filter', label: '스작', options: { all: '스작 - 전체', 0: '스작 안함', 1: '스작 예정', 2: '스작 진행중', 3: '스작 완료' } },
            { id: 'memo-filter', label: '메모', options: { all: '메모 - 전체', has: '메모 있음' } }
        ];

        dropdownFilters.forEach(f => {
            const group = document.createElement('div');
            group.className = 'dropdown-filter-group';
            const label = document.createElement('label');
            label.htmlFor = f.id;
            label.className = 'st-filter-label';
            label.textContent = f.label;
            group.appendChild(label);

            const select = document.createElement('select');
            select.id = f.id;
            select.setAttribute('aria-label', f.label);
            if (f.options) {
                // Object key enumeration always sorts integer-like keys (e.g. aff/skl's
                // 0..4) before string keys, regardless of source order — sort 'all' back
                // to the front so it's both the visible first option and the default
                // selectedIndex (no explicit `selected` is set anywhere).
                Object.entries(f.options)
                    .sort(([a], [b]) => (a === 'all' ? -1 : b === 'all' ? 1 : 0))
                    .forEach(([val, text]) => {
                        const option = document.createElement('option');
                        option.value = val;
                        option.textContent = text;
                        select.appendChild(option);
                    });
            } else {
                const allText = f.allOptionText || '전체';
                const allOption = document.createElement('option');
                allOption.value = 'all';
                allOption.textContent = allText;
                select.appendChild(allOption);
                for (const attrId in f.data) {
                    const option = document.createElement('option');
                    option.value = f.data[attrId].id;
                    option.textContent = (f.prefix || '') + f.data[attrId].condition;
                    select.appendChild(option);
                }
            }
            group.appendChild(select);
            dropdownControlsContainer.appendChild(group);
        });

        dropdownSection.appendChild(dropdownControlsContainer);
        drawerBody.appendChild(dropdownSection);

        // --- Rarity section ---
        const raritySection = document.createElement('div');
        raritySection.className = 'st-drawer-section';
        raritySection.innerHTML = '<h3>등급</h3>';

        const rarityChips = document.createElement('div');
        rarityChips.className = 'st-rarity-chips';
        rarityChips.id = 'rarity-filter';

        const rarities = [...new Set(Object.values(fullShipData).map(s => s.rarity).filter(Boolean))];
        rarities.sort((a, b) => rarityOrder.indexOf(a) - rarityOrder.indexOf(b));

        rarities.forEach(r => {
            const chip = document.createElement('button');
            chip.className = 'st-rarity-chip active';
            chip.dataset.rarity = r.toLowerCase();
            chip.dataset.filterType = 'individual';
            chip.value = r;
            chip.textContent = r;
            chip.addEventListener('click', () => {
                chip.classList.toggle('active');
                debouncedApplyFilters();
            });
            rarityChips.appendChild(chip);
        });

        raritySection.appendChild(rarityChips);
        drawerBody.appendChild(raritySection);

        // --- Nationality section (native details) ---
        const natSection = document.createElement('details');
        natSection.className = 'st-drawer-section st-filter-details';
        const natSummary = document.createElement('summary');
        natSummary.textContent = '진영';
        natSection.appendChild(natSummary);

        const nationalityGroup = document.createElement('div');
        nationalityGroup.id = 'nationality-filter';
        nationalityGroup.className = 'filter-group';

        const natWrapper = document.createElement('div');
        natWrapper.className = 'filter-controls-wrapper';

        // "All" toggle
        const natAllId = 'nationality-filter-all';
        const natAllItem = document.createElement('div');
        natAllItem.className = 'checkbox-filter-item';
        natAllItem.innerHTML = `<input type="checkbox" id="${natAllId}" value="all" data-filter-type="all" checked><label for="${natAllId}">전체</label>`;
        natWrapper.appendChild(natAllItem);

        // Individual nationality checkboxes
        const natItems = Object.values(nationalityData);
        natItems.sort((a, b) => a.id - b.id);
        natItems.forEach(item => {
            if (!item.id || !item.name) return;
            const uniqueId = `nationality-filter-${item.id}`;
            const checkboxItem = document.createElement('div');
            checkboxItem.className = 'checkbox-filter-item';
            const iconHTML = item.image ? `<img src="${escapeHtml(item.image)}" class="filter-icon">` : '';
            checkboxItem.innerHTML = `<input type="checkbox" id="${uniqueId}" value="${escapeHtml(item.id)}" data-filter-type="individual"><label for="${uniqueId}">${iconHTML} ${escapeHtml(item.name)}</label>`;
            natWrapper.appendChild(checkboxItem);
        });

        nationalityGroup.appendChild(natWrapper);
        natSection.appendChild(nationalityGroup);   // unchanged #nationality-filter .filter-group
        drawerBody.appendChild(natSection);

        // --- Type section (native details) ---
        const typeSection = document.createElement('details');
        typeSection.className = 'st-drawer-section st-filter-details';
        const typeSummary = document.createElement('summary');
        typeSummary.textContent = '함종';
        typeSection.appendChild(typeSummary);

        const typeGroup = document.createElement('div');
        typeGroup.id = 'type-filter';
        typeGroup.className = 'filter-group';

        const typeWrapper = document.createElement('div');
        typeWrapper.className = 'filter-controls-wrapper';

        // "All" toggle
        const typeAllId = 'type-filter-all';
        const typeAllItem = document.createElement('div');
        typeAllItem.className = 'checkbox-filter-item';
        typeAllItem.innerHTML = `<input type="checkbox" id="${typeAllId}" value="all" data-filter-type="all" checked><label for="${typeAllId}">전체</label>`;
        typeWrapper.appendChild(typeAllItem);

        // Group by position
        const groupedTypes = { '전열': [], '후열': [], '잠수': [] };
        Object.values(shipTypeData).forEach(item => {
            if (groupedTypes[item.position]) {
                groupedTypes[item.position].push(item);
            }
        });

        const positionOrder = ['전열', '후열', '잠수'];
        positionOrder.forEach(position => {
            const items = groupedTypes[position];
            if (items.length === 0) return;
            items.sort((a, b) => (a.type_name || '').localeCompare(b.type_name || ''));

            const positionGroupWrapper = document.createElement('div');
            positionGroupWrapper.className = 'filter-position-group';

            if (position === '전열' || position === '후열') {
                const groupAllId = `type-filter-${position}-all`;
                const groupAllItem = document.createElement('div');
                groupAllItem.className = 'checkbox-filter-item';
                groupAllItem.innerHTML = `<input type="checkbox" id="${groupAllId}" data-filter-type="group-all" data-group-target="${position}"><label for="${groupAllId}">${position} 전체</label>`;
                positionGroupWrapper.appendChild(groupAllItem);
            }

            items.forEach(item => {
                if (item.type_name === '뇌순' || item.type_name === '항순') return;
                const uniqueId = `type-filter-${item.ship_type}`;
                const checkboxItem = document.createElement('div');
                checkboxItem.className = 'checkbox-filter-item';
                const iconHTML = item.icon ? `<img src="${escapeHtml(item.icon)}" class="filter-icon">` : '';
                checkboxItem.innerHTML = `<input type="checkbox" id="${uniqueId}" value="${escapeHtml(item.ship_type)}" data-filter-type="individual" data-position="${position}"><label for="${uniqueId}">${iconHTML} ${escapeHtml(item.type_name)}</label>`;
                positionGroupWrapper.appendChild(checkboxItem);
            });

            typeWrapper.appendChild(positionGroupWrapper);
        });

        typeGroup.appendChild(typeWrapper);
        typeSection.appendChild(typeGroup);
        drawerBody.appendChild(typeSection);

        // --- Bulk actions section ---
        const bulkSection = document.createElement('div');
        bulkSection.className = 'st-drawer-section';
        bulkSection.innerHTML = '<h3>일괄 작업</h3>';

        const bulkLabel = document.createElement('div');
        bulkLabel.className = 'filter-group-label';
        bulkLabel.textContent = '목록에 보이는 모든 함순이들에게 적용';
        bulkSection.appendChild(bulkLabel);

        const bulkWrapper = document.createElement('div');
        bulkWrapper.className = 'st-bulk-actions';

        const bulkCheckActions = [
            { label: '모두 입수 체크', type: 'get', state: true },
            { label: '모두 Lv120 체크', type: 'level', state: true },
            { label: '모두 풀돌 체크', type: 'upgrade', state: true },
            { label: '모두 체크 해제', type: 'all', state: false }
        ];

        bulkCheckActions.forEach(action => {
            const btn = document.createElement('button');
            btn.textContent = action.label;
            // Check actions = neutral .btn-secondary; the "모두 체크 해제" (deselect)
            // action is destructive → .btn-danger. Both keep the bulk-* hook classes.
            btn.className = action.state === false
                ? 'btn btn-danger bulk-check-btn bulk-deselect-btn'
                : 'btn btn-secondary bulk-check-btn';
            btn.onclick = () => {
                let message = `주의)) '${action.label}' 작업을 실행하시겠습니까? 필터링 적용된 목록의 함순이들에게 일괄적용됩니다.`;
                if (action.type === 'all' && !action.state) {
                    message += ` '모두 체크 해제' 실행 시 상한 해제(성정 유닛) 기록도 초기화됩니다.`;
                } else if (action.type === 'level' && action.state) {
                    message += ` '모두 Lv120 체크' 실행 시 상한 해제(성정 유닛) 기록도 Lv120(4돌파)으로 함께 설정됩니다.`;
                }
                showConfirmationModal(message, () => bulkCheck(action.type, action.state));
            };
            bulkWrapper.appendChild(btn);
        });

        bulkSection.appendChild(bulkWrapper);
        drawerBody.appendChild(bulkSection);

        // --- Event delegation for checkboxes and selects in drawer ---
        drawerBody.addEventListener('change', (e) => {
            const target = e.target;
            if (target.tagName === 'SELECT') {
                debouncedApplyFilters();
            } else if (target.type === 'checkbox' && target.closest('.filter-group')) {
                handleFilterCheckboxLogic(target);
                debouncedApplyFilters();
            }
        });
    }

    /**
     * Performs a bulk check/uncheck operation on the visible ship cards.
     * @param {string} type - The type of checkbox to change ('get', 'level', 'upgrade', 'all').
     * @param {boolean} shouldBeChecked - The desired state of the checkbox.
     */
    function bulkCheck(type, shouldBeChecked) {
        getShipCards().forEach(card => {
            if (filteredShipIds.includes(card.dataset.shipId)) {
                if (type === 'all') {
                    // For 'all' type, we need to handle the checkboxes in the right order
                    // to ensure proper cascading logic
                    const { get: getCheckbox, level: levelCheckbox, upgrade: upgradeCheckbox } = card._cb;
                    if (shouldBeChecked) {
                        // When checking all, check in order: get, level, upgrade
                        if (getCheckbox) {
                            getCheckbox.checked = true;
                            handleCheckboxLogic(getCheckbox);
                        }
                        if (levelCheckbox) {
                            levelCheckbox.checked = true;
                            handleCheckboxLogic(levelCheckbox);
                        }
                        if (upgradeCheckbox) {
                            upgradeCheckbox.checked = true;
                            handleCheckboxLogic(upgradeCheckbox);
                        }
                    } else {
                        // When unchecking all, uncheck in reverse order: upgrade, level, get
                        if (upgradeCheckbox) {
                            upgradeCheckbox.checked = false;
                            handleCheckboxLogic(upgradeCheckbox);
                        }
                        if (levelCheckbox) {
                            levelCheckbox.checked = false;
                            handleCheckboxLogic(levelCheckbox);
                        }
                        if (getCheckbox) {
                            getCheckbox.checked = false;
                            handleCheckboxLogic(getCheckbox);
                        }
                    }
                } else {
                    const checkbox = card._cb[type];
                    if (checkbox && checkbox.checked !== shouldBeChecked) {
                        checkbox.checked = shouldBeChecked;
                        handleCheckboxLogic(checkbox);
                    }
                }
                // bulkCheck drives checkboxes directly (not through the container's
                // change listener), so it needs its own call to the same coupling step.
                coupleCardAfterChange(card, type === 'all' ? 'get' : type, shouldBeChecked);
            }
        });
        autoSaveProgress();
        if (isProgressFilterActive()) {
            applyFilters();
        } else {
            calculateAndDisplayScores();
        }
    }

    // ===== Confirmation Modal =====

    /**
     * Current confirmation callback for the modal.
     */
    let currentConfirmCallback = null;

    /**
     * Sets up the confirmation modal button handlers (called once during init).
     */
    function setupConfirmationModal() {
        document.getElementById('modal-confirm-btn').addEventListener('click', () => {
            if (currentConfirmCallback) currentConfirmCallback();
            closeModal('confirmation-modal');
            currentConfirmCallback = null;
        });
        document.getElementById('modal-cancel-btn').addEventListener('click', () => {
            closeModal('confirmation-modal');
            currentConfirmCallback = null;
        });
    }

    /**
     * Shows a confirmation modal for critical actions.
     * @param {string} message - The message to display in the modal.
     * @param {function} onConfirm - The callback function to execute on confirmation.
     */
    function showConfirmationModal(message, onConfirm) {
        const modalText = document.getElementById('modal-text');
        if (!modalText) return;

        modalText.textContent = message;
        currentConfirmCallback = onConfirm;
        openModal('confirmation-modal');
    }

    // ===== Memo Modal =====

    let memoGid = null, memoCard = null;

    /**
     * Opens the memo modal for a single ship, seeded with its current memo text.
     * @param {string} gid - Ship group id.
     * @param {HTMLElement} card - The card whose memo cell gets re-rendered on save.
     */
    function openMemoModal(gid, card) {
        memoGid = gid; memoCard = card;
        document.getElementById('memo-modal-ship').textContent = `${fullShipData[gid]?.name || ''} — 메모`;
        document.getElementById('memo-input').value = getInv(gid).memo || '';
        openModal('memo-modal');
    }

    /**
     * Saves the current progress (checked boxes) to localStorage.
     */
    function autoSaveProgress() {
        progressStore.save(collectProgressFromCards());
    }

    /**
     * Applies the saved progress to the ship cards.
     * @param {object} progress - The progress object loaded from localStorage.
     */
    function applyProgress(progress) {
        const nextProgress = progress && typeof progress === 'object' ? progress : {};
        getShipCards().forEach(card => {
            const shipId = card.dataset.shipId;
            writeMaskToCheckboxes(card, nextProgress[shipId] || 0);
        });
    }

    /**
     * Loads progress from localStorage and applies it.
     */
    function loadProgress() {
        applyProgress(progressStore.load());
    }

    /**
     * Handles the logic for the ship type filter checkboxes.
     * @param {HTMLInputElement} checkbox - The changed checkbox.
     * @param {HTMLElement} group - The filter group element.
     */
    function handleShipTypeFilterLogic(checkbox, group) {
        const allToggle = group.querySelector('[data-filter-type="all"]');
        if (checkbox === allToggle && checkbox.checked) {
            group.querySelectorAll('[data-filter-type="group-all"], [data-filter-type="individual"]').forEach(cb => cb.checked = false);
            return;
        }
        if (checkbox.dataset.filterType === 'group-all') {
            const targetGroup = checkbox.dataset.groupTarget;
            group.querySelectorAll(`[data-position="${targetGroup}"]`).forEach(cb => cb.checked = checkbox.checked);
        }
        if (checkbox.dataset.filterType === 'individual') {
            const position = checkbox.dataset.position;
            const groupAllToggle = group.querySelector(`[data-group-target="${position}"]`);
            if (groupAllToggle) {
                if (!checkbox.checked) {
                    groupAllToggle.checked = false;
                } else {
                    const individuals = Array.from(group.querySelectorAll(`[data-position="${position}"]`));
                    groupAllToggle.checked = individuals.every(cb => cb.checked);
                }
            }

        }
        const anyIndividualChecked = group.querySelector('[data-filter-type="individual"]:checked');
        if (anyIndividualChecked) {
            allToggle.checked = false;
        } else {
            allToggle.checked = true;
            group.querySelectorAll('[data-filter-type="group-all"]').forEach(cb => cb.checked = false);
        }
    }

    /**
     * Handles the logic for filter checkboxes (e.g., 'All' vs. individual items).
     * @param {HTMLInputElement} changedCheckbox - The checkbox that was changed.
     */
    function handleFilterCheckboxLogic(changedCheckbox) {
        const group = changedCheckbox.closest('.filter-group');
        if (!group) return;
        if (group.id === 'type-filter') {
            handleShipTypeFilterLogic(changedCheckbox, group);
            return;
        }
        const allToggle = group.querySelector('[data-filter-type="all"]');
        if (changedCheckbox === allToggle) {
            if (allToggle.checked) {
                group.querySelectorAll('[data-filter-type="individual"]:checked').forEach(cb => cb.checked = false);
            }
        } else {
            if (changedCheckbox.checked) {
                allToggle.checked = false;
            }
        }
        if (!group.querySelector('[data-filter-type="individual"]:checked')) {
            allToggle.checked = true;
        }
    }

    // ===== Filter Chips & Persistence =====

    /**
     * Updates the filter chips row below the toolbar to show active filters.
     * Each chip is a removable pill that, when clicked, removes that filter.
     */
    function updateFilterChips() {
        const chipsRow = document.getElementById('filter-chips');
        if (!chipsRow) return;
        chipsRow.querySelectorAll('.st-chip').forEach(el => el.remove());
        const chips = [];

        // Rarity chips (only if NOT all selected)
        const allRarityChips = document.querySelectorAll('#rarity-filter .st-rarity-chip');
        const activeRarityChips = document.querySelectorAll('#rarity-filter .st-rarity-chip.active');
        if (activeRarityChips.length > 0 && activeRarityChips.length < allRarityChips.length) {
            activeRarityChips.forEach(c => chips.push({ label: c.value, type: 'rarity', value: c.value }));
        }

        // Nationality chips (only if specific ones selected, not "all")
        const natAll = document.querySelector('#nationality-filter [data-filter-type="all"]');
        if (natAll && !natAll.checked) {
            document.querySelectorAll('#nationality-filter input[data-filter-type="individual"]:checked').forEach(cb => {
                const label = cb.nextElementSibling?.textContent?.trim() || cb.value;
                chips.push({ label, type: 'nationality', value: cb.value });
            });
        }

        // Type chips
        const typeAll = document.querySelector('#type-filter [data-filter-type="all"]');
        if (typeAll && !typeAll.checked) {
            document.querySelectorAll('#type-filter input[data-filter-type="individual"]:checked').forEach(cb => {
                const label = cb.nextElementSibling?.textContent?.trim() || cb.value;
                chips.push({ label, type: 'type', value: cb.value });
            });
        }

        // Progress chip
        const progressEl = document.getElementById('progress-filter');
        if (progressEl && progressEl.value !== 'all') {
            const text = progressEl.value === 'checked' ? '체크됨' : '미체크';
            chips.push({ label: text, type: 'progress', value: progressEl.value });
        }

        // Get-attr chip
        const getAttrEl = document.getElementById('get-attr-filter');
        if (getAttrEl && getAttrEl.value !== 'all') {
            const selectedOption = getAttrEl.options[getAttrEl.selectedIndex];
            chips.push({ label: selectedOption.textContent, type: 'get-attr', value: getAttrEl.value });
        }

        // Level-attr chip
        const levelAttrEl = document.getElementById('level-attr-filter');
        if (levelAttrEl && levelAttrEl.value !== 'all') {
            const selectedOption = levelAttrEl.options[levelAttrEl.selectedIndex];
            chips.push({ label: selectedOption.textContent, type: 'level-attr', value: levelAttrEl.value });
        }

        // Investment chips (fav/retro/aff/skl/memo) — label = selected option text.
        ['fav', 'retro', 'aff', 'skl', 'memo'].forEach(type => {
            const el = document.getElementById(`${type}-filter`);
            if (el && el.value !== 'all') {
                chips.push({ label: el.options[el.selectedIndex].textContent, type, value: el.value });
            }
        });

        // Search chip
        const searchVal = document.getElementById('search-bar')?.value?.trim();
        if (searchVal) {
            chips.push({ label: `"${searchVal}"`, type: 'search', value: searchVal });
        }

        // Update badge + render
        const badge = document.getElementById('filter-badge');
        if (chips.length === 0) {
            if (badge) hideElement(badge);
            return;
        }

        if (badge) {
            badge.textContent = chips.length;
            showElement(badge);
        }

        const fragment = document.createDocumentFragment();
        chips.forEach(chip => {
            const el = document.createElement('button');
            el.className = 'st-chip';
            el.innerHTML = `${escapeHtml(chip.label)} <span class="material-symbols-outlined" style="font-size:14px">close</span>`;
            el.addEventListener('click', () => removeFilterChip(chip));
            fragment.appendChild(el);
        });
        chipsRow.appendChild(fragment);
    }

    /**
     * Removes a single filter chip by resetting the corresponding filter control,
     * then re-applies all filters.
     * @param {object} chip - The chip descriptor { label, type, value }.
     */
    function removeFilterChip(chip) {
        if (chip.type === 'rarity') {
            const rarityChip = document.querySelector(`#rarity-filter .st-rarity-chip[value="${chip.value}"]`);
            if (rarityChip) rarityChip.classList.remove('active');
        } else if (chip.type === 'nationality') {
            const cb = document.querySelector(`#nationality-filter input[value="${chip.value}"][data-filter-type="individual"]`);
            if (cb) { cb.checked = false; handleFilterCheckboxLogic(cb); }
        } else if (chip.type === 'type') {
            const cb = document.querySelector(`#type-filter input[value="${chip.value}"][data-filter-type="individual"]`);
            if (cb) { cb.checked = false; handleFilterCheckboxLogic(cb); }
        } else if (chip.type === 'progress') {
            const el = document.getElementById('progress-filter');
            if (el) el.value = 'all';
        } else if (chip.type === 'get-attr') {
            const el = document.getElementById('get-attr-filter');
            if (el) el.value = 'all';
        } else if (chip.type === 'level-attr') {
            const el = document.getElementById('level-attr-filter');
            if (el) el.value = 'all';
        } else if (chip.type === 'search') {
            document.getElementById('search-bar').value = '';
        } else if (['fav', 'retro', 'aff', 'skl', 'memo'].includes(chip.type)) {
            const el = document.getElementById(`${chip.type}-filter`);
            if (el) el.value = 'all';
        }
        applyFilters();
    }

    /**
     * Saves current filter selections to localStorage for persistence across page reloads.
     */
    function saveFiltersToStorage() {
        const filters = {
            rarities: Array.from(document.querySelectorAll('#rarity-filter .st-rarity-chip.active')).map(c => c.value),
            nationalities: Array.from(document.querySelectorAll('#nationality-filter input[data-filter-type="individual"]:checked')).map(cb => cb.value),
            types: Array.from(document.querySelectorAll('#type-filter input[data-filter-type="individual"]:checked')).map(cb => cb.value),
            progress: document.getElementById('progress-filter')?.value || 'all',
            getAttr: document.getElementById('get-attr-filter')?.value || 'all',
            levelAttr: document.getElementById('level-attr-filter')?.value || 'all',
            fav: document.getElementById('fav-filter')?.value || 'all',
            retro: document.getElementById('retro-filter')?.value || 'all',
            aff: document.getElementById('aff-filter')?.value || 'all',
            skl: document.getElementById('skl-filter')?.value || 'all',
            memo: document.getElementById('memo-filter')?.value || 'all',
        };
        setStorageItem(FILTER_KEY, JSON.stringify(filters));
    }

    /**
     * Loads saved filter selections from localStorage and applies them to filter controls.
     * Should be called after populateDrawerFilters() and before applyFilters().
     */
    function loadFiltersFromStorage() {
        const saved = getStorageItem(FILTER_KEY, null);
        if (!saved) return;
        try {
            const filters = JSON.parse(saved);

            // Apply rarity
            if (filters.rarities && Array.isArray(filters.rarities)) {
                document.querySelectorAll('#rarity-filter .st-rarity-chip').forEach(chip => {
                    if (filters.rarities.includes(chip.value)) {
                        chip.classList.add('active');
                    } else {
                        chip.classList.remove('active');
                    }
                });
            }

            // Apply nationality
            if (filters.nationalities?.length > 0) {
                const natAll = document.querySelector('#nationality-filter [data-filter-type="all"]');
                if (natAll) natAll.checked = false;
                filters.nationalities.forEach(val => {
                    const cb = document.querySelector(`#nationality-filter input[value="${val}"][data-filter-type="individual"]`);
                    if (cb) cb.checked = true;
                });
                document.getElementById('nationality-filter')?.closest('details')?.setAttribute('open', '');
            }

            // Apply types
            if (filters.types?.length > 0) {
                const typeAll = document.querySelector('#type-filter [data-filter-type="all"]');
                if (typeAll) typeAll.checked = false;
                filters.types.forEach(val => {
                    const cb = document.querySelector(`#type-filter input[value="${val}"][data-filter-type="individual"]`);
                    if (cb) cb.checked = true;
                });
                document.getElementById('type-filter')?.closest('details')?.setAttribute('open', '');
            }

            // Apply dropdowns
            const progressEl = document.getElementById('progress-filter');
            if (progressEl && filters.progress) progressEl.value = filters.progress;
            const getAttrEl = document.getElementById('get-attr-filter');
            if (getAttrEl && filters.getAttr) getAttrEl.value = filters.getAttr;
            const levelAttrEl = document.getElementById('level-attr-filter');
            if (levelAttrEl && filters.levelAttr) levelAttrEl.value = filters.levelAttr;
            const favEl = document.getElementById('fav-filter');
            if (favEl && filters.fav) favEl.value = filters.fav;
            const retroEl = document.getElementById('retro-filter');
            if (retroEl && filters.retro) retroEl.value = filters.retro;
            const affEl = document.getElementById('aff-filter');
            if (affEl && filters.aff) affEl.value = filters.aff;
            const sklEl = document.getElementById('skl-filter');
            if (sklEl && filters.skl) sklEl.value = filters.skl;
            const memoEl = document.getElementById('memo-filter');
            if (memoEl && filters.memo) memoEl.value = filters.memo;
        } catch (e) {
            console.error('Failed to load saved filters:', e);
        }
    }

    /**
     * Applies all active filters to the ship list.
     */
    function applyFilters() {
        const searchQuery = document.getElementById('search-bar').value.toLowerCase();
        const progressFilter = document.getElementById('progress-filter').value;
        const getAttrFilter = document.getElementById('get-attr-filter').value;
        const levelAttrFilter = document.getElementById('level-attr-filter').value;
        const favFilter = document.getElementById('fav-filter').value;
        const retroFilter = document.getElementById('retro-filter').value;
        const affFilter = document.getElementById('aff-filter').value;
        const sklFilter = document.getElementById('skl-filter').value;
        const memoFilter = document.getElementById('memo-filter').value;
        const checkedNations = Array.from(document.querySelectorAll('#nationality-filter input[data-filter-type="individual"]:checked')).map(cb => parseDatasetInt(cb.value));
        const checkedTypes = Array.from(document.querySelectorAll('#type-filter input[data-filter-type="individual"]:checked')).map(cb => parseDatasetInt(cb.value));

        // Rarity: use chip-based approach instead of checkbox
        const checkedRarities = Array.from(document.querySelectorAll('#rarity-filter .st-rarity-chip.active')).map(chip => chip.value);

        const isNationFilterActive = checkedNations.length > 0;
        const isTypeFilterActive = checkedTypes.length > 0;
        const isRarityFilterActive = checkedRarities.length > 0;

        filteredShipIds = Object.keys(fullShipData).filter(shipId => {
            const ship = fullShipData[shipId];

            const state = getCardProgressState(shipCardById.get(shipId));
            const isAnyChecked = state > 0;

            let progressMatch = true;
            if (progressFilter === 'checked') {
                progressMatch = isAnyChecked;
            } else if (progressFilter === 'unchecked') {
                progressMatch = !isAnyChecked;
            }

            const searchMatch = !searchQuery || (ship.name && ship.name.toLowerCase().includes(searchQuery));
            const natMatch = !isNationFilterActive || checkedNations.includes(ship.nationality);
            const typeMatch = !isTypeFilterActive || (ship.type && checkedTypes.includes(ship.type));
            const rarityMatch = !isRarityFilterActive || (ship.rarity && checkedRarities.includes(ship.rarity));
            const getAttrMatch = getAttrFilter === 'all' || ship.add_get_attr === parseDatasetInt(getAttrFilter);
            const levelAttrMatch = levelAttrFilter === 'all' || ship.add_level_attr === parseDatasetInt(levelAttrFilter);

            const rec = getInv(shipId);
            const favMatch = favFilter === 'all' || !!rec.fav;
            const retroMatch = retroFilter === 'all'
                || (retroFilter === 'able' && !!ship.retrofit)
                || (retroFilter === 'done' && !!rec.ret)
                || (retroFilter === 'todo' && !!ship.retrofit && !rec.ret);
            const affMatch = affFilter === 'all' || (rec.aff || 0) === parseDatasetInt(affFilter);
            const sklMatch = sklFilter === 'all' || (rec.skl || 0) === parseDatasetInt(sklFilter);
            const memoMatch = memoFilter === 'all' || !!rec.memo;

            return searchMatch && natMatch && typeMatch && rarityMatch && progressMatch && getAttrMatch && levelAttrMatch
                && favMatch && retroMatch && affMatch && sklMatch && memoMatch;
        });

        renderVisibleCards();
        calculateAndDisplayScores();
        updateFilterChips();
        saveFiltersToStorage();

        const drawerCount = document.getElementById('drawer-count');
        if (drawerCount) drawerCount.textContent = `${filteredShipIds.length}척`;
    }

    /**
     * Resets all filters to their default state.
     */
    function resetFilters() {
        // Reset search
        document.getElementById('search-bar').value = '';

        // Reset rarity chips (all active)
        document.querySelectorAll('.st-rarity-chip').forEach(c => c.classList.add('active'));

        // Reset checkboxes in drawer
        document.querySelectorAll('#filter-drawer-body input[type="checkbox"]').forEach(cb => {
            cb.checked = cb.dataset.filterType === 'all';
        });
        document.querySelectorAll('#filter-drawer-body [data-filter-type="group-all"]').forEach(cb => cb.checked = false);

        // Reset selects
        document.querySelectorAll('#filter-drawer-body select').forEach(s => s.selectedIndex = 0);

        applyFilters();
    }

    // ===== Search =====

    /**
     * Sets up search input and dropdown.
     */
    function setupSearch() {
        const searchInput = document.getElementById('search-bar');
        const searchDropdown = document.getElementById('search-dropdown');

        // Populate dropdown with all ship names
        const allShipNames = Object.values(fullShipData).map(ship => ship.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
        allShipNames.forEach(name => {
            const a = document.createElement('a');
            a.textContent = name;
            a.addEventListener('click', () => {
                searchInput.value = name;
                searchDropdown.style.display = 'none';
                applyFilters();
            });
            searchDropdown.appendChild(a);
        });

        const debouncedSearch = debounce(() => {
            filterSearchDropdown(searchInput, searchDropdown);
            applyFilters();
        }, 150);

        searchInput.addEventListener('input', debouncedSearch);
        setupDropdownToggle(searchInput, searchDropdown);
    }

    /**
     * Initial render of all ship cards (called once on page load).
     */
    function renderAllCards() {
        const container = cachedElements.shipListContainer;
        if (!container) return;
        const fragment = document.createDocumentFragment();
        maxFleetTech = 0;
        shipCardById.clear();
        Object.keys(fullShipData).forEach(shipId => {
            const ship = fullShipData[shipId];
            if (ship) {
                const card = createShipCard(ship, shipId);
                shipCardById.set(shipId, card);
                fragment.appendChild(card);
                maxFleetTech += (ship.pt_get ?? 0) + (ship.pt_level ?? 0) + (ship.pt_upgrage ?? 0);
            }
        });
        container.appendChild(fragment);
        if (cachedElements.totalScoreMax) {
            cachedElements.totalScoreMax.textContent = maxFleetTech.toLocaleString();
        }
        loadProgress();
        shipCardById.forEach((card, shipId) => renderInvestmentCells(card, shipId));
    }

    /**
     * Updates visibility of ship cards based on current filters (show/hide instead of recreate).
     */
    function renderVisibleCards() {
        const visibleSet = new Set(filteredShipIds);
        shipCardById.forEach((card, shipId) => {
            card.style.display = visibleSet.has(shipId) ? '' : 'none';
        });
        const emptyEl = document.getElementById('tracker-empty');
        if (emptyEl) {
            if (filteredShipIds.length === 0) {
                renderStatus(emptyEl, '조건에 맞는 함순이가 없습니다. 필터를 확인해 주세요.', 'empty');
                showElement(emptyEl);
            } else {
                hideElement(emptyEl);
            }
        }
    }

    // ===== Initialization =====

    async function initialize() {
        const els = {
            shipListContainer: document.getElementById('ship-list-container'),
            ledgerHead: document.getElementById('ledger-head'),
            controlSurface: document.querySelector('.st-control-surface'),
            filterDrawer: document.getElementById('filter-drawer'),
            filterDrawerBody: document.getElementById('filter-drawer-body'),
            searchBar: document.getElementById('search-bar'),
            viewToggleBtn: document.getElementById('view-toggle-btn'),
        };
        if (!requireElements(els, 'Shipgirl tracker')) return;

        const data = await loadPageData(async () => {
            const [ships, nations, types, attrs, goals, factions] = await Promise.all([
                'data/ship_group_data.json',
                'data/mapping/nationality_mapping.json',
                'data/mapping/ship_type_mapping.json',
                'data/mapping/attr_type_mapping.json',
                'data/shipgirl/fleet_tech_goal.json',
                'data/shipgirl/fleet_tech_template.json',
            ].map(path => fetchJSON(path)));
            return { ships, nations, types, attrs, goals, factions };
        }, els.shipListContainer, { contextLabel: 'Shipgirl tracker' });
        if (data === null) return;
        ({ ships: fullShipData, nations: nationalityData, types: shipTypeData,
           attrs: attrTypeData, goals: fleetTechGoalData, factions: factionTechData } = data);

        investment = investmentStore.load();
        rarityByGid = Object.fromEntries(Object.entries(fullShipData).map(([gid, s]) => [gid, s.rarity]));
        cacheDOMElements();

        // Setup view toggle (ledger/cards)
        applyView(getStorageItem(VIEW_KEY, 'ledger') === 'cards' ? 'cards' : 'ledger');
        els.viewToggleBtn.addEventListener('click', () => {
            applyView(cachedElements.shipListContainer.dataset.view === 'ledger' ? 'cards' : 'ledger');
        });

        // Sticky ledger-head offset (navbar + control surface) — surface height is live (wraps)
        updateStickyOffset();
        // chips row appearing/disappearing changes the surface height —
        // observe the element, not just window resizes
        if ('ResizeObserver' in window) new ResizeObserver(updateStickyOffset).observe(els.controlSurface);
        else window.addEventListener('resize', updateStickyOffset);

        // Shadow only while the control surface is actually pinned.
        const surface = document.querySelector('.st-control-surface');
        const sentinel = document.querySelector('.st-sticky-sentinel');
        if (surface && sentinel && 'IntersectionObserver' in window) {
            const nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--navbar-height')) || 65;
            new IntersectionObserver(
                ([entry]) => surface.classList.toggle('is-stuck', !entry.isIntersecting),
                { rootMargin: `-${nav + 1}px 0px 0px 0px` }
            ).observe(sentinel);
        }

        // Setup drawer
        document.getElementById('filter-drawer-btn').addEventListener('click', openDrawer);
        document.getElementById('filter-drawer-backdrop').addEventListener('click', closeDrawer);
        document.querySelector('#filter-drawer .st-drawer-close').addEventListener('click', closeDrawer);
        document.getElementById('reset-filters-btn').addEventListener('click', resetFilters);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const drawer = document.getElementById('filter-drawer');
                if (drawer.classList.contains('open')) closeDrawer();
            }
        });

        // Setup score modal
        document.getElementById('score-modal-btn').addEventListener('click', () => {
            calculateAndDisplayScores();
            openModal('score-modal');
        });
        setupModal('score-modal', { closeOnEscape: true, closeOnBackdrop: true, restoreFocus: true });

        // Setup goal modal
        document.getElementById('goal-modal-btn').addEventListener('click', () => {
            renderGoalTracker();
            openModal('goal-modal');
        });
        setupModal('goal-modal', { closeOnEscape: true, closeOnBackdrop: true, restoreFocus: true });

        // Setup confirmation modal
        setupModal('confirmation-modal', {
            closeOnEscape: true,
            closeOnBackdrop: true,
            restoreFocus: true,
            onClose: () => { currentConfirmCallback = null; }
        });
        setupConfirmationModal();

        // Setup memo modal
        setupModal('memo-modal', { closeOnEscape: true, closeOnBackdrop: true, restoreFocus: true });
        document.getElementById('memo-save-btn').addEventListener('click', () => {
            if (memoGid) {
                setInv(memoGid, { memo: document.getElementById('memo-input').value.trim().slice(0, MEMO_MAX) });
                renderInvestmentCells(memoCard, memoGid);
            }
            closeModal('memo-modal');
        });

        // Populate filters in drawer, restore saved state, then render
        populateDrawerFilters();
        loadFiltersFromStorage();
        renderAllCards();
        updateInvestmentSummary();
        applyFilters();
        calculateAndDisplayScores();

        // Search setup
        setupSearch();

        // Tracker checkbox delegation
        cachedElements.shipListContainer.addEventListener('change', (e) => {
            if (e.target.classList.contains('tracker-checkbox')) {
                handleCheckboxLogic(e.target);
                coupleCardAfterChange(e.target.closest('.ship-card'), e.target.dataset.type, e.target.checked);
                autoSaveProgress();
                if (isProgressFilterActive()) {
                    applyFilters();
                } else {
                    debouncedCalculateScores();
                }
            }
        });

        // Row expander + investment action delegation (single listener).
        cachedElements.shipListContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const card = btn.closest('.ship-card');
            if (!card) return;
            const gid = card.dataset.shipId;
            const action = btn.dataset.action;
            if (action === 'expand') {
                const open = card.classList.toggle('lr-expanded');
                card.querySelectorAll('[data-action="expand"]')
                    .forEach(b => b.setAttribute('aria-expanded', String(open)));
            } else if (action === 'aff' || action === 'skl') {
                const labels = action === 'aff' ? AFF_LABELS : SKL_LABELS;
                statusMenu.open({
                    trigger: btn,
                    options: labels.map((label, value) => ({ value, label })),
                    current: getInv(gid)[action] || 0,
                    onSelect: (value) => {
                        setInv(gid, { [action]: value });
                        renderInvestmentCells(card, gid);
                        // the trigger node was replaced — refocus its successor
                        card.querySelector(`[data-action="${action}"]`)?.focus({ preventScroll: true });
                    },
                });
            } else if (action === 'fav' || action === 'ret') {
                setInv(gid, { [action]: getInv(gid)[action] ? 0 : 1 });
                renderInvestmentCells(card, gid);
                card.querySelector(`[data-action="${action}"]`)?.focus({ preventScroll: true });
            } else if (action === 'cap') {
                const { mask, cap } = applyCapChange(getCardProgressState(card), parseDatasetInt(btn.dataset.break));
                setInv(gid, { cap });
                setCardMask(card, mask);
                renderInvestmentCells(card, gid);
                updateInvestmentSummary();
                card.querySelector(`[data-action="cap"][data-break="${btn.dataset.break}"]`)?.focus({ preventScroll: true });
            } else if (action === 'memo') {
                openMemoModal(gid, card);
            }
        });

        // Cross-tab sync for GOAL_KEY only — progress sync is handled by progressStore above.
        // GOAL_KEY stores a bare string (legacy wire format) and is read by drive-sync.summary.js
        // as such, so it stays outside syncedStorage to preserve format compatibility.
        window.addEventListener('storage', (e) => {
            if (e.key !== GOAL_KEY) return;
            const goalModal = document.getElementById('goal-modal');
            if (goalModal?.classList.contains('active')) {
                renderGoalTracker();
            }
        });
    }

    // Start the application.
    initialize();
});
