/**
 * skin.sd.viewer.js
 * SD (chibi) spine animation viewer with equipment skin (orbit) overlay support.
 * Uses PixiJS + pixi-spine to render character and orbit animations side by side or attached.
 * Orbit attachment is driven by a bone binding in the spine skeleton (orbit_ui_bound/orbit_combat_bound).
 * Part of the skin module group.
 */
import { debounce, fetchJSON, resolveUrl, toggleElement } from '../utils.js';

// Maps `displayMode` values to their selector button id, in both directions.
const MODE_TO_BTN = {
    character: 'charOnlyBtn',
    equip: 'equipOnlyBtn',
    both: 'bothBtn',
};
const BTN_TO_MODE = Object.fromEntries(
    Object.entries(MODE_TO_BTN).map(([mode, btnId]) => [btnId, mode])
);

let app, currentSpine, dragTarget;
let multiOrbit = [];
let dragOffset = { x: 0, y: 0 };
let orbitData = {};
let displayMode = 'character';
// Tracked so we can mirror the game's HiddenAttachmentByAction (spinerole.lua:362) —
// orbits listed in orbit_hidden_action hide while the character plays one of those
// animations (e.g. sleep, wash). Reset on every character (re)load.
let currentCharAnimation = null;
// Driven by `skin_on` / `skin_off` spine events on the character animation track,
// matching SpineRole:changeAttachLListVisible (spinerole.lua:346) which forces all
// attachments hidden when `skin_off` fires and re-shows them on `skin_on`.
let orbitsForcedHiddenBySkinEvent = false;
// Monotonically increasing per kind of resource — bumped on every cancel or new
// load so that an in-flight loader resolving against a stale token can self-abort.
let characterLoadToken = 0;
let orbitLoadToken = 0;
let resizeObserver = null;
let resizeFallbackHandler = null;
let lastCanvasWidth = 0;
let lastCanvasHeight = 0;

// DOM refs cached at startup (script runs after body, so DOM is ready).
const statusEl = document.getElementById('status');
const charSelect = document.getElementById('charSelect');
const equipSelect = document.getElementById('equipSelect');
const displayModeBtnsEl = document.getElementById('displayModeBtns');
const displayModeButtons = displayModeBtnsEl.querySelectorAll('button');
const animationControlsEl = document.getElementById('animationControls');
const animationListEl = document.getElementById('animationList');
const skinListEl = document.getElementById('skinList');
const animCountEl = document.getElementById('animCount');
const skinCountEl = document.getElementById('skinCount');
const loopAnimEl = document.getElementById('loopAnim');
const scaleEl = document.getElementById('scale');
const speedEl = document.getElementById('speed');
const scaleValueEl = document.getElementById('scaleValue');
const speedValueEl = document.getElementById('speedValue');
const spineContainer = document.getElementById('spineContainer');

if (typeof PIXI === 'undefined') {
    statusEl.textContent = '오류: PixiJS 라이브러리를 불러오지 못했습니다. 브라우저 콘솔을 확인하세요.';
    statusEl.className = 'status error';
    console.error('PixiJS is not available. Check script tags and network connection.');

} else if (typeof PIXI.spine === 'undefined') {
    statusEl.textContent = '오류: Pixi-Spine 라이브러리를 불러오지 못했습니다. 브라우저 콘솔을 확인하세요.';
    statusEl.className = 'status error';
    console.error('Pixi-Spine is not available. Check script tags and network connection.');

} else {
    initPixi();
    loadInitialData();
}

// ===== Initialization =====

/**
 * Create the PixiJS Application, mount it to the spineContainer div,
 * and register the per-tick updateAttachment callback.
 */
function initPixi() {
    lastCanvasWidth = spineContainer.offsetWidth;
    lastCanvasHeight = spineContainer.offsetHeight;
    app = new PIXI.Application({
        width: lastCanvasWidth,
        height: lastCanvasHeight,
        backgroundColor: 0xffffff,
        antialias: true
    });
    app.stage.sortableChildren = true;
    spineContainer.appendChild(app.view);
    app.ticker.add(updateAttachment);
    setupResizeHandler(spineContainer);
}

function setupResizeHandler(container) {
    const resizeCanvas = debounce(() => {
        if (!app) return;
        const w = container.offsetWidth;
        const h = container.offsetHeight;
        // ResizeObserver fires once on .observe() with the current size — guard so we
        // don't waste a renderer.resize + updateDisplay pass when nothing changed.
        if (!w || !h || (w === lastCanvasWidth && h === lastCanvasHeight)) return;
        lastCanvasWidth = w;
        lastCanvasHeight = h;
        app.renderer.resize(w, h);
        resetCurrentPositions();
        updateDisplay();
    }, 100);

    if ('ResizeObserver' in window) {
        resizeObserver = new ResizeObserver(resizeCanvas);
        resizeObserver.observe(container);
    } else {
        resizeFallbackHandler = resizeCanvas;
        window.addEventListener('resize', resizeFallbackHandler);
    }
}

/**
 * Load sd_data.json (character list) and orbit_data.json (equip skin definitions) in parallel,
 * then populate both dropdowns.
 */
async function loadInitialData() {
    try {
        const [charListData, orbitDataResponse] = await Promise.all([
            fetchJSON('data/skin/sd_data.json'),
            fetchJSON('data/skin/orbit_data.json')
        ]);

        orbitData = orbitDataResponse;

        const charOptions = charListData.map(item => {
            const charId = Object.keys(item)[0];
            const koreanName = item[charId];
            return { value: charId, text: koreanName };
        });

        const orbitOptions = Object.keys(orbitData).map(orbitName => {
            const orbit = orbitData[orbitName];
            const displayName = orbit.name || orbitName;
            return { value: orbitName, text: displayName };
        });

        populateDropdown(charSelect, charOptions, '-- 캐릭터를 선택하세요 --');
        populateDropdown(equipSelect, orbitOptions, '-- 장비 스킨을 선택하세요 --');
        statusEl.textContent = '캐릭터 또는 장비 스킨을 선택하여 애니메이션 보기';

    } catch (error) {
        statusEl.textContent = '오류: 초기 데이터를 불러올 수 없습니다.';
        statusEl.className = 'status error';
        charSelect.disabled = true;
        equipSelect.disabled = true;
        console.error('Error loading initial data:', error);
    }
}

function populateDropdown(selectElement, list, defaultOptionText) {
    if (list.length > 0 && typeof list[0] === 'string') {
        list = list.map(item => ({ value: item, text: item }));
    }

    const fragment = document.createDocumentFragment();
    list.forEach(item => {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.text;
        fragment.appendChild(option);
    });
    selectElement.appendChild(fragment);
    selectElement.firstElementChild.textContent = defaultOptionText;
}

charSelect.addEventListener('change', (e) => {
    const charName = e.target.value;
    if (charName) {
        loadAnimation(charName);
    } else {
        clearCharacter();
        updateDisplay();
    }
});

equipSelect.addEventListener('change', (e) => {
    const equipName = e.target.value;
    if (equipName) {
        loadOrbit(equipName);
    } else {
        clearOrbits();
        updateDisplay();
    }
});

// ===== Spine Loading =====

/**
 * Fetch and parse a spine skeleton from .atlas, .skel, and .png files at basePath.
 * Assembles a PixiJS Spine object ready to add to the stage.
 */
async function loadSpine(basePath) {
    const atlasUrl = `${basePath}.atlas`;
    const skelUrl = `${basePath}.skel`;
    const pngUrl = `${basePath}.png`;

    const [atlasText, skelData, pngTexture] = await Promise.all([
        fetchText(atlasUrl),
        fetchArrayBuffer(skelUrl),
        loadTexture(pngUrl)
    ]);

    const spineAtlas = new PIXI.spine.core.TextureAtlas(atlasText, (path, callback) => {
        callback(pngTexture);
    });

    const atlasLoader = new PIXI.spine.core.AtlasAttachmentLoader(spineAtlas);
    const parser = new PIXI.spine.core.SkeletonBinary(atlasLoader);
    const skeletonData = parser.readSkeletonData(new Uint8Array(skelData));

    return new PIXI.spine.Spine(skeletonData);
}

async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    return response.text();
}

async function fetchArrayBuffer(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    return response.arrayBuffer();
}

function loadTexture(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => resolve(PIXI.BaseTexture.from(img));
        img.onerror = () => reject(new Error(`Failed to load ${url}`));
        img.src = url;
    });
}

/**
 * Load and display a character spine animation; destroy the previous one first.
 * Registers pointer events for drag interaction and plays the first available animation.
 */
async function loadAnimation(charName) {
    const loadToken = ++characterLoadToken;

    try {
        statusEl.textContent = '캐릭터 로딩 중...';
        statusEl.className = 'status';

        destroyCurrentCharacter();

        const basePath = resolveUrl(`assets/sd/${charName}/${charName}`);
        const nextSpine = await loadSpine(basePath);
        if (loadToken !== characterLoadToken) {
            destroySpine(nextSpine);
            return;
        }

        currentSpine = nextSpine;
        currentSpine.x = app.screen.width / 2;
        currentSpine.y = app.screen.height * 0.7;
        makeSpineDraggable(currentSpine);
        attachCharacterEventListener(currentSpine);
        app.stage.addChild(currentSpine);

        const firstAnim = currentSpine.spineData.animations[0]?.name;
        if (firstAnim) {
            playCharacterAnimation(firstAnim, loopAnimEl.checked);
        }

        statusEl.textContent = '✓ 캐릭터를 성공적으로 불러왔습니다!';
        statusEl.className = 'status success';

        // If the user was viewing only equip and we just loaded the first character,
        // reveal them — otherwise stay in whatever mode the user chose.
        if (displayMode === 'equip' && multiOrbit.length === 0) {
            setDisplayMode('character');
        } else {
            updateDisplay();
        }

    } catch (error) {
        if (loadToken !== characterLoadToken) return;
        statusEl.textContent = `캐릭터 로딩 오류: ${error.message}`;
        statusEl.className = 'status error';
        console.error('Full error:', error);
    }
}

/**
 * Load equipment skin (orbit) spine files — orbits can have multiple parts.
 * Picks the best matching animation (orbit_combat > 'normal' > 'stand' > first available).
 */
async function loadOrbit(orbitName) {
    const loadToken = ++orbitLoadToken;

    try {
        statusEl.textContent = '장비 스킨 로딩 중...';
        statusEl.className = 'status';

        destroyCurrentOrbits();

        const orbitInfo = orbitData[orbitName];
        if (!orbitInfo || !Array.isArray(orbitInfo.spine_files) || orbitInfo.spine_files.length === 0) {
            throw new Error('선택한 장비 스킨에 대한 파일 정보가 없습니다.');
        }

        const nextOrbits = [];
        for (const fileName of orbitInfo.spine_files) {
            const basePath = resolveUrl(`assets/orbit/${orbitName}/${fileName}`);
            const newOrbitPart = await loadSpine(basePath);
            if (loadToken !== orbitLoadToken) {
                destroySpine(newOrbitPart);
                nextOrbits.forEach(destroySpine);
                return;
            }

            newOrbitPart.x = app.screen.width / 2;
            newOrbitPart.y = app.screen.height / 2;

            makeSpineDraggable(newOrbitPart);
            nextOrbits.push(newOrbitPart);

            const hasDefaultSkin = newOrbitPart.spineData.skins.some(skin => skin.name === 'default');
            if (hasDefaultSkin) {
                newOrbitPart.skeleton.setSkinByName('default');
            }

            const animsToCheck = [orbitInfo?.orbit_combat, 'normal', 'stand'];
            const availableAnims = newOrbitPart.spineData.animations.map(a => a.name);

            let animToPlay = null;
            for (const animName of animsToCheck) {
                if (animName && availableAnims.includes(animName)) {
                    animToPlay = animName;
                    break;
                }
            }
            if (!animToPlay && availableAnims.length > 0) {
                animToPlay = availableAnims[0];
            }
            if (animToPlay) {
                newOrbitPart.state.setAnimation(0, animToPlay, true);
            }
        }

        nextOrbits.forEach(orbit => app.stage.addChild(orbit));
        multiOrbit = nextOrbits;

        statusEl.textContent = '✓ 장비 스킨을 성공적으로 불러왔습니다!';
        statusEl.className = 'status success';

        if (displayMode === 'character' && !currentSpine) {
            setDisplayMode('equip');
        } else {
            updateDisplay();
        }

    } catch (error) {
        if (loadToken !== orbitLoadToken) return;
        statusEl.textContent = `장비 스킨 로딩 오류: ${error.message}`;
        statusEl.className = 'status error';
        console.error('Error loading orbit skin:', error);
    }
}

function updateDisplay() {
    if (currentSpine) currentSpine.visible = (displayMode === 'character' || displayMode === 'both');

    // In 'both' mode, orbits hide when the character is playing an animation
    // listed in orbit_hidden_action, or when a skin_off event has fired.
    // In 'equip' mode they always show (no character to gate on).
    const orbitVisibleByMode = (displayMode === 'equip' || displayMode === 'both');
    const orbitHiddenByAction = displayMode === 'both' && isOrbitHiddenByCharAction();
    const orbitsVisible = orbitVisibleByMode && !orbitHiddenByAction;

    multiOrbit.forEach(orbit => {
        orbit.visible = orbitsVisible;
        if (displayMode === 'equip') {
            orbit.x = app.screen.width / 2;
            orbit.y = app.screen.height / 2;
        }
    });

    let listSource = null;
    if ((displayMode === 'character' || displayMode === 'both') && currentSpine) {
        listSource = currentSpine;
    } else if (displayMode === 'equip' && multiOrbit[0]) {
        listSource = multiOrbit[0];
    }
    renderAnimationList(listSource);
    renderSkinList(listSource);

    toggleElement(animationControlsEl, Boolean(currentSpine || multiOrbit[0]));

    if (displayMode === 'both') {
        applyAttachmentLayering();
        updateAttachment();
    }
}

function isOrbitHiddenByCharAction() {
    if (orbitsForcedHiddenBySkinEvent) return true;
    if (!equipSelect.value || !currentCharAnimation) return false;
    const hiddenActions = orbitData[equipSelect.value]?.orbit_hidden_action;
    return Array.isArray(hiddenActions) && hiddenActions.includes(currentCharAnimation);
}

/**
 * Plays an animation on the character spine, tracks the current animation name, and
 * re-evaluates orbit visibility (orbit_hidden_action). Mirrors SetAction in spinerole.lua.
 */
function playCharacterAnimation(animationName, loop) {
    if (!currentSpine) return;
    currentSpine.state.setAnimation(0, animationName, loop);
    currentCharAnimation = animationName;
    // skin_off persistence is per-animation in-game; clear it whenever a new
    // animation starts so a fresh play doesn't inherit the previous track's flag.
    orbitsForcedHiddenBySkinEvent = false;
    updateDisplay();
}

/**
 * Spine animation tracks emit named events (e.g. skin_on / skin_off). The game uses
 * these to toggle attachment visibility mid-animation; we replicate that here.
 */
function attachCharacterEventListener(spine) {
    spine.state.addListener({
        event: (entry, event) => {
            const name = event?.data?.name;
            if (name === 'skin_on') {
                orbitsForcedHiddenBySkinEvent = false;
                updateDisplay();
            } else if (name === 'skin_off') {
                orbitsForcedHiddenBySkinEvent = true;
                updateDisplay();
            }
        },
    });
}

function destroySpine(spine) {
    if (!spine) return;
    if (app?.stage && spine.parent === app.stage) {
        app.stage.removeChild(spine);
    }
    spine.destroy({ children: true, texture: true, baseTexture: true });
}

function destroyCurrentCharacter() {
    if (dragTarget === currentSpine) dragTarget = null;
    destroySpine(currentSpine);
    currentSpine = null;
    currentCharAnimation = null;
    orbitsForcedHiddenBySkinEvent = false;
}

function destroyCurrentOrbits() {
    multiOrbit.forEach(orbit => {
        if (dragTarget === orbit) dragTarget = null;
        destroySpine(orbit);
    });
    multiOrbit = [];
}

function clearCharacter() {
    characterLoadToken++;
    destroyCurrentCharacter();
}

function clearOrbits() {
    orbitLoadToken++;
    destroyCurrentOrbits();
}

function resetCurrentPositions() {
    if (!app) return;
    if (currentSpine) {
        currentSpine.x = app.screen.width / 2;
        currentSpine.y = app.screen.height * 0.7;
    }
    multiOrbit.forEach(orbit => {
        orbit.x = app.screen.width / 2;
        orbit.y = app.screen.height / 2;
    });
}

function makeSpineDraggable(spine) {
    spine.interactive = true;
    spine.buttonMode = true;
    spine.cursor = 'pointer';
    spine.on('pointerdown', onDragStart);
    spine.on('pointerup', onDragEnd);
    spine.on('pointerupoutside', onDragEnd);
    spine.on('pointermove', onDragMove);
}

// ===== Attachment & Display =====

/**
 * Per-tick callback. Positions orbit parts relative to a named bone on the character.
 * No-ops cheaply when displayMode is not 'both' or no bone binding is configured.
 * Static layering (zIndex + sortChildren) is handled separately in applyAttachmentLayering.
 */
function updateAttachment() {
    if (displayMode !== 'both' || !currentSpine || multiOrbit.length === 0 || !equipSelect.value) {
        return;
    }

    const orbitInfo = orbitData[equipSelect.value];
    const boundInfo = orbitInfo?.orbit_ui_bound || orbitInfo?.orbit_combat_bound;

    if (!boundInfo) {
        multiOrbit.forEach(orbit => {
            orbit.x = app.screen.width / 2;
            orbit.y = app.screen.height / 2;
        });
        return;
    }

    const [boneName, offset] = boundInfo;
    const bone = currentSpine.skeleton.findBone(boneName);
    if (!bone) return;

    const scale = currentSpine.scale.x;
    const offsetX = offset[0] || 0;
    const offsetY = offset[1] || 0;

    multiOrbit.forEach(orbit => {
        orbit.x = currentSpine.x + (bone.worldX + offsetX) * scale;
        orbit.y = currentSpine.y + (bone.worldY + offsetY) * scale;
    });
}

/**
 * Apply zIndex + sortChildren once when entering 'both' mode or when orbits change.
 * Kept out of updateAttachment so the per-frame ticker doesn't re-sort the stage.
 */
function applyAttachmentLayering() {
    if (!app || !currentSpine || multiOrbit.length === 0) return;
    const orbitInfo = orbitData[equipSelect.value];
    if (!orbitInfo) return;
    const zIndex = orbitInfo.orbit_ui_back === 1 ? -1 : 1;
    multiOrbit.forEach(orbit => { orbit.zIndex = zIndex; });
    multiOrbit.forEach(orbit => orbit.scale.set(currentSpine.scale.x));
    currentSpine.zIndex = 0;
    app.stage.sortChildren();
}

displayModeBtnsEl.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    const mode = BTN_TO_MODE[e.target.id];
    if (mode) setDisplayMode(mode);
});

function setDisplayMode(mode) {
    displayMode = mode;
    const activeButtonId = MODE_TO_BTN[mode];

    displayModeButtons.forEach(btn => {
        const isActive = btn.id === activeButtonId;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });

    updateDisplay();
}

function renderAnimationList(spine) {
    renderSelectableList({
        container: animationListEl,
        countEl: animCountEl,
        itemClass: 'animation-item',
        items: spine?.spineData.animations,
        getName: a => a.name,
        ariaLabelEmpty: '선택 가능한 애니메이션 없음',
        ariaLabelTemplate: n => `${n}개 애니메이션`,
        onSelect: (anim) => {
            // Route character plays through playCharacterAnimation so orbit
            // hidden_action stays in sync. Orbit-track plays go direct.
            if (spine === currentSpine) {
                playCharacterAnimation(anim.name, loopAnimEl.checked);
            } else {
                spine.state.setAnimation(0, anim.name, loopAnimEl.checked);
            }
        },
    });
}

function renderSkinList(spine) {
    renderSelectableList({
        container: skinListEl,
        countEl: skinCountEl,
        itemClass: 'skin-item',
        items: spine?.spineData.skins,
        getName: s => s.name,
        ariaLabelEmpty: '선택 가능한 스킨 없음',
        ariaLabelTemplate: n => `${n}개 스킨`,
        onSelect: (skin) => {
            spine.skeleton.setSkinByName(skin.name);
            spine.skeleton.setSlotsToSetupPose();
        },
    });
}

function renderSelectableList({ container, countEl, itemClass, items, getName, ariaLabelEmpty, ariaLabelTemplate, onSelect }) {
    container.innerHTML = '';
    if (!items || items.length === 0) {
        countEl.textContent = '0';
        container.setAttribute('aria-label', ariaLabelEmpty);
        return;
    }

    countEl.textContent = items.length;
    container.setAttribute('aria-label', ariaLabelTemplate(items.length));

    const fragment = document.createDocumentFragment();
    const buttons = items.map((item, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = itemClass + (i === 0 ? ' active' : '');
        btn.textContent = getName(item);
        btn.setAttribute('aria-pressed', String(i === 0));
        fragment.appendChild(btn);
        return btn;
    });

    buttons.forEach((btn, i) => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-pressed', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
            onSelect(items[i], btn);
        });
    });

    container.appendChild(fragment);
}

// ===== Drag Functions =====

function onDragStart(e) {
    dragTarget = e.currentTarget;
    // PixiJS v5 dispatches a legacy InteractionEvent — the pointer position lives
    // on e.data.global (e.global only exists in v7+ federated events).
    const pos = e.data.global;
    dragOffset.x = pos.x - dragTarget.x;
    dragOffset.y = pos.y - dragTarget.y;
}

function onDragMove(e) {
    if (!dragTarget) return;
    const pos = e.data.global;
    const newX = pos.x - dragOffset.x;
    const newY = pos.y - dragOffset.y;

    if (multiOrbit.includes(dragTarget)) {
        // Orbit parts are independent spine objects but visually one unit; move them as a group.
        const deltaX = newX - dragTarget.x;
        const deltaY = newY - dragTarget.y;
        multiOrbit.forEach(orbit => {
            orbit.x += deltaX;
            orbit.y += deltaY;
        });
    } else {
        dragTarget.x = newX;
        dragTarget.y = newY;
    }
}

function onDragEnd() {
    dragTarget = null;
}

// ===== Controls =====

scaleEl.addEventListener('input', (e) => {
    const val = e.target.value;
    scaleValueEl.textContent = val;
    const scale = val / 100;
    if (currentSpine) currentSpine.scale.set(scale);
    multiOrbit.forEach(orbit => orbit.scale.set(scale));
});

speedEl.addEventListener('input', (e) => {
    const val = e.target.value;
    speedValueEl.textContent = val;
    const timeScale = val / 100;
    if (currentSpine) currentSpine.state.timeScale = timeScale;
    multiOrbit.forEach(orbit => orbit.state.timeScale = timeScale);
});

document.getElementById('playBtn').addEventListener('click', () => {
    const timeScale = speedEl.value / 100;
    if (currentSpine) currentSpine.state.timeScale = timeScale;
    multiOrbit.forEach(orbit => orbit.state.timeScale = timeScale);
});

document.getElementById('pauseBtn').addEventListener('click', () => {
    if (currentSpine) currentSpine.state.timeScale = 0;
    multiOrbit.forEach(orbit => orbit.state.timeScale = 0);
});

document.getElementById('resetBtn').addEventListener('click', () => {
    resetCurrentPositions();
    if (currentSpine) currentSpine.scale.set(1);
    multiOrbit.forEach(orbit => orbit.scale.set(1));
    scaleEl.value = 100;
    scaleValueEl.textContent = 100;
});

// pagehide is more reliable than beforeunload (fires on bfcache evict and on mobile close);
// we only release the ResizeObserver and resize listener — the browser reclaims the WebGL
// context on its own and a heavy app.destroy() here would block bfcache eligibility.
window.addEventListener('pagehide', () => {
    if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
    }
    if (resizeFallbackHandler) {
        window.removeEventListener('resize', resizeFallbackHandler);
        resizeFallbackHandler = null;
    }
});
