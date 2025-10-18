/**
 * Live2D Character Viewer
 * Supports multiple characters from assets/ folder
 */

// Configuration
const CONFIG = {
    assetsPath: './assets/live2d/',
    modelExtension: '.model3.json',
    defaultScale: 1.0,
    canvasSize: { width: 800, height: 800 }
};

// Global state
const state = {
    app: null,
    model: null,
    currentCharacter: null,
    currentMotion: null,
    autoBreath: true,
    availableCharacters: [],
    availableAnimations: [],
    modelData: null,
    dragging: null,
    lastUpdate: Date.now()
};

// DOM Elements
const elements = {
    status: null,
    canvas: null,
    characterSelect: null,
    animationSelect: null,
    playBtn: null,
    resetBtn: null,
    breathBtn: null,
    reloadBtn: null
};

/**
 * Initialize the application
 */
async function init() {
    try {
        // Get DOM elements
        elements.status = document.getElementById('status');
        elements.canvas = document.getElementById('live2d-canvas');
        elements.characterSelect = document.getElementById('character-select');
        elements.animationSelect = document.getElementById('animation-select');
        elements.playBtn = document.getElementById('play-btn');
        elements.resetBtn = document.getElementById('reset-btn');
        elements.breathBtn = document.getElementById('breath-btn');
        elements.reloadBtn = document.getElementById('reload-btn');

        updateStatus('Verifying libraries...', 'loading');

        // Verify PIXI is loaded
        if (typeof PIXI === 'undefined') {
            throw new Error('PIXI.js not loaded. Please check your script tags.');
        }
        console.log('✓ PIXI.js loaded, version:', PIXI.VERSION);

        // Verify Cubism Core is loaded
        if (typeof Live2DCubismCore === 'undefined') {
            throw new Error('Live2D Cubism Core not loaded. Please check your script tags.');
        }
        console.log('✓ Live2D Cubism Core loaded');

        // Wait for PIXI.live2d to be available (may load asynchronously)
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds max
        
        while (typeof PIXI.live2d === 'undefined' && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }

        if (typeof PIXI.live2d === 'undefined') {
            console.error('PIXI object:', PIXI);
            console.error('Available PIXI properties:', Object.keys(PIXI));
            throw new Error('PIXI Live2D plugin not loaded after waiting. The library may have failed to load from CDN.');
        }

        console.log('✓ PIXI Live2D Display plugin loaded');
        console.log('Available Live2D properties:', Object.keys(PIXI.live2d));

        // Check for Live2DModel - the API might be different
        const hasLive2DModel = PIXI.live2d.Live2DModel !== undefined;
        console.log('Has Live2DModel class:', hasLive2DModel);
        
        if (!hasLive2DModel) {
            console.warn('Live2DModel not found, checking for alternative APIs...');
            // Some versions expose it differently
            if (window.PIXI.Live2DModel) {
                PIXI.live2d.Live2DModel = window.PIXI.Live2DModel;
                console.log('✓ Found Live2DModel at alternate location');
            }
        }

        updateStatus('Initializing PIXI Application...', 'loading');

        // Create PIXI Application
        state.app = new PIXI.Application({
            view: elements.canvas,
            autoStart: true,
            backgroundAlpha: 0,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
            resizeTo: document.getElementById('canvas-container')
        });

        // Start render loop
        state.app.ticker.add(update);

        // Setup event listeners
        setupEventListeners();

        // Scan for available characters
        await scanCharacters();

        updateStatus('로딩 완료! 스킨을 선택해서 시작해주세요.', 'ready');

    } catch (error) {
        updateStatus(`Initialization Error: ${error.message}`, 'error');
        console.error('Initialization error:', error);
        console.error('Stack:', error.stack);
    }
}

/**
 * Scan the assets folder for available characters
 */
async function scanCharacters() {
    updateStatus('Scanning for characters...', 'loading');

    // List of known characters (you can expand this)
    const knownCharacters = [
        'ankeleiqi_2',
        'suweiaitongmeng_3',
        'zhala_2',
        'jian_3'
        // Add more character folder names here
    ];

    state.availableCharacters = [];

    for (const charName of knownCharacters) {
        const modelPath = `${CONFIG.assetsPath}${charName}/${charName}${CONFIG.modelExtension}`;
        
        try {
            // Try to fetch the model file to check if it exists
            const response = await fetch(modelPath, { method: 'HEAD' });
            if (response.ok) {
                state.availableCharacters.push({
                    name: charName,
                    displayName: formatCharacterName(charName),
                    path: modelPath
                });
            }
        } catch (e) {
            console.log(`Character ${charName} not found, skipping...`);
        }
    }

    // Populate character dropdown
    populateCharacterSelect();
}

/**
 * Format character name for display
 */
function formatCharacterName(name) {
    return name
        .replace(/_/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Populate character selection dropdown
 */
function populateCharacterSelect() {
    elements.characterSelect.innerHTML = '<option value="">스킨을 선택해주세요...</option>';

    state.availableCharacters.forEach(char => {
        const option = document.createElement('option');
        option.value = char.name;
        option.textContent = char.displayName;
        elements.characterSelect.appendChild(option);
    });

    if (state.availableCharacters.length === 0) {
        updateStatus('발견된 스킨데이터가 없습니다.', 'error');
    }
}

/**
 * Load a character model
 */
async function loadCharacter(characterName) {
    if (!characterName) return;

    try {
        updateStatus(`${formatCharacterName(characterName)} 로딩 중...`, 'loading');

        // Clear existing model
        if (state.model) {
            state.app.stage.removeChild(state.model);
            state.model.destroy();
            state.model = null;
        }

        const character = state.availableCharacters.find(c => c.name === characterName);
        if (!character) {
            throw new Error(`Character ${characterName} not found`);
        }

        console.log('Loading model from:', character.path);

        // Try to load using the available API
        let modelClass = PIXI.live2d?.Live2DModel || window.PIXI?.Live2DModel;
        
        if (!modelClass) {
            throw new Error('Live2DModel class not found. Check console for available API.');
        }

        // Load model
        state.model = await modelClass.from(character.path, {
            autoInteract: false,
            autoUpdate: true
        });

        console.log('Model loaded successfully:', state.model);

        // Setup model
        setupModel(state.model);

        // Load model configuration for animations list
        const modelConfig = await fetch(character.path).then(r => r.json());
        state.modelData = modelConfig;
        state.currentCharacter = characterName;

        // Extract available animations
        extractAnimations(modelConfig);

        // Enable controls
        enableControls(true);

        updateStatus(`${character.displayName} 로드 성공!`, 'ready');

    } catch (error) {
        updateStatus(`Error loading character: ${error.message}`, 'error');
        console.error('Load error:', error);
        console.error('Error stack:', error.stack);
        enableControls(false);
    }
}

/**
 * Create Live2D model manually (fallback method)
 */
async function createLive2DModel(modelPath, modelJson, characterName) {
    const basePath = modelPath.substring(0, modelPath.lastIndexOf('/') + 1);
    
    // This is a placeholder for manual model creation
    // You'll need to adapt this based on your specific SDK version
    console.log('Manual model loading not fully implemented');
    console.log('Model path:', basePath);
    console.log('Model data:', modelJson);
    
    // Return null for now - you'll implement based on your SDK docs
    return null;
}

/**
 * Extract available animations from model config
 */
function extractAnimations(modelConfig) {
    state.availableAnimations = [];

    if (modelConfig.FileReferences && modelConfig.FileReferences.Motions) {
        // Get all motion groups
        for (const groupName in modelConfig.FileReferences.Motions) {
            const motions = modelConfig.FileReferences.Motions[groupName];
            motions.forEach((motion, index) => {
                const fileName = motion.File.split('/').pop().replace('.motion3.json', '');
                state.availableAnimations.push({
                    name: fileName,
                    group: groupName,
                    index: index,
                    file: motion.File
                });
            });
        }
    }

    console.log('Extracted animations:', state.availableAnimations);
    populateAnimationSelect();
}

/**
 * Populate animation selection dropdown
 */
function populateAnimationSelect() {
    elements.animationSelect.innerHTML = '';

    if (state.availableAnimations.length === 0) {
        elements.animationSelect.innerHTML = '<option value="">No animations found</option>';
        return;
    }

    state.availableAnimations.forEach((anim, idx) => {
        const option = document.createElement('option');
        option.value = idx;
        option.textContent = formatAnimationName(anim.name);
        elements.animationSelect.appendChild(option);
    });
}

/**
 * Format animation name for display
 */
function formatAnimationName(name) {
    return name
        .replace(/_/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Play selected animation
 */
async function playSelectedAnimation() {
    const selectedIndex = parseInt(elements.animationSelect.value);
    if (isNaN(selectedIndex) || !state.model) return;

    const animation = state.availableAnimations[selectedIndex];
    if (!animation) return;

    updateStatus(`지금 재생중인 모션: ${formatAnimationName(animation.name)}`, 'info');
    
    try {
        console.log('Attempting to play motion:', animation);
        console.log('Model internal structure:', state.model.internalModel);
        
        // Try different motion playback methods
        if (state.model.motion) {
            // Method 1: Using group name and index
            const result = await state.model.motion(animation.group, animation.index, 3);
            console.log('Motion playback result:', result);
        } else if (state.model.internalModel && state.model.internalModel.motionManager) {
            // Method 2: Direct motion manager access
            const motionManager = state.model.internalModel.motionManager;
            console.log('Motion manager groups:', motionManager.groups);
            
            if (motionManager.startMotion) {
                const result = await motionManager.startMotion(animation.group, animation.index, 3);
                console.log('Motion manager result:', result);
            }
        }
        
        state.currentMotion = animation.name;
        
    } catch (error) {
        console.error('Error playing animation:', error);
        console.error('Stack:', error.stack);
        updateStatus(`모션 재생 실패: ${error.message}`, 'error');
    }
}

/**
 * Reset character pose
 */
function resetPose() {
    if (!state.model) return;
    
    updateStatus('초기화 중...', 'info');
    
    try {
        // Stop all motions
        if (state.model.internalModel && state.model.internalModel.motionManager) {
            state.model.internalModel.motionManager.stopAllMotions();
        }
        
        // Play idle animation if available
        const idleAnim = state.availableAnimations.find(a => 
            a.name.toLowerCase().includes('idle') || 
            a.name.toLowerCase().includes('wait') ||
            a.group.toLowerCase() === 'idle'
        );
        
        if (idleAnim) {
            state.model.motion(idleAnim.group, idleAnim.index, 2);
        }
    } catch (error) {
        console.error('Error resetting pose:', error);
    }
}

/**
 * Toggle auto breath
 */
function toggleAutoBreath() {
    state.autoBreath = !state.autoBreath;
    elements.breathBtn.textContent = `Auto Breath: ${state.autoBreath ? 'ON' : 'OFF'}`;
    updateStatus(`자동 재생 ${state.autoBreath ? 'enabled' : 'disabled'}`, 'info');
    
    // Apply to model
    if (state.model) {
        if (state.model.internalModel && state.model.internalModel.breathEnable !== undefined) {
            state.model.internalModel.breathEnable = state.autoBreath;
        }
        // Alternative breath control
        if (state.model.breath !== undefined) {
            state.model.breath = state.autoBreath;
        }
    }
}

/**
 * Reload current character
 */
function reloadCharacter() {
    if (state.currentCharacter) {
        loadCharacter(state.currentCharacter);
    }
}

/**
 * Enable/disable controls
 */
function enableControls(enabled) {
    elements.animationSelect.disabled = !enabled;
    elements.playBtn.disabled = !enabled;
    elements.resetBtn.disabled = !enabled;
    elements.breathBtn.disabled = !enabled;
    elements.reloadBtn.disabled = !enabled;
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Character selection
    elements.characterSelect.addEventListener('change', (e) => {
        loadCharacter(e.target.value);
    });

    // Window resize
    window.addEventListener('resize', handleResize);

    // Canvas interactions (for future drag/touch implementation)
    elements.canvas.addEventListener('mousedown', handleCanvasMouseDown);
    elements.canvas.addEventListener('mousemove', handleCanvasMouseMove);
    elements.canvas.addEventListener('mouseup', handleCanvasMouseUp);
}

/**
 * Handle window resize
 */
function handleResize() {
    if (state.app) {
        const container = document.getElementById('canvas-container');
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        state.app.renderer.resize(width, height);
        
        // Center model if loaded
        if (state.model) {
            state.model.x = width / 2;
            state.model.y = height / 2;
        }
    }
}

/**
 * Canvas mouse handlers (for future interaction)
 */
let isDragging = false;
let dragStart = { x: 0, y: 0 };

function handleCanvasMouseDown(e) {
    isDragging = true;
    dragStart = { x: e.clientX, y: e.clientY };
}

function handleCanvasMouseMove(e) {
    if (!isDragging || !state.model) return;
    
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    
    // Update drag parameters if model supports it
    if (state.model.internalModel && state.model.internalModel.coreModel) {
        const model = state.model.internalModel.coreModel;
        
        // Try to update drag parameters
        const dragX = Math.max(-10, Math.min(10, dx / 50));
        const dragY = Math.max(-10, Math.min(10, dy / 50));
        
        // Common drag parameter names
        const dragParams = ['ParamAngleX', 'Param_Angle_X', 'touch_drag1', 'touch_drag2'];
        
        dragParams.forEach(paramId => {
            try {
                model.setParameterValueById(paramId, dragX);
            } catch (e) {
                // Parameter doesn't exist
            }
        });
    }
}

function handleCanvasMouseUp(e) {
    isDragging = false;
    
    // Reset drag parameters
    if (state.model && state.model.internalModel && state.model.internalModel.coreModel) {
        const model = state.model.internalModel.coreModel;
        const dragParams = ['ParamAngleX', 'Param_Angle_X', 'touch_drag1', 'touch_drag2'];
        
        dragParams.forEach(paramId => {
            try {
                model.setParameterValueById(paramId, 0);
            } catch (e) {
                // Parameter doesn't exist
            }
        });
    }
}

/**
 * Model interaction handlers
 */
function onModelPointerDown(event) {
    state.dragging = {
        start: event.data.global.clone(),
        current: event.data.global.clone()
    };
}

function onModelPointerMove(event) {
    if (!state.dragging || !state.model) return;
    
    state.dragging.current = event.data.global.clone();
    
    const dx = state.dragging.current.x - state.dragging.start.x;
    const dy = state.dragging.current.y - state.dragging.start.y;
    
    // Update drag parameters
    if (state.model.internalModel) {
        try {
            // Normalize to -10 to 10 range
            const dragX = Math.max(-10, Math.min(10, dx / 30));
            const dragY = Math.max(-10, Math.min(10, -dy / 30));
            
            // Set parameters if they exist
            setModelParameter('touch_drag1', dragY);
            setModelParameter('touch_drag2', dragX);
            setModelParameter('ParamAngleX', dragX);
            setModelParameter('ParamAngleY', dragY);
        } catch (e) {
            console.log('Could not set drag parameter');
        }
    }
}

function onModelPointerUp(event) {
    state.dragging = null;
    
    // Reset drag parameters smoothly
    if (state.model) {
        setTimeout(() => {
            setModelParameter('touch_drag1', 0);
            setModelParameter('touch_drag2', 0);
            setModelParameter('ParamAngleX', 0);
            setModelParameter('ParamAngleY', 0);
        }, 50);
    }
}

function onModelTap(event) {
    // Play a random touch animation
    const touchAnims = state.availableAnimations.filter(a => 
        a.includes('touch') || a.includes('tap')
    );
    
    if (touchAnims.length > 0) {
        const randomAnim = touchAnims[Math.floor(Math.random() * touchAnims.length)];
        elements.animationSelect.value = randomAnim;
        playSelectedAnimation();
    }
}

/**
 * Helper: Set model parameter
 */
function setModelParameter(paramId, value) {
    if (!state.model || !state.model.internalModel) return;
    
    try {
        const model = state.model.internalModel;
        if (model.coreModel && model.coreModel.setParameterValueById) {
            model.coreModel.setParameterValueById(paramId, value);
        }
    } catch (e) {
        // Parameter doesn't exist or method not available
    }
}

/**
 * Setup loaded model
 */
function setupModel(model) {
    // Add to stage
    state.app.stage.addChild(model);

    // Scale and position
    const canvas = state.app.view;
    const scale = Math.min(
        canvas.width / model.width,
        canvas.height / model.height
    ) * 0.8;

    model.scale.set(scale, scale);
    model.x = canvas.width / 2;
    model.y = canvas.height / 2;
    model.anchor.set(0.5, 0.5);

    // Make interactive
    model.interactive = true;
    model.buttonMode = true;

    // Add interaction events
    model.on('pointerdown', onModelPointerDown);
    model.on('pointermove', onModelPointerMove);
    model.on('pointerup', onModelPointerUp);
    model.on('pointerupoutside', onModelPointerUp);
    model.on('tap', onModelTap);

    // Enable breathing if available
    if (model.internalModel && model.internalModel.breathEnable !== undefined) {
        model.internalModel.breathEnable = state.autoBreath;
    }
    
    // Debug: Log motion structure
    console.log('Model loaded, checking motion structure...');
    if (model.internalModel && model.internalModel.motionManager) {
        console.log('Motion manager:', model.internalModel.motionManager);
        console.log('Motion groups:', model.internalModel.motionManager.groups);
        console.log('Motion definitions:', model.internalModel.motionManager.definitions);
    }
}

/**
 * Main update loop
 */
function update(deltaTime) {
    if (!state.model) return;
    
    const now = Date.now();
    const timeDelta = (now - state.lastUpdate) / 1000;
    state.lastUpdate = now;
    
    // Update model (breathing, physics, etc.)
    if (state.model.update) {
        state.model.update(timeDelta);
    } else if (state.model.internalModel && state.model.internalModel.update) {
        state.model.internalModel.update(timeDelta);
    }
}

/**
 * Update status message
 */
function updateStatus(message, type = 'loading') {
    elements.status.textContent = message;
    elements.status.className = `status-${type}`;
    
    // Auto-hide success messages after 3 seconds
    if (type === 'ready' || type === 'info') {
        setTimeout(() => {
            if (elements.status.className === `status-${type}`) {
                elements.status.style.opacity = '0.5';
            }
        }, 3000);
    } else {
        elements.status.style.opacity = '1';
    }
}

/**
 * Utility: Get model file paths
 */
function getModelPaths(characterName) {
    const basePath = `${CONFIG.assetsPath}${characterName}/`;
    return {
        model: `${basePath}${characterName}${CONFIG.modelExtension}`,
        moc: `${basePath}${characterName}.moc3`,
        physics: `${basePath}${characterName}.physics3.json`,
        textures: `${basePath}textures/`,
        motions: `${basePath}motions/`
    };
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}