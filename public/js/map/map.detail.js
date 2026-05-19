/**
 * map.detail.js
 * Renders all map detail panels: info cards, stats chips, node overlays, world/archive/exploration views.
 * Part of the map module group (viewer + data + detail + grid + compare).
 * State is shared via a ref passed to setup() from map.viewer.js.
 * calcClearEstimate is also exported and used by map.compare.js for the compare table.
 */

import { showElement, hideElement, resolveUrl, getItemIconUrl } from '../utils.js';
import { getShipDropsForChapter, getShipInfo, getShipInfoByGid } from './map.data.js';

let state;

/** Receive shared state from map.viewer.js. */
export function setup(stateRef) {
    state = stateRef;
}

/** Property limitation stat names → Korean */
const STAT_NAMES = {
    level: '레벨', cannon: '포격', torpedo: '뇌장', air: '항공',
    antiaircraft: '대공', reload: '장전', hit: '명중', dodge: '회피',
    speed: '속력', luck: '운',
};

/** Ship type codes → Korean (for limitation display) */
const SHIP_TYPE_NAMES = {
    1: '구축', 2: '경순', 3: '중순', 4: '순전', 5: '전함',
    6: '경항모', 7: '항모', 8: '잠수', 9: '항순', 10: '항전',
    12: '공작', 13: '중장갑', 18: '초순', 20: '풍범', 21: '구감',
    quzhu: '구축', qingxun: '경순', zhongxun: '중순',
    zhan: '전함', hang: '항모', qinghang: '경항모',
    qianting: '잠수', hangzhan: '항전', hangxun: '항순',
};

/** Star condition types from chapterconst.lua GetAchieveDesc */
const STAR_CONDITIONS = {
    1: '적 중요 함대 격파',
    2: '호위 함대 격파',
    3: '모든 적함 격파',
    4: '출격 인원수 제한',
    5: '특정 함종 미포함',
    6: 'Full Combo 완성 및 클리어',
};

/**
 * Calculate battle composition and estimates for a chapter clear.
 * Rules: elites first, boss as soon as it appears, normals fill the rest.
 * Multi-stage boss (model=12): multiple boss fights with separate refresh counts.
 */
export function calcClearEstimate(chapter) {
    const exps = chapter.expeditions || {};
    const eliteFleets = exps.elite || [];
    const normalFleets = exps.normal || [];
    const bossFleets = exps.boss || [];
    const limit = chapter.use_oil_limit || [];
    const isMultiBoss = chapter.model === 12 && chapter.multi_boss_refresh;

    // For multi-stage boss: total non-boss battles = boss_refresh,
    // but there are multiple boss fights interspersed
    const bossCount = isMultiBoss ? bossFleets.length : (bossFleets.length > 0 ? 1 : 0);
    const preBossBattles = chapter.boss_refresh || 0;
    const totalBattles = preBossBattles + bossCount;

    // Phase-based refresh arrays — sum each to get guaranteed per-clear spawn counts.
    // ai_refresh → champion (엘리트 in-game, type-12 diamond cells)
    // elite_refresh → strong-normal (강한 일반, type-4 cells)
    const championBattles = (chapter.ai_refresh || []).reduce((a, b) => a + b, 0);
    const strongNormalSpawns = (chapter.elite_refresh || []).reduce((a, b) => a + b, 0);

    // Clamp to remaining pre-boss slots in case a map over-declares. `eliteBattles` kept as
    // the variable name for historical compat (EXP calc below slices eliteFleets by it).
    const eliteBattles = Math.min(strongNormalSpawns, Math.max(0, preBossBattles - championBattles));
    const normalBattles = Math.max(0, preBossBattles - championBattles - eliteBattles);

    // EXP calculations
    const eliteExps = eliteFleets.slice(0, eliteBattles).map(f => f.exp || 0);
    const normalExps = normalFleets.map(f => f.exp || 0);
    const bossExpTotal = bossFleets.reduce((sum, f) => sum + (f.exp || 0), 0);

    // Commander EXP
    const eliteCmdExps = eliteFleets.slice(0, eliteBattles).map(f => f.exp_commander || 0);
    const normalCmdExps = normalFleets.map(f => f.exp_commander || 0);
    const bossCmdTotal = bossFleets.reduce((sum, f) => sum + (f.exp_commander || 0), 0);

    // Ship EXP: elite sum + normal avg * normalBattles + all bosses
    const eliteExpTotal = eliteExps.reduce((a, b) => a + b, 0);
    const normalAvgExp = normalExps.length > 0 ? normalExps.reduce((a, b) => a + b, 0) / normalExps.length : 0;
    const normalExpMin = normalExps.length > 0 ? Math.min(...normalExps) : 0;
    const normalExpMax = normalExps.length > 0 ? Math.max(...normalExps) : 0;

    const shipExpMin = eliteExpTotal + normalExpMin * normalBattles + bossExpTotal;
    const shipExpMax = eliteExpTotal + normalExpMax * normalBattles + bossExpTotal;
    const shipExpAvg = Math.round(eliteExpTotal + normalAvgExp * normalBattles + bossExpTotal);

    // Commander EXP
    const eliteCmdTotal = eliteCmdExps.reduce((a, b) => a + b, 0);
    const normalAvgCmd = normalCmdExps.length > 0 ? normalCmdExps.reduce((a, b) => a + b, 0) / normalCmdExps.length : 0;
    const cmdExpAvg = Math.round(eliteCmdTotal + normalAvgCmd * normalBattles + bossCmdTotal);

    // Oil estimate: use_oil_limit = [mob_cap, boss_cap, sub_cap]
    let oilMob = 0;
    let oilBoss = 0;
    let oilSub = 0;
    let oilTotal = null;
    if (limit.length >= 2) {
        oilMob = limit[0];
        oilBoss = limit[1];
        oilSub = limit.length >= 3 ? limit[2] : 0;
        // Mob battles (elite + normal) use mob cap, boss battles use boss cap
        oilTotal = oilMob * preBossBattles + oilBoss * bossCount;
    }

    // EXP per oil ratio
    const expPerOil = oilTotal > 0 ? (shipExpAvg / oilTotal) : null;

    return {
        totalBattles,
        bossCount,
        championBattles,
        eliteBattles,
        normalBattles,
        shipExpMin,
        shipExpMax,
        shipExpAvg,
        cmdExpAvg,
        oilMob,
        oilBoss,
        oilSub,
        oilTotal,
        expPerOil,
        hasOilLimit: limit.length >= 2,
        isMultiBoss,
        multiBossRefresh: chapter.multi_boss_refresh || null,
    };
}

/**
 * Render the main info card grid: star conditions, clear estimate, property limitations,
 * fleet limitations, item drops, and ship drops.
 * Sections are conditionally included based on available chapter fields.
 */
export function renderMapInfo(chapter, targetEl) {
    if (!chapter) return;

    const est = calcClearEstimate(chapter);
    let html = '<div class="info-grid">';

    // ── Card 1: 별 조건 (star conditions + threat levels + loop badge) ──
    html += '<div class="info-card">';
    html += '<div class="info-card-header"><div class="info-card-icon info-card-icon--star"><span class="material-symbols-outlined">star</span></div><div class="info-card-label">별 조건</div></div>';
    html += '<div class="info-card-body">';

    for (let i = 1; i <= 3; i++) {
        const starReq = chapter[`star_require_${i}`];
        const num = chapter[`num_${i}`] || 0;
        let desc = STAR_CONDITIONS[starReq] || `조건 ${starReq}`;
        if (starReq === 2 && num > 0) desc = `호위 함대 ${num}회 격파`;
        else if (starReq === 4 && num > 0) desc = `출격 인원수 ${num}명 이하`;
        else if (starReq === 6 && num > 0) desc = `Full Combo ${num}회 완성 및 클리어`;
        html += `<div class="condition-row"><span style="color:#eab308">${'⭐'.repeat(i)}</span> ${desc}</div>`;
    }

    if (chapter.progress_boss && chapter.progress_boss > 0) {
        const clearsNeeded = Math.ceil(100 / chapter.progress_boss);
        html += `<div class="map-detail-divider"><span style="color:var(--accent-blue)">100% 달성까지 필요한 클리어 횟수:</span> <b style="color:var(--primary-color)">${clearsNeeded}회</b></div>`;
    }

    const risks = chapter.risk_levels;
    if (risks && risks.length > 0) {
        const maxClears = risks[0][0];
        const tiers = risks.map((r, i) => {
            if (i === risks.length - 1) return '안전';
            return `${maxClears - r[1] + 1}회`;
        });
        html += `<div class="${chapter.progress_boss ? 'mt-xs' : 'map-detail-divider'}">`;
        html += `<span class="text-warning">위협레벨:</span> ${tiers.join(' → ')}`;
        html += `<br><span class="text-dim">총 ${maxClears}회 클리어</span>`;
        html += '</div>';
    }

    if (chapter.has_loop) {
        html += '<div class="loop-badge">🔄 주회 가능</div>';
    }

    html += '</div></div>'; // close info-card-body + info-card

    // ── Card 2: 클리어 정보 (clear estimate with mini stat boxes) ──
    if (est.totalBattles > 0) {
        html += '<div class="info-card">';
        html += '<div class="info-card-header"><div class="info-card-icon info-card-icon--oil"><span class="material-symbols-outlined">bar_chart</span></div><div class="info-card-label">클리어 정보</div></div>';
        html += '<div class="info-card-body">';

        const bossLabel = est.isMultiBoss ? `보스 ${est.bossCount}` : '보스 1';
        // 강한 일반 (type-4) and 일반 (type-6) are both "mob battles" in the game's auto-mode
        // battle-count display — they tick the same boss_refresh counter. Merge for display;
        // the internal eliteBattles split is still used by the EXP estimate below.
        const mobBattles = est.eliteBattles + est.normalBattles;
        const battleSub = [
            est.championBattles > 0 ? `엘리트 ${est.championBattles}` : null,
            mobBattles > 0 ? `일반 ${mobBattles}` : null,
            bossLabel,
        ].filter(Boolean).join(' + ');

        html += '<div class="clear-stats">';

        // Box 1: 전투 횟수
        html += '<div class="clear-stat">';
        html += '<div class="clear-stat-label">전투 횟수</div>';
        html += `<div class="clear-stat-value">${est.totalBattles}전</div>`;
        html += `<div class="clear-stat-sub">${battleSub}</div>`;
        html += '</div>';

        // Box 2: 예상 연료 (only if hasOilLimit)
        if (est.hasOilLimit) {
            html += '<div class="clear-stat">';
            html += '<div class="clear-stat-label">예상 연료</div>';
            const oilWithSub = est.oilSub > 0 ? est.oilTotal + est.oilSub * est.totalBattles : 0;
            html += `<div class="clear-stat-value">${est.oilTotal.toLocaleString()}${oilWithSub ? ` <span style="font-size:0.75rem;font-weight:400;color:var(--text-muted)">(잠수 ${oilWithSub.toLocaleString()})</span>` : ''}</div>`;
            html += `<div class="clear-stat-sub">일반 ${chapter.use_oil_limit[0]} / 보스 ${chapter.use_oil_limit[1]}${chapter.use_oil_limit[2] ? ` / 잠수 ${chapter.use_oil_limit[2]}` : ''}</div>`;
            html += '</div>';
        }

        // Box 3: 함순이 EXP
        html += '<div class="clear-stat">';
        html += '<div class="clear-stat-label">함순이 EXP</div>';
        if (est.shipExpMin === est.shipExpMax) {
            html += `<div class="clear-stat-value">${est.shipExpAvg.toLocaleString()}</div>`;
        } else {
            html += `<div class="clear-stat-value">${est.shipExpAvg.toLocaleString()}</div>`;
            html += `<div class="clear-stat-sub">${est.shipExpMin.toLocaleString()} ~ ${est.shipExpMax.toLocaleString()}</div>`;
        }
        html += '</div>';

        // Box 4: 지휘관 EXP
        if (est.cmdExpAvg > 0) {
            html += '<div class="clear-stat">';
            html += '<div class="clear-stat-label">지휘관 EXP</div>';
            html += `<div class="clear-stat-value">${est.cmdExpAvg.toLocaleString()}</div>`;
            html += '</div>';
        }

        // Box 5: EXP/연료 (only if expPerOil !== null)
        if (est.expPerOil !== null) {
            html += '<div class="clear-stat">';
            html += '<div class="clear-stat-label">EXP/연료</div>';
            html += `<div class="clear-stat-value">${est.expPerOil.toFixed(2)}</div>`;
            html += '</div>';
        }

        // Box 6: 이벤트 pt (event maps only)
        if (chapter.event_pt) {
            html += '<div class="clear-stat">';
            html += '<div class="clear-stat-label">이벤트 pt</div>';
            html += `<div class="clear-stat-value">${chapter.event_pt.toLocaleString()}</div>`;
            html += '<div class="clear-stat-sub">클리어당</div>';
            html += '</div>';
        }

        html += '</div>'; // close clear-stats

        // Multi-boss info as muted line below the grid
        if (est.isMultiBoss && est.multiBossRefresh) {
            let cumulative = 0;
            const stages = est.multiBossRefresh.map(r => { cumulative += r; return `${cumulative}전째`; });
            html += `<div class="mt-xs text-muted" style="font-size:0.75rem">보스 출현: ${stages.join(' → ')}</div>`;
        }

        html += '</div></div>'; // close info-card-body + info-card
    }

    // ── Card 3: 출격 조건 (property limitations, hard mode) ──
    if (chapter.property_limitation && chapter.property_limitation.length > 0) {
        html += '<div class="info-card">';
        html += '<div class="info-card-header"><div class="info-card-icon info-card-icon--fleet"><span class="material-symbols-outlined">tune</span></div><div class="info-card-label">출격 조건</div></div>';
        html += '<div class="info-card-body">';
        for (const req of chapter.property_limitation) {
            const name = STAT_NAMES[req[0]] || req[0];
            const value = req[2];
            html += `<span class="stat-req"><span class="stat-req-name">${name}</span> <span class="stat-req-value">≥ ${value}</span></span>`;
        }
        html += '</div></div>';
    }

    // ── Card 4: 편성 제한 (fleet limitations, hard mode) ──
    if (chapter.limitation && chapter.limitation.length > 0) {
        html += '<div class="info-card">';
        html += '<div class="info-card-header"><div class="info-card-icon info-card-icon--fleet"><span class="material-symbols-outlined">anchor</span></div><div class="info-card-label">편성 제한</div></div>';
        html += '<div class="info-card-body">';
        chapter.limitation.forEach((fleet, fi) => {
            html += `<div class="mb-xs">함대 ${fi + 1}:</div>`;
            fleet.forEach((slot) => {
                const types = slot.filter(s => s !== 0).map(s => SHIP_TYPE_NAMES[s] || s).join(' / ');
                if (types) {
                    html += `<span class="fleet-limit-slot">${types}</span>`;
                }
            });
        });
        html += '</div></div>';
    }

    // ── Card 5: 아이템 드랍 ──
    const itemDrops = chapter.item_drops;
    if (itemDrops && itemDrops.length > 0) {
        html += '<div class="info-card full-width">';
        html += '<div class="info-card-header"><div class="info-card-icon info-card-icon--drop"><span class="material-symbols-outlined">inventory_2</span></div><div class="info-card-label">아이템 드랍</div></div>';
        html += '<div class="info-card-body">';
        html += '<div class="drop-list">';
        for (const drop of itemDrops) {
            const iconUrl = getItemIconUrl(drop.icon);
            if (drop.sub_items && drop.sub_items.length > 0) {
                html += `<div class="drop-group">`;
                html += `<div class="drop-group-header" title="${drop.name}">`;
                if (iconUrl) html += `<img class="drop-icon" src="${iconUrl}" alt="" loading="lazy" data-onfail="hide">`;
                html += `<span class="drop-item-name">${drop.name}</span>`;
                html += `</div>`;
                html += `<div class="drop-group-items">`;
                for (const sub of drop.sub_items) {
                    const subIconUrl = getItemIconUrl(sub.icon);
                    const rarityClass = sub.rarity ? `drop-sub-rarity-${sub.rarity}` : '';
                    html += `<span class="drop-sub-item ${rarityClass}" title="${sub.name}">`;
                    if (subIconUrl) html += `<img class="drop-sub-icon" src="${subIconUrl}" alt="" loading="lazy" data-onfail="hide">`;
                    html += `<span class="drop-item-name">${sub.name}</span>`;
                    html += '</span>';
                }
                html += '</div></div>';
            } else {
                html += `<span class="drop-item" title="${drop.name}">`;
                if (iconUrl) html += `<img class="drop-icon" src="${iconUrl}" alt="" loading="lazy" data-onfail="hide">`;
                html += `<span class="drop-item-name">${drop.name}</span>`;
                html += '</span>';
            }
        }
        html += '</div></div></div>';
    }

    // ── Card 6: 함순이 드랍 ──
    const shipDrops = getShipDropsForChapter(String(chapter.id));
    if (shipDrops.length > 0) {
        html += '<div class="info-card full-width">';
        html += '<div class="info-card-header"><div class="info-card-icon info-card-icon--ship"><span class="material-symbols-outlined">sailing</span></div><div class="info-card-label">함순이 드랍</div></div>';
        html += '<div class="info-card-body">';
        html += '<div class="ship-drop-grid">';
        for (const ship of shipDrops) {
            const infoUrl = resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(ship.name)}`);
            html += `<a href="${infoUrl}" class="ship-drop-card ship-drop-rarity-${ship.rarity}" title="${ship.name}${ship.bossOnly ? ' (보스 한정)' : ''}">`;
            const iconSrc = ship.shipyard ? ship.shipyard.replace('shipyard.png', 'icon.png') : '';
            if (iconSrc) {
                html += `<img class="ship-drop-portrait" src="${iconSrc}" alt="${ship.name}" loading="lazy" data-onfail="hide">`;
            }
            html += `<div class="ship-drop-name">${ship.name}</div>`;
            if (ship.bossOnly) html += `<span class="ship-drop-boss">보스</span>`;
            html += '</a>';
        }
        html += '</div></div></div>';
    }

    html += '</div>'; // close info-grid
    targetEl.innerHTML = html;
}

/** Render quick stats chips (oil, ammo, air dominance, boss refresh, fleet count, oil cap) for standard maps. */
export function renderStats(chapter, targetEl) {
    if (!chapter) return;

    const chips = [
        { icon: 'local_gas_station', label: '연료', value: chapter.oil },
        { icon: 'bomb', label: '탄약', value: chapter.ammo_total },
        { icon: 'flight', label: '제공', value: chapter.air_dominance },
        { icon: 'swords', label: '보스출현', value: `${chapter.boss_refresh}전` },
        { icon: 'groups', label: '함대', value: chapter.group_num + (chapter.submarine_num ? ` + 잠수${chapter.submarine_num}` : '') },
    ];

    if (chapter.unlocklevel > 0) {
        chips.push({ icon: 'lock', label: '레벨', value: `Lv.${chapter.unlocklevel}` });
    }

    const hasOilCap = chapter.use_oil_limit && chapter.use_oil_limit.length >= 2;
    chips.push({ icon: 'oil_barrel', label: '기름상한', value: hasOilCap ? 'O' : 'X', accent: hasOilCap ? 'green' : 'red' });

    targetEl.innerHTML = chips.map(c => {
        const accentClass = c.accent === 'green' ? ' stat-value--yes' : c.accent === 'red' ? ' stat-value--no' : '';
        return `<div class="map-stat-chip">
            <span class="stat-icon material-symbols-outlined">${c.icon}</span>
            <span class="stat-label">${c.label}</span>
            <span class="stat-value${accentClass}">${c.value}</span>
        </div>`;
    }).join('');
}

/** Render world chapter info cards (expedition level, difficulty, tiered EXP). */
export function renderWorldInfo(chapter, targetEl) {
    let html = '<div class="info-grid">';

    html += '<div class="info-card">';
    html += '<div class="info-card-header"><div class="info-card-icon info-card-icon--info"><span class="material-symbols-outlined">info</span></div><div class="info-card-label">해역 정보</div></div>';
    html += '<div class="info-card-body">';
    html += `<div>적 레벨: Lv.${chapter.expedition_level}</div>`;
    html += `<div>난이도: ${chapter.difficulty}</div>`;
    html += '</div></div>';

    if (chapter.world_exp) {
        const we = chapter.world_exp;
        html += '<div class="info-card">';
        html += '<div class="info-card-header"><div class="info-card-icon info-card-icon--exp"><span class="material-symbols-outlined">trending_up</span></div><div class="info-card-label">경험치 (티어별)</div></div>';
        html += '<div class="info-card-body">';
        html += `<div>지휘관 EXP: ${we.exp_player}</div>`;
        if (we.exp_world && we.exp_world.length > 0) {
            html += '<div class="mt-xs">함대 EXP:</div>';
            for (const [tier, exp] of we.exp_world) {
                html += `<div class="ml-sm">티어 ${tier}: ${exp}</div>`;
            }
        }
        html += '</div></div>';
    }

    html += '</div>';
    targetEl.innerHTML = html;
}

/** Render world chapter stat chips (enemy level, difficulty). */
export function renderWorldStats(chapter, targetEl) {
    const chips = [
        { icon: 'swords', label: '적 레벨', value: `Lv.${chapter.expedition_level}` },
        { icon: 'speed', label: '난이도', value: chapter.difficulty },
    ];

    targetEl.innerHTML = chips.map(c =>
        `<div class="map-stat-chip">
            <span class="stat-icon material-symbols-outlined">${c.icon}</span>
            <span class="stat-label">${c.label}</span>
            <span class="stat-value">${c.value}</span>
        </div>`
    ).join('');
}

/** Render archive chapter stat chips (boss refresh, fleet count). */
export function renderArchiveStats(chapter, targetEl) {
    const chips = [];
    if (chapter.boss_refresh) chips.push({ icon: 'swords', label: '보스출현', value: `${chapter.boss_refresh}전` });
    if (chapter.group_num) chips.push({ icon: 'groups', label: '함대', value: chapter.group_num + (chapter.submarine_num ? ` + 잠수${chapter.submarine_num}` : '') });

    targetEl.innerHTML = chips.map(c =>
        `<div class="map-stat-chip">
            <span class="stat-icon material-symbols-outlined">${c.icon}</span>
            <span class="stat-label">${c.label}</span>
            <span class="stat-value">${c.value}</span>
        </div>`
    ).join('');
}

/** Render archive chapter info cards.
 *  Reuses renderMapInfo for standard info (star conditions, clear estimate, item drops),
 *  then appends archive-specific cards (special drop, per-map ship drops). */
export function renderArchiveInfo(chapter, targetEl) {
    // First render standard map info (star conditions, clear estimate, drops, etc.)
    renderMapInfo(chapter, targetEl);

    // Append archive-specific cards inside the existing .info-grid
    const grid = targetEl.querySelector('.info-grid');
    if (!grid) return;

    let extra = '';

    // ── Special Drop Card (60-clear reward) ──
    if (chapter.special_drop) {
        const sd = chapter.special_drop;
        const isShip = sd.type === 4;
        extra += '<div class="info-card full-width">';
        extra += '<div class="info-card-header"><div class="info-card-icon info-card-icon--star"><span class="material-symbols-outlined">emoji_events</span></div><div class="info-card-label">특별 보상 (' + sd.count + '회 클리어)</div></div>';
        extra += '<div class="info-card-body">';
        if (isShip) {
            const ship = getShipInfoByGid(sd.id) || getShipInfo(sd.id);
            if (ship) {
                const infoUrl = resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(ship.name)}`);
                const iconSrc = ship.shipyard ? ship.shipyard.replace('shipyard.png', 'icon.png') : '';
                extra += '<div style="display:flex;align-items:center;gap:0.75rem">';
                if (iconSrc) extra += `<a href="${infoUrl}"><img style="width:3rem;height:3rem;border-radius:0.5rem;object-fit:cover" src="${iconSrc}" alt="${ship.name}" loading="lazy" data-onfail="hide"></a>`;
                extra += `<div><a href="${infoUrl}" style="font-weight:600;text-decoration:none;color:var(--text-primary)">${ship.name}</a>`;
                extra += `<div class="text-muted" style="font-size:0.78rem">${sd.count}회 클리어 시 획득</div></div>`;
                extra += '</div>';
            } else {
                extra += `<div>${sd.count}회 클리어 시 함순이 획득 (ID: ${sd.id})</div>`;
            }
        } else {
            const itemIconUrl = sd.icon ? getItemIconUrl(sd.icon) : '';
            extra += '<div style="display:flex;align-items:center;gap:0.75rem">';
            if (itemIconUrl) extra += `<img style="width:3rem;height:3rem;border-radius:0.5rem;object-fit:contain;background:var(--bg-elevated);padding:0.2rem" src="${itemIconUrl}" alt="" loading="lazy" data-onfail="hide">`;
            extra += `<div><span style="font-weight:600">${sd.name || `아이템 #${sd.id}`}</span>`;
            extra += `<div class="text-muted" style="font-size:0.78rem">${sd.count}회 클리어 시 획득</div></div>`;
            extra += '</div>';
        }
        if (chapter.special_drop_display) {
            const stages = chapter.special_drop_display.map(d => d[1]).join(', ');
            extra += `<div class="text-muted mt-xs" style="font-size:0.78rem">드랍 해역: ${stages}</div>`;
        }
        extra += '</div></div>';
    }

    // ── Ship Drops Card (per-map) ──
    const archiveDrops = chapter.ship_drops_archive;
    if (archiveDrops && archiveDrops.length > 0) {
        extra += '<div class="info-card full-width">';
        extra += '<div class="info-card-header"><div class="info-card-icon info-card-icon--ship"><span class="material-symbols-outlined">sailing</span></div><div class="info-card-label">함순이 드랍</div></div>';
        extra += '<div class="info-card-body"><div class="ship-drop-grid">';
        for (const drop of archiveDrops) {
            const ship = getShipInfo(drop.id);
            if (!ship) continue;
            const infoUrl = resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(ship.name)}`);
            const iconSrc = ship.shipyard ? ship.shipyard.replace('shipyard.png', 'icon.png') : '';
            const title = ship.name + (drop.type === 1 ? ' (보스 한정)' : '') + (drop.pity ? ' (확정)' : '');
            extra += `<a href="${infoUrl}" class="ship-drop-card ship-drop-rarity-${ship.rarity}" title="${title}">`;
            if (iconSrc) extra += `<img class="ship-drop-portrait" src="${iconSrc}" alt="${ship.name}" loading="lazy" data-onfail="hide">`;
            extra += `<div class="ship-drop-name">${ship.name}</div>`;
            if (drop.type === 1) extra += `<span class="ship-drop-boss">보스</span>`;
            extra += '</a>';
        }
        extra += '</div></div></div>';
    }

    if (extra) grid.insertAdjacentHTML('beforeend', extra);
}

/** Render exploration map info cards (conditions, basic info, EXP tiers). */
export function renderExplorationInfo(chapter, targets, targetEl) {
    let html = '<div class="info-grid">';

    // ── Conditions Card (5 targets) ──
    if (targets.length > 0) {
        html += '<div class="info-card">';
        html += '<div class="info-card-header"><div class="info-card-icon info-card-icon--condition"><span class="material-symbols-outlined">military_tech</span></div><div class="info-card-label">달성 조건</div></div>';
        html += '<div class="info-card-body">';
        for (const target of targets) {
            const hiddenClass = target.hidden ? ' condition-row--hidden' : '';
            html += `<div class="condition-row${hiddenClass}">`;
            html += `<span style="font-weight:600;min-width:4.5rem">${target.target_name}</span> `;
            html += `<span>${target.target_desc}</span>`;
            if (target.hidden) html += ` <span class="condition-hidden-badge">숨겨진 조건</span>`;
            html += '</div>';
        }
        html += '</div></div>';
    }

    // ── Basic Info Card ──
    html += '<div class="info-card">';
    html += '<div class="info-card-header"><div class="info-card-icon info-card-icon--info"><span class="material-symbols-outlined">info</span></div><div class="info-card-label">해역 정보</div></div>';
    html += '<div class="info-card-body">';
    html += `<div>적 레벨: Lv.${chapter.expedition_level}</div>`;
    html += `<div>난이도: ${chapter.difficulty}</div>`;
    if (chapter.hazard_level) html += `<div>위험도: ${chapter.hazard_level}</div>`;
    html += '</div></div>';

    // ── EXP Tiers Card ──
    if (chapter.world_exp) {
        const we = chapter.world_exp;
        html += '<div class="info-card">';
        html += '<div class="info-card-header"><div class="info-card-icon info-card-icon--exp"><span class="material-symbols-outlined">trending_up</span></div><div class="info-card-label">경험치 (티어별)</div></div>';
        html += '<div class="info-card-body">';
        html += `<div>지휘관 EXP: ${we.exp_player}</div>`;
        if (we.exp_world && we.exp_world.length > 0) {
            html += '<div class="mt-xs">함대 EXP:</div>';
            for (const [tier, exp] of we.exp_world) {
                html += `<div class="ml-sm">티어 ${tier}: ${exp}</div>`;
            }
        }
        html += '</div></div>';
    }

    html += '</div>'; // close .info-grid
    targetEl.innerHTML = html;
}

/**
 * Render fleet detail for the clicked grid node in the floating overlay.
 * Maps attachType to the correct expedition list (boss/elite/normal/guarder/champion).
 * Shows only name, level, EXP, and commander EXP — no ship list.
 */
export function renderNodeDetail(attachType, chapter, targetEl, titleEl) {
    const exps = chapter.expeditions || {};
    let fleets = [];
    let title = '';

    if (attachType === 8) {
        fleets = exps.boss || [];
        title = '보스 함대';
    } else if (attachType === 12) {
        // Champion (엘리트 in-game): from ai_expedition_list
        fleets = exps.champion || [];
        title = '엘리트 함대';
    } else if (attachType === 4) {
        // 강한 일반: elite fleets + guarder fleets
        fleets = [...(exps.elite || []), ...(exps.guarder || [])];
        title = '강한 일반 · 호위 함대';
    } else {
        // Normal enemy (6, 7): normal + guarder fleets
        fleets = [...(exps.normal || []), ...(exps.guarder || [])];
        title = '일반 · 호위 함대';
    }

    if (titleEl) titleEl.textContent = title;

    if (fleets.length === 0) {
        targetEl.innerHTML = '<div class="detail-empty">함대 정보 없음</div>';
        return;
    }

    let html = '';
    for (const fleet of fleets) {
        const typeClass = fleet.type === 99 ? 'fleet-type--boss' :
                          fleet.type === 94 ? 'fleet-type--boss' : 'fleet-type--normal';
        html += `<div class="map-detail-card">`;
        html += `<div class="map-detail-card-title ${typeClass}">${fleet.name}</div>`;
        html += `<div class="map-detail-card-body">`;
        html += `Lv.${fleet.level} · EXP ${fleet.exp}`;
        if (fleet.exp_commander > 0) {
            html += ` · 지휘관 EXP ${fleet.exp_commander}`;
        }
        html += '</div></div>';
    }

    targetEl.innerHTML = html;
}
