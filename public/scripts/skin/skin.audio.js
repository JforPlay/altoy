/**
 * Skin Audio Module
 * Handles audio playback, volume control, and play button state management.
 */

const state = {
    currentAudio: null,
    currentPlayButton: null,
    globalVolume: 0.3,
    volumeChangeHandlers: []
};

/**
 * Initialize audio controls (volume slider)
 */
function init() {
    updateVolumeIcon();
}

/**
 * stop currently playing audio and reset button state
 */
function stopCurrentAudio() {
    if (state.currentAudio) {
        state.currentAudio.pause();
        state.currentAudio.currentTime = 0;
        state.currentAudio = null;
    }
    if (state.currentPlayButton) {
        state.currentPlayButton.innerHTML = '<i class="fas fa-play"></i>';
        state.currentPlayButton.classList.remove('playing');
        state.currentPlayButton = null;
    }
}

/**
 * Handle play button click
 * @param {Event} event - Click event
 */
function handlePlayClick(event) {
    const button = event.target.closest('.play-voice-btn');
    if (!button) return;

    const src = button.getAttribute('data-src');
    if (!src) return;

    if (button === state.currentPlayButton) {
        stopCurrentAudio();
    } else {
        stopCurrentAudio();
        state.currentPlayButton = button;
        state.currentAudio = new Audio(src);
        state.currentAudio.volume = state.globalVolume;
        state.currentAudio.play().catch(e => console.error("Error playing audio:", e));
        button.innerHTML = '<i class="fas fa-stop"></i>';
        button.classList.add('playing');
        state.currentAudio.addEventListener('ended', stopCurrentAudio);
    }
}

/**
 * Handle volume slider change
 * @param {Event} event - Input event
 */
function handleVolumeChange(event) {
    state.globalVolume = event.target.value / 100;

    if (state.currentAudio) {
        state.currentAudio.volume = state.globalVolume;
    }

    const allVolumeSliders = document.querySelectorAll('.volume-slider');
    const allVolumePercentages = document.querySelectorAll('.volume-percentage');

    allVolumeSliders.forEach(slider => {
        slider.value = Math.round(state.globalVolume * 100);
    });

    allVolumePercentages.forEach(percentage => {
        percentage.textContent = `${Math.round(state.globalVolume * 100)}%`;
    });

    updateVolumeIcon();
}

function updateVolumeIcon() {
    const volumeIcons = document.querySelectorAll('.volume-icon');
    const volume = state.globalVolume;

    volumeIcons.forEach(icon => {
        icon.className = '';
        if (volume === 0) {
            icon.className = 'fas fa-volume-mute volume-icon';
        } else if (volume < 0.5) {
            icon.className = 'fas fa-volume-down volume-icon';
        } else {
            icon.className = 'fas fa-volume-up volume-icon';
        }
    });
}

function createVolumeControlHtml() {
    const volumePercentage = Math.round(state.globalVolume * 100);
    return `
        <div class="volume-control-container">
            <i class="fas fa-volume-up volume-icon"></i>
            <input type="range" class="volume-slider" min="0" max="100" value="${volumePercentage}" aria-label="볼륨 조절">
            <span class="volume-percentage">${volumePercentage}%</span>
        </div>
    `;
}

/**
 * Attach volume listeners to new sliders
 */
function attachVolumeListeners() {
    // Remove old listeners to prevent duplicates if any
    state.volumeChangeHandlers.forEach(({ slider, handler }) => {
        slider.removeEventListener('input', handler);
    });
    state.volumeChangeHandlers = [];

    const volumeSliders = document.querySelectorAll('.volume-slider');
    volumeSliders.forEach(slider => {
        slider.addEventListener('input', handleVolumeChange);
        state.volumeChangeHandlers.push({ slider, handler: handleVolumeChange });
    });
}

// Backwards-compatible global access
window.SkinAudio = {
    init,
    stopCurrentAudio,
    handlePlayClick,
    createVolumeControlHtml,
    attachVolumeListeners,
    updateVolumeIcon
};

export {
    init,
    stopCurrentAudio,
    handlePlayClick,
    createVolumeControlHtml,
    attachVolumeListeners,
    updateVolumeIcon
};
