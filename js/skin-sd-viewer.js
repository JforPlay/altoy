let app, currentSpine, dragTarget;
let multiOrbit = []; // Use an array to hold all parts of an orbit
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let orbitData;
let displayMode = 'character'; // character, equip, both

const statusEl = document.getElementById('status');
const charSelect = document.getElementById('charSelect');
const equipSelect = document.getElementById('equipSelect');

// Check if libraries loaded and initialize
if (typeof PIXI === 'undefined') {
    statusEl.textContent = '오류: PixiJS 라이브러리를 불러오지 못했습니다. 브라우저 콘솔을 확인하세요.';
    statusEl.className = 'status error';
    console.error('PixiJS is not available. Check script tags and network connection.');

} else if (typeof PIXI.spine === 'undefined') {
    statusEl.textContent = '오류: Pixi-Spine 라이브러리를 불러오지 못했습니다. 브라우저 콘솔을 확인하세요.';
    statusEl.className = 'status error';
    console.error('Pixi-Spine is not available. Check script tags and network connection.');

} else {
    console.log('✅ Libraries loaded, initializing Pixi...');
    initPixi();
    loadInitialData();
}

// Initialize PixiJS
function initPixi() {
    const container = document.getElementById('spineContainer');
    app = new PIXI.Application({
        width: container.offsetWidth,
        height: container.offsetHeight,
        backgroundColor: 0xffffff,
        antialias: true
    });
    container.appendChild(app.view);
    app.ticker.add(updateAttachment);
}

// Load all necessary data
async function loadInitialData() {
    try {
        const [charListData, orbitDataResponse] = await Promise.all([
            fetch('data/sd_list.json').then(res => res.json()),
            fetch('data/orbit_data.json').then(res => res.json())
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

    } catch (error) {
        statusEl.textContent = '오류: 초기 데이터를 불러올 수 없습니다.';
        statusEl.className = 'status error';
        console.error('Error loading initial data:', error);
    }
}
function populateDropdown(selectElement, list, defaultOptionText) {
    if (list.length > 0 && typeof list[0] === 'string') {
        list = list.map(item => ({ value: item, text: item }));
    }

    list.forEach(item => {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.text;
        selectElement.appendChild(option);
    });
    selectElement.firstElementChild.textContent = defaultOptionText;
}

charSelect.addEventListener('change', (e) => {
    const charName = e.target.value;
    if (charName) loadAnimation(charName);
});

equipSelect.addEventListener('change', (e) => {
    const equipName = e.target.value;
    if (equipName) loadOrbit(equipName);
});

async function loadSpine(basePath) {
    const atlasUrl = `${basePath}.atlas`;
    const skelUrl = `${basePath}.skel`;
    const pngUrl = `${basePath}.png`;

    const [atlasText, skelData, pngTexture] = await Promise.all([
        fetch(atlasUrl).then(res => res.text()),
        fetch(skelUrl).then(res => res.arrayBuffer()),
        new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => resolve(PIXI.BaseTexture.from(img));
            img.onerror = reject;
            img.src = pngUrl;
        })
    ]);

    const spineAtlas = new PIXI.spine.core.TextureAtlas(atlasText, (path, callback) => {
        callback(pngTexture);
    });

    const atlasLoader = new PIXI.spine.core.AtlasAttachmentLoader(spineAtlas);
    const parser = new PIXI.spine.core.SkeletonBinary(atlasLoader);
    const skeletonData = parser.readSkeletonData(new Uint8Array(skelData));

    return new PIXI.spine.Spine(skeletonData);
}

async function loadAnimation(charName) {
    try {
        statusEl.textContent = '캐릭터 로딩 중...';
        statusEl.className = 'status';

        if (currentSpine) {
            app.stage.removeChild(currentSpine);
            currentSpine.destroy({ children: true, texture: true, baseTexture: true });
            currentSpine = null;
        }

        const basePath = `assets/sd/${charName}/${charName}`;
        currentSpine = await loadSpine(basePath);

        currentSpine.x = app.screen.width / 2;
        currentSpine.y = app.screen.height * 0.7;

        currentSpine.eventMode = 'static';
        currentSpine.cursor = 'pointer';
        currentSpine.on('pointerdown', onDragStart);
        currentSpine.on('pointerup', onDragEnd);
        currentSpine.on('pointerupoutside', onDragEnd);
        currentSpine.on('pointermove', onDragMove);

        app.stage.addChild(currentSpine);

        loadAnimationList(currentSpine);
        loadSkinList(currentSpine);

        if (currentSpine.state.data.skeletonData.animations.length > 0) {
            const firstAnim = currentSpine.state.data.skeletonData.animations[0].name;
            currentSpine.state.setAnimation(0, firstAnim, document.getElementById('loopAnim').checked);
        }

        document.getElementById('animationControls').style.display = 'block';
        statusEl.textContent = '✓ 캐릭터를 성공적으로 불러왔습니다!';
        statusEl.className = 'status success';

        updateDisplay();

    } catch (error) {
        statusEl.textContent = `캐릭터 로딩 오류: ${error.message}`;
        statusEl.className = 'status error';
        console.error('Full error:', error);
    }
}

async function loadOrbit(orbitName) {
    try {
        statusEl.textContent = '장비 스킨 로딩 중...';
        statusEl.className = 'status';

        // Clear old orbits
        multiOrbit.forEach(orbit => {
            app.stage.removeChild(orbit);
            orbit.destroy({ children: true, texture: true, baseTexture: true });
        });
        multiOrbit = [];

        const orbitInfo = orbitData[orbitName];
        if (!orbitInfo || !orbitInfo.spine_files) {
            throw new Error('선택한 장비 스킨에 대한 파일 정보가 없습니다.');
        }

        for (const fileName of orbitInfo.spine_files) {
            const basePath = `assets/orbit/${orbitName}/${fileName}`;
            const newOrbitPart = await loadSpine(basePath);

            newOrbitPart.x = app.screen.width / 2;
            newOrbitPart.y = app.screen.height / 2;

            newOrbitPart.eventMode = 'static';
            newOrbitPart.cursor = 'pointer';
            newOrbitPart.on('pointerdown', onDragStart);
            newOrbitPart.on('pointerup', onDragEnd);
            newOrbitPart.on('pointerupoutside', onDragEnd);
            newOrbitPart.on('pointermove', onDragMove);

            app.stage.addChild(newOrbitPart);
            multiOrbit.push(newOrbitPart);

            // Set skin
            const hasDefaultSkin = newOrbitPart.spineData.skins.some(skin => skin.name === 'default');
            if (hasDefaultSkin) {
                newOrbitPart.skeleton.setSkinByName('default');
            }

            // Set animation
            let animToPlay = null;
            const animsToCheck = [orbitInfo?.orbit_combat, 'normal', 'stand'];
            const availableAnims = newOrbitPart.spineData.animations.map(a => a.name);

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

        statusEl.textContent = '✓ 장비 스킨을 성공적으로 불러왔습니다!';
        statusEl.className = 'status success';

        updateDisplay();

    } catch (error) {
        statusEl.textContent = `장비 스킨 로딩 오류: ${error.message}`;
        statusEl.className = 'status error';
        console.error('Error loading orbit skin:', error);
    }
}

function updateDisplay() {
    if (currentSpine) currentSpine.visible = (displayMode === 'character' || displayMode === 'both');

    multiOrbit.forEach(orbit => {
        orbit.visible = (displayMode === 'equip' || displayMode === 'both');
        if (displayMode === 'equip') {
            orbit.x = app.screen.width / 2;
            orbit.y = app.screen.height / 2;
        }
    });

    if (displayMode === 'character' || displayMode === 'both') {
        loadAnimationList(currentSpine);
        loadSkinList(currentSpine);
    } else if (displayMode === 'equip') {
        loadAnimationList(multiOrbit[0]);
        loadSkinList(multiOrbit[0]);
    } else {
        loadAnimationList(null);
        loadSkinList(null);
    }

    if (displayMode === 'both') {
        updateAttachment();
    }
}

function updateAttachment() {
    if (displayMode !== 'both' || !currentSpine || multiOrbit.length === 0 || !equipSelect.value) {
        return;
    }

    const orbitName = equipSelect.value;
    const orbitInfo = orbitData[orbitName];

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

    if (bone) {
        const scale = currentSpine.scale.x;
        const zIndex = orbitInfo.orbit_ui_back === 1 ? -1 : 1;
        
        multiOrbit.forEach(orbit => {
            const offsetX = (offset[0] || 0);
            const offsetY = (offset[1] || 0);
            
            orbit.x = currentSpine.x + (bone.worldX + offsetX) * scale;
            orbit.y = currentSpine.y + (bone.worldY + offsetY) * scale; // Negate both bone and offset
            
            orbit.scale.set(scale);
            orbit.zIndex = zIndex;
        });

        currentSpine.zIndex = 0;
        app.stage.sortChildren();
    }
}

document.getElementById('displayModeBtns').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
        document.querySelectorAll('#displayModeBtns button').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');

        if (e.target.id === 'charOnlyBtn') displayMode = 'character';
        else if (e.target.id === 'equipOnlyBtn') displayMode = 'equip';
        else if (e.target.id === 'bothBtn') displayMode = 'both';

        updateDisplay();
    }
});

function loadAnimationList(spine) {
    const list = document.getElementById('animationList');
    list.innerHTML = '';
    if (!spine) return;

    const animations = spine.spineData.animations;
    document.getElementById('animCount').textContent = animations.length;

    animations.forEach((anim, i) => {
        const item = document.createElement('div');
        item.className = 'animation-item' + (i === 0 ? ' active' : '');
        item.textContent = anim.name;
        item.onclick = () => {
            document.querySelectorAll('.animation-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            const loop = document.getElementById('loopAnim').checked;
            spine.state.setAnimation(0, anim.name, loop);
        };
        list.appendChild(item);
    });
}

function loadSkinList(spine) {
    const list = document.getElementById('skinList');
    list.innerHTML = '';
    if (!spine) return;

    const skins = spine.spineData.skins;
    document.getElementById('skinCount').textContent = skins.length;

    skins.forEach((skin, i) => {
        const item = document.createElement('div');
        item.className = 'skin-item' + (i === 0 ? ' active' : '');
        item.textContent = skin.name;
        item.onclick = () => {
            document.querySelectorAll('.skin-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            spine.skeleton.setSkinByName(skin.name);
            spine.skeleton.setSlotsToSetupPose();
        };
        list.appendChild(item);
    });
}

// DRAG FUNCTIONS
function onDragStart(e) {
    dragTarget = e.currentTarget;
    isDragging = true;
    const pos = e.global;
    dragOffset.x = pos.x - dragTarget.x;
    dragOffset.y = pos.y - dragTarget.y;
}

function onDragMove(e) {
    if (isDragging && dragTarget) {
        const pos = e.global;
        const newX = pos.x - dragOffset.x;
        const newY = pos.y - dragOffset.y;

        const deltaX = newX - dragTarget.x;
        const deltaY = newY - dragTarget.y;

        if (multiOrbit.includes(dragTarget)) {
            // If dragging one part of a multi-orbit, move all parts
            multiOrbit.forEach(orbit => {
                orbit.x += deltaX;
                orbit.y += deltaY;
            });
        } else {
            dragTarget.x = newX;
            dragTarget.y = newY;
        }
    }
}

function onDragEnd(e) {
    isDragging = false;
    dragTarget = null;
}

// In console, run this to see all bones:
window.inspectBones = function() {
    if (!currentSpine) return;
    const bones = currentSpine.skeleton.bones;
    bones.forEach(b => {
        console.log(`Bone: ${b.data.name}, worldX: ${b.worldX.toFixed(1)}, worldY: ${b.worldY.toFixed(1)}`);
    });
}

// Controls
document.getElementById('scale').addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('scaleValue').textContent = val;
    const scale = val / 100;
    if (currentSpine) currentSpine.scale.set(scale);
    multiOrbit.forEach(orbit => orbit.scale.set(scale));
});

document.getElementById('speed').addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('speedValue').textContent = val;
    const timeScale = val / 100;
    if (currentSpine) currentSpine.state.timeScale = timeScale;
    multiOrbit.forEach(orbit => orbit.state.timeScale = timeScale);
});

document.getElementById('playBtn').addEventListener('click', () => {
    const timeScale = document.getElementById('speed').value / 100;
    if (currentSpine) currentSpine.state.timeScale = timeScale;
    multiOrbit.forEach(orbit => orbit.state.timeScale = timeScale);
});

document.getElementById('pauseBtn').addEventListener('click', () => {
    if (currentSpine) currentSpine.state.timeScale = 0;
    multiOrbit.forEach(orbit => orbit.state.timeScale = 0);
});

document.getElementById('resetBtn').addEventListener('click', () => {
    if (currentSpine && app) {
        currentSpine.x = app.screen.width / 2;
        currentSpine.y = app.screen.height * 0.7;
        currentSpine.scale.set(1);
    }
    multiOrbit.forEach(orbit => {
        if (app) {
            orbit.x = app.screen.width / 2;
            orbit.y = app.screen.height / 2;
            orbit.scale.set(1);
        }
    });
    document.getElementById('scale').value = 100;
    document.getElementById('scaleValue').textContent = 100;
});