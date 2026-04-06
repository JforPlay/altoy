/**
 * skin.audio.js
 * Audio playback controller for skin voice lines.
 * Manages a single shared audio instance and synchronized volume sliders across
 * the skin detail and skin list pages. Exposed as both ES module exports and
 * window.SkinAudio for pages that import it non-modularly.
 */

// ===== State =====

const state = {
    currentAudio: null,
    currentPlayButton: null,
    globalVolume: 0.3,
    volumeChangeHandlers: []
};

// ===== Playback =====

/** Sync the volume icon class with the current global volume level. */
function init() {
    updateVolumeIcon();
}

/**
 * Stop any currently playing audio and reset its play button to the idle state.
 * Clears the tracked audio and button references so the next play starts fresh.
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
 * Toggle playback for the clicked `.play-voice-btn`; stops any other playing audio first.
 * If the same button is clicked while playing, it acts as a stop. If a different button is
 * clicked, the previous audio stops and the new clip starts, registering an `ended` listener
 * to auto-reset the button when playback finishes naturally.
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

// ===== Volume =====

// Volume state handlers — react to slider input and sync state/icons
/**
 * Handle a `.volume-slider` input event: update global volume and apply it to any
 * currently playing audio. Syncs all slider values and percentage labels on the page
 * (both detail and list pages may have sliders), then refreshes the volume icon.
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

/**
 * Update all `.volume-icon` elements to reflect the current volume level.
 * Picks between mute, low, and high icon classes based on three thresholds (0 / < 0.5 / ≥ 0.5).
 */
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

// Volume DOM helpers — build and wire the slider UI
/**
 * Return the HTML string for a volume slider widget initialized to the current volume.
 * The rendered percentage label and slider value both reflect `state.globalVolume` at call time.
 */
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
 * Re-bind volume input listeners on all current `.volume-slider` elements.
 * Removes previously tracked listeners first to prevent duplicates when sliders are re-rendered.
 */
function attachVolumeListeners() {
    // Remove old listeners to prevent duplicates when sliders are re-rendered
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

// ===== Exports =====

// Backwards-compatible global access for pages that load this file non-modularly
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
