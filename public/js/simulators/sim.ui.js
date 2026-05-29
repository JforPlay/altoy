/**
 * Shared UI helpers for the simulator pages.
 * Keeps playback controls, entity registration, weapon-card rendering, and
 * selector population consistent across the weapon and aircraft simulators.
 */

export const SIM_GAME_COORDS = {
    totalArea: { minX: -120, minY: 30, maxX: 80, maxY: 85 },
    playerArea: { minX: -120, minY: 30, maxX: 15, maxY: 85 }
};

export const SIM_TARGET_FPS = 30;
export const SIM_DEFAULT_SPEED = 1;

const AMMO_TYPE_NAMES = {
    1: '철갑탄', 2: '고폭탄', 3: '통상탄', 4: '음향 유도', 5: '통상',
    6: '삼식탄', 7: '반철갑탄(SAP탄)', 8: '자성식', 9: '격발식', 10: '없음', 11: '미사일',
};

const BULLET_TYPE_NAMES = {
    1: '포탄', 2: '폭탄', 3: '어뢰', 4: '직격', 5: '파편',
    6: '대공', 7: '대함', 9: '이펙트', 10: '빔', 11: '중력장',
    12: '전격', 13: '미사일', 14: '우주레이저', 15: '확장탄',
};

// Game-frame → ms (frame-time inputs use SIM_TARGET_FPS as the divisor).
export function convertToMs(value, timeUnitIsFrames = false) {
    return timeUnitIsFrames ? (value / SIM_TARGET_FPS) * 1000 : value * 1000;
}

function createElement(tag, className, text = null) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== null) element.textContent = String(text);
    return element;
}

function setPressed(button, isPressed) {
    if (!button) return;
    button.classList.toggle('active', isPressed);
    button.setAttribute('aria-pressed', String(isPressed));
}

function renderPlaceholder(container, message, type = 'placeholder') {
    const card = createElement('div', `card placeholder-card sim-${type}-card`);
    card.appendChild(createElement('p', '', message));
    container.replaceChildren(card);
}

function registerDefaultBattleEntities(simEngine, elements, options = {}) {
    const { enemyCentered = false } = options;
    simEngine.registerEntities({
        vanguard: {
            element: elements.vanguard,
            baseWidth: 6.5,
            aspectRatio: 178 / 226,
            gamePos: { x: -36, y: 58 }
        },
        mainfleet: {
            element: elements.mainfleet,
            baseWidth: 6.5,
            aspectRatio: 195 / 253,
            gamePos: { x: -105, y: 58 }
        },
        // No static gamePos — position is derived from the `centered` state below.
        enemy: {
            element: elements.enemy,
            baseWidth: 7.0,
            aspectRatio: 369 / 300
        }
    });

    simEngine.registerEntityState('enemy', {
        getGamePos: (state) => ({ x: 15, y: state.centered ? 58 : 72 })
    });
    simEngine.setEntityState('enemy', 'centered', enemyCentered);
}

function setupSpeedControls(simEngine, buttons = document.querySelectorAll('.speed-btn')) {
    const speedButtons = Array.from(buttons);

    function activate(button) {
        const speed = parseFloat(button.dataset.speed);
        for (const speedButton of speedButtons) {
            setPressed(speedButton, speedButton === button);
        }
        if (Number.isFinite(speed)) {
            simEngine.bulletEngine.gSpeed = speed;
        }
    }

    for (const button of speedButtons) {
        button.type = 'button';
        setPressed(button, button.classList.contains('active'));
        button.addEventListener('click', () => activate(button));
    }
}

// Reads the active speed at click time, so callers don't need to plumb it through.
function setupPauseButton(simEngine, pauseButton) {
    let isPaused = false;
    const icon = pauseButton?.querySelector('.material-symbols-outlined');

    function update() {
        if (icon) icon.textContent = isPaused ? 'play_arrow' : 'pause';
        pauseButton.title = isPaused ? '재생' : '일시정지';
        pauseButton.setAttribute('aria-label', pauseButton.title);
        pauseButton.setAttribute('aria-pressed', String(isPaused));
    }

    function getActiveSpeed() {
        const active = document.querySelector('.speed-btn.active');
        return active ? parseFloat(active.dataset.speed) || SIM_DEFAULT_SPEED : SIM_DEFAULT_SPEED;
    }

    pauseButton.type = 'button';
    update();
    pauseButton.addEventListener('click', () => {
        isPaused = !isPaused;
        simEngine.bulletEngine.gSpeed = isPaused ? 0 : getActiveSpeed();
        update();
    });
}

function setupEnemyToggle(simEngine, enemyToggle, playerAreaElement) {
    function sync() {
        const isCentered = simEngine.getEntityState('enemy', 'centered');
        enemyToggle.textContent = isCentered ? '적 위치: 중앙' : '적 위치: 상단';
        enemyToggle.classList.toggle('centered', isCentered);
        enemyToggle.setAttribute('aria-pressed', String(isCentered));
    }

    enemyToggle.type = 'button';
    sync();
    enemyToggle.addEventListener('click', () => {
        const currentState = simEngine.getEntityState('enemy', 'centered');
        simEngine.setEntityState('enemy', 'centered', !currentState);
        sync();
        simEngine.updateLayoutAndScale(playerAreaElement);
    });
}

function renderLevelToggle(container, label, isActive, onClick) {
    if (!label) {
        container.replaceChildren();
        return null;
    }

    const button = createElement('button', isActive ? 'level-10' : '', label);
    button.id = 'level-toggle';
    button.type = 'button';
    button.setAttribute('aria-pressed', String(isActive));
    button.addEventListener('click', onClick);
    container.replaceChildren(button);
    return button;
}

// Make a non-button element behave like one (Enter/Space activate, screen-reader role).
function makeClickableCard(element, { onActivate, ariaLabel }) {
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    if (ariaLabel) element.setAttribute('aria-label', ariaLabel);
    element.onclick = onActivate;
    element.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onActivate();
    };
}

// Used for both the skill-meta and aircraft-meta label/value rows.
function createMetaRow(label, value) {
    const row = createElement('div', 'skill-meta-row');
    row.append(
        createElement('span', 'meta-label', label),
        createElement('span', 'meta-value', value)
    );
    return row;
}

/**
 * Populate a <select> with grouped choices, preferring the global Choices.js
 * widget (loaded via CDN) and falling back to native <optgroup>s when it's
 * unavailable. Returns the Choices instance (or null in the fallback path).
 */
function populateChoicesOrSelect(selectEl, choiceGroups, options = {}) {
    const { choicesConfig = {}, firstValue = null, destroyExisting = null } = options;
    if (destroyExisting) destroyExisting.destroy();
    selectEl.replaceChildren();

    let instance = null;
    if (typeof Choices === 'undefined') {
        for (const group of choiceGroups) {
            const optgroup = document.createElement('optgroup');
            optgroup.label = group.label;
            for (const choice of group.choices) {
                const option = document.createElement('option');
                option.value = choice.value;
                option.textContent = choice.label;
                optgroup.appendChild(option);
            }
            selectEl.appendChild(optgroup);
        }
    } else {
        instance = new Choices(selectEl, { choices: choiceGroups, ...choicesConfig });
    }

    if (firstValue !== null && firstValue !== undefined) {
        if (instance) instance.setChoiceByValue(String(firstValue));
        else selectEl.value = String(firstValue);
    }
    return instance;
}

function createStatItem(label, value) {
    const item = createElement('div', 'stat-item');
    item.append(
        createElement('span', 'stat-label', label),
        createElement('span', 'stat-value', value)
    );
    return item;
}

function buildArmorRow(damageType) {
    const row = createElement('div', 'armor-row');
    // damage_type values are damage multipliers (e.g. 1.25, 0.85), shown as percent.
    [['경장', damageType[0]], ['중장', damageType[1]], ['중장갑', damageType[2]]].forEach(([label, value]) => {
        const chip = createElement('div', 'armor-chip');
        chip.append(createElement('span', 'armor-label', label), document.createTextNode(`${Math.round(value * 100)}%`));
        row.appendChild(chip);
    });
    return row;
}

function appendBarrageItem(grid, label, value) {
    const item = createElement('div', 'barrage-detail-item');
    item.append(createElement('span', 'stat-label', label), document.createTextNode(` ${value}`));
    grid.appendChild(item);
}

function buildBarrageDetails(weapon, weaponInfo, barrageData) {
    if (!Array.isArray(weapon.barrage_ID) || weapon.barrage_ID.length === 0) return null;
    const firstBarrage = barrageData[weapon.barrage_ID[0]];
    if (!firstBarrage) return null;

    const details = createElement('details', 'barrage-details');
    details.appendChild(createElement('summary', '', `탄막 상세 (${weapon.barrage_ID.length}개 패턴)`));

    const grid = createElement('div', 'barrage-detail-grid');
    appendBarrageItem(grid, '각도', `${firstBarrage.angle || 0}°`);
    appendBarrageItem(grid, 'Δ각도', `${firstBarrage.delta_angle || 0}°`);
    appendBarrageItem(grid, '딜레이', `${firstBarrage.delay || 0}s`);
    appendBarrageItem(grid, '반복', `${(firstBarrage.primal_repeat || 0) + 1}발`);
    if (firstBarrage.senior_repeat) appendBarrageItem(grid, '시니어', `${firstBarrage.senior_repeat + 1}회`);
    if (weaponInfo.quota) appendBarrageItem(grid, 'Quota', `${weaponInfo.quota}회`);
    if (weaponInfo.time) appendBarrageItem(grid, '발동', `${weaponInfo.time}f`);

    details.appendChild(grid);
    return details;
}

function buildWeaponCard(weapon, weaponInfo, index, showNumber, dataStores) {
    const firstBulletId = weapon.bullet_ID?.[0];
    const bulletInfo = firstBulletId ? dataStores.bulletData[firstBulletId] : null;
    // Ammo 10 (없음) is the canonical fallback for unknown/missing ammo — keeps
    // badge name and color in sync.
    const rawAmmoType = Number(bulletInfo?.ammo_type || 0);
    const ammoType = AMMO_TYPE_NAMES[rawAmmoType] ? rawAmmoType : 10;
    const ammoName = AMMO_TYPE_NAMES[ammoType];
    const bulletType = bulletInfo?.type || 0;
    const bulletTypeName = BULLET_TYPE_NAMES[bulletType] || '일반';

    let totalBullets = 0;
    if (Array.isArray(weapon.barrage_ID)) {
        for (const barrageId of weapon.barrage_ID) {
            const barrage = dataStores.barrageData[barrageId];
            if (barrage) totalBullets += (barrage.primal_repeat || 0) + 1;
        }
    }
    totalBullets *= (weaponInfo.quota || 1);

    const reloadMs = weapon.reload_max;
    const reloadDisplay = reloadMs ? `${(reloadMs / 10).toFixed(1)}s` : '-';
    const range = weapon.range || bulletInfo?.range || '-';
    const damage = weapon.damage || '-';
    const corrected = weapon.corrected ? ` (×${weapon.corrected}%)` : '';
    const pierce = bulletInfo?.pierce_count || '-';

    const card = createElement('div', 'weapon-card');
    const header = createElement('div', 'weapon-card-header');
    const title = createElement('div', 'weapon-card-title', showNumber ? `무기 ${index}` : '무기 정보');
    const ammoBadge = createElement('span', 'ammo-badge', ammoName);
    ammoBadge.style.background = `var(--ammo-color-${ammoType})`;
    title.append(document.createTextNode(' '), ammoBadge);
    header.append(title, createElement('span', 'weapon-card-id', weaponInfo.weaponId));

    const stats = createElement('div', 'weapon-stats');
    [
        ['탄종', bulletTypeName],
        ['데미지', `${damage}${corrected}`],
        ['장전', reloadDisplay],
        ['사거리', range],
        ['발사 수', totalBullets],
        ['관통', pierce],
    ].forEach(([label, value]) => stats.appendChild(createStatItem(label, value)));

    const damageType = bulletInfo?.damage_type;
    if (Array.isArray(damageType) && damageType.length >= 3) {
        stats.appendChild(buildArmorRow(damageType));
    }

    card.append(header, stats);
    const details = buildBarrageDetails(weapon, weaponInfo, dataStores.barrageData);
    if (details) card.appendChild(details);
    return card;
}

export {
    buildWeaponCard,
    createMetaRow,
    makeClickableCard,
    populateChoicesOrSelect,
    renderLevelToggle,
    renderPlaceholder,
    registerDefaultBattleEntities,
    setPressed,
    setupEnemyToggle,
    setupPauseButton,
    setupSpeedControls
};
