/**
 * Shared UI helpers for the simulator pages.
 * Keeps playback controls, entity registration, weapon-card rendering, and
 * selector population consistent across the weapon and aircraft simulators.
 */

import { computeBarrageStats, weaponCooldownSeconds } from './sim.weapon.stats.js';

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
        // Apply the shared scrollbar utility to the library-generated dropdown list.
        instance.dropdown.element.classList.add('scroll-styled');
    }

    if (firstValue !== null && firstValue !== undefined) {
        if (instance) instance.setChoiceByValue(String(firstValue));
        else selectEl.value = String(firstValue);
    }
    return instance;
}

function createStatItem(label, value) {
    const item = createElement('div', 'stat-item');
    const valueEl = createElement('span', 'stat-value');
    if (value instanceof Node) valueEl.appendChild(value);
    else valueEl.textContent = String(value);
    item.append(createElement('span', 'stat-label', label), valueEl);
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

// Inline barrage breakdown (replaces the old <details> collapsible). Rows follow
// the game's firing model via computeBarrageStats; zero-valued rows are omitted.
function buildBarrageRows(weapon, weaponInfo, barrageData) {
    const stats = computeBarrageStats(weapon, { barrageData }, weaponInfo);
    if (!stats) return null;

    const wrap = createElement('div', 'barrage-rows');
    const addRow = (cls, label, value) => {
        const row = createElement('div', cls);
        row.append(createElement('span', 'stat-label', label), createElement('span', 'stat-value', value));
        wrap.appendChild(row);
    };

    addRow('barrage-row', '연사 횟수', `${stats.waves}회`);
    addRow('barrage-row', '1연사당 발수', `${stats.bulletsPerWave}발`);
    if (stats.delay) addRow('barrage-row', '탄 간격', `${stats.delay}s`);
    if (stats.seniorDelay) addRow('barrage-row', '연사 간격', `${stats.seniorDelay}s`);
    if (stats.scatterAngle) addRow('barrage-row', '산포각', `${stats.scatterAngle}°`);
    if (weaponInfo.time) addRow('barrage-row', '발동 딜레이', `${(weaponInfo.time / SIM_TARGET_FPS).toFixed(2)}s`);
    if (stats.patternCount > 1) addRow('barrage-row', '탄막 패턴', `${stats.patternCount}개`);
    addRow('barrage-total', '총 발사 수', `${stats.totalBullets}발`);
    return wrap;
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

    // Reload time (장전), NOT the skill firing cadence: skill-fired weapons fire
    // once per skill trigger (BattleSkillFire bypasses reload), so this reload_max-
    // derived value is the weapon's intrinsic reload, not how often the skill fires.
    // The skill's real trigger cooldown is shown on the skill-info card instead.
    const reloadSeconds = weaponCooldownSeconds(weapon.reload_max);
    const range = weapon.range || bulletInfo?.range || '-';
    const damage = weapon.damage || '-';
    const corrected = weapon.corrected ? ` (×${weapon.corrected}%)` : '';
    const pierce = bulletInfo?.pierce_count || '-';

    const card = createElement('div', 'weapon-card');
    const header = createElement('div', 'weapon-card-header');
    const title = createElement('div', 'weapon-card-title', showNumber ? `무기 ${index}` : '무기 정보');
    const ammoBadge = createElement('span', 'badge ammo-badge', ammoName);
    ammoBadge.style.background = `var(--ammo-color-${ammoType})`;
    title.append(document.createTextNode(' '), ammoBadge);
    header.append(title, createElement('span', 'weapon-card-id', weaponInfo.weaponId));

    // 장전 cell: computed reload time primary + muted raw reload_max secondary.
    let reloadValue = '-';
    if (reloadSeconds != null) {
        reloadValue = createElement('span');
        reloadValue.append(
            document.createTextNode(`${reloadSeconds.toFixed(2)}s`),
            createElement('span', 'stat-sub', `reload ${weapon.reload_max}`)
        );
    }

    const stats = createElement('div', 'weapon-stats');
    stats.append(
        createStatItem('탄종', bulletTypeName),
        createStatItem('데미지', `${damage}${corrected}`),
        createStatItem('장전', reloadValue),
        createStatItem('사거리', range),
        createStatItem('관통', pierce),
    );

    const damageType = bulletInfo?.damage_type;
    if (Array.isArray(damageType) && damageType.length >= 3) {
        stats.appendChild(buildArmorRow(damageType));
    }

    card.append(header, stats);
    const rows = buildBarrageRows(weapon, weaponInfo, dataStores.barrageData);
    if (rows) card.appendChild(rows);
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
