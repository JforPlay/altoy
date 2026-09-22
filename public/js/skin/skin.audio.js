/**
 * skin.audio.js
 * Audio playback controller for skin voice lines.
 * Manages a single shared audio instance and synchronized volume sliders across
 * the skin detail and skin list pages.
 */

import { createIcon } from '../utils.js';

// ===== State =====

const state = {
    currentAudio: null,
    currentPlayButton: null,
    currentLabel: '',
    globalVolume: 0.3,
    volumeChangeHandlers: [],
    // Playback observers (skin detail's player bar). Empty for the pages that
    // only delegate clicks — notifying then costs one no-op Set iteration.
    playbackSubscribers: new Set()
};

// ===== Playback =====

/** Sync the volume icon class with the current global volume level. */
function init() {
    updateVolumeIcon();
}

/**
 * Observe the shared audio element so a UI can follow playback it did not start.
 * The callback receives `{ playing, label, currentTime, duration }` on play, on
 * every `timeupdate`, once metadata lands (so the progress denominator is real),
 * and on stop/end.
 * @param {(snapshot: {playing: boolean, label: string, currentTime: number, duration: number}) => void} callback
 * @returns {() => void} Unsubscribe
 */
function subscribePlayback(callback) {
    if (typeof callback !== 'function') return () => {};
    state.playbackSubscribers.add(callback);
    return () => state.playbackSubscribers.delete(callback);
}

/**
 * Push a playback snapshot to every subscriber.
 * `playing` is passed in rather than read off `audio.paused` because `play()`
 * resolves asynchronously — the element is still paused on the tick the click
 * handler starts it, so reading it would report every fresh play as stopped.
 * One throwing subscriber must not stop the others or break playback itself.
 */
function notifyPlayback(playing) {
    const audio = state.currentAudio;
    const duration = audio && Number.isFinite(audio.duration) ? audio.duration : 0;
    const snapshot = {
        playing,
        label: state.currentLabel,
        currentTime: playing && audio ? audio.currentTime : 0,
        duration: playing ? duration : 0
    };
    state.playbackSubscribers.forEach(callback => {
        try {
            callback(snapshot);
        } catch (e) {
            console.error('Playback subscriber failed:', e);
        }
    });
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
        state.currentPlayButton.replaceChildren(createIcon('fas fa-play'));
        state.currentPlayButton.classList.remove('playing');
        state.currentPlayButton = null;
    }
    state.currentLabel = '';
    notifyPlayback(false);
}

/**
 * Toggle playback for the clicked `.play-voice-btn`; stops any other playing audio first.
 * If the same button is clicked while playing, it acts as a stop. If a different button is
 * clicked, the previous audio stops and the new clip starts, registering an `ended` listener
 * to auto-reset the button when playback finishes naturally.
 *
 * `data-label` is optional: pages with a player bar (skin detail) stamp each row's
 * label on its button so the bar can name the running track; the pages that only
 * delegate clicks (skin list, cn-preview) omit it and the label stays empty.
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
        const audio = new Audio(src);
        state.currentPlayButton = button;
        state.currentLabel = button.dataset.label || '';
        state.currentAudio = audio;
        audio.volume = state.globalVolume;
        audio.play().catch(e => console.error("Error playing audio:", e));
        button.replaceChildren(createIcon('fas fa-stop'));
        button.classList.add('playing');
        audio.addEventListener('ended', stopCurrentAudio);
        // Guarded against the element that was just superseded: a trailing event
        // from the previous clip must not re-announce playback after a stop.
        const onProgress = () => {
            if (state.currentAudio === audio) notifyPlayback(true);
        };
        audio.addEventListener('timeupdate', onProgress);
        audio.addEventListener('loadedmetadata', onProgress);
        notifyPlayback(true);
    }
}

/**
 * Move the playhead of whatever is currently playing.
 *
 * Guarded on a FINITE duration, not merely on there being an audio element:
 * until `loadedmetadata` lands the duration is NaN, and assigning a currentTime
 * against it throws in some engines — the player bar's seek slider is live from
 * the moment a clip starts, which is exactly that window.
 * @param {number} seconds - clamped into [0, duration]
 */
function seekTo(seconds) {
    const audio = state.currentAudio;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.min(Math.max(0, seconds), audio.duration);
    // `timeupdate` follows a seek, but not before the next frame — push now so the
    // readout tracks the drag instead of lagging a tick behind the thumb.
    notifyPlayback(!audio.paused);
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
 * Return a volume slider widget element initialized to the current global volume.
 * The label and slider both reflect `state.globalVolume` at call time.
 */
function createVolumeControlElement() {
    const volumePercentage = Math.round(state.globalVolume * 100);

    const container = document.createElement('div');
    container.className = 'volume-control-container';

    const icon = createIcon('fas fa-volume-up volume-icon');

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'volume-slider';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(volumePercentage);
    slider.setAttribute('aria-label', '볼륨 조절');

    const percentage = document.createElement('span');
    percentage.className = 'volume-percentage';
    percentage.textContent = `${volumePercentage}%`;

    container.append(icon, slider, percentage);
    return container;
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

export {
    init,
    stopCurrentAudio,
    handlePlayClick,
    subscribePlayback,
    seekTo,
    createVolumeControlElement,
    attachVolumeListeners,
    updateVolumeIcon
};
