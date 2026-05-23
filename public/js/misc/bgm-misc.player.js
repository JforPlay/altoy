/**
 * bgm-misc.player.js
 * Player controller for /misc/bgm-misc. Single owner of the audio element
 * and queue state. The DOM (rows, sticky bar, drawer) talks to this player
 * via actions + events — no component touches <audio> directly.
 */

export function trackId(stem, cue) {
    return `${stem}::${cue}`;
}

export function createPlayer({ audioEl, storage = null, resolveTrack = null }) {
    const state = {
        queue: [],          // [{ id, stem, cue, url }]
        currentIndex: null, // index into queue when mode='queue'
        previewTrack: null, // {id, stem, cue, url} when mode='preview'
        mode: 'idle',       // 'idle' | 'preview' | 'queue'
        repeat: 'off',      // 'off' | 'all' | 'single'
        shuffle: false,
        shufflePerm: null,  // array of indices, only when shuffle=true
    };

    const target = new EventTarget();
    function emit(name) { target.dispatchEvent(new CustomEvent(name)); }

    audioEl.addEventListener('ended', () => {
        if (state.mode === 'preview') {
            state.mode = 'idle';
            state.previewTrack = null;
            emit('track-change');
            emit('state-change');
            return;
        }
        if (state.mode === 'queue') {
            if (state.repeat === 'single') {
                if (state.currentIndex != null) {
                    audioEl.src = state.queue[state.currentIndex].url;
                    audioEl.play().catch(() => {});
                }
                return;
            }
            advance(+1);
        }
    });

    audioEl.addEventListener('play', () => emit('state-change'));
    audioEl.addEventListener('pause', () => emit('state-change'));

    function nextIndex(direction) {
        const len = state.queue.length;
        if (len === 0 || state.currentIndex == null) return null;
        if (state.shuffle && state.shufflePerm) {
            const pos = state.shufflePerm.indexOf(state.currentIndex);
            const newPos = pos + direction;
            if (newPos < 0 || newPos >= len) {
                return state.repeat === 'all' ? state.shufflePerm[(newPos + len) % len] : null;
            }
            return state.shufflePerm[newPos];
        }
        const newIndex = state.currentIndex + direction;
        if (newIndex < 0 || newIndex >= len) {
            return state.repeat === 'all' ? ((newIndex + len) % len) : null;
        }
        return newIndex;
    }

    function advance(direction) {
        const next = nextIndex(direction);
        if (next == null) {
            audioEl.pause();
            return;
        }
        state.currentIndex = next;
        audioEl.src = state.queue[next].url;
        audioEl.play().catch(() => {});
        emit('track-change');
        emit('state-change');
    }

    function persist() {
        if (!storage) return;
        storage.save({
            queue: state.queue.map(t => t.id),
            repeat: state.repeat,
            shuffle: state.shuffle,
            volume: audioEl.volume,
        });
    }

    // Build a fresh Fisher-Yates permutation over the current queue indices.
    // Used both when shuffle is toggled on and whenever the queue mutates
    // while shuffle is already active (favorites added/removed).
    function shufflePermutation() {
        const perm = state.queue.map((_, i) => i);
        for (let i = perm.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [perm[i], perm[j]] = [perm[j], perm[i]];
        }
        return perm;
    }

    // Rehydrate from storage if available. Drops ids the host can't resolve
    // (renamed files, deleted stems) instead of holding broken entries.
    if (storage && typeof resolveTrack === 'function') {
        const loaded = storage.load();
        if (loaded && Array.isArray(loaded.queue)) {
            for (const id of loaded.queue) {
                const track = resolveTrack(id);
                if (track) state.queue.push(track);
            }
            if (loaded.repeat === 'all' || loaded.repeat === 'single' || loaded.repeat === 'off') {
                state.repeat = loaded.repeat;
            }
            // Restore shuffle flag and regenerate a fresh permutation over the
            // rehydrated queue. We don't persist the permutation itself —
            // only the bool — so this is the first time it exists this session.
            if (typeof loaded.shuffle === 'boolean') {
                state.shuffle = loaded.shuffle;
                if (state.shuffle && state.queue.length > 0) {
                    state.shufflePerm = shufflePermutation();
                }
            }
            if (typeof loaded.volume === 'number' && loaded.volume >= 0 && loaded.volume <= 1) {
                audioEl.volume = loaded.volume;
            }
        }
    }

    return {
        getQueue: () => state.queue.slice(),
        getCurrentTrack: () => {
            if (state.mode === 'preview') return state.previewTrack;
            if (state.mode === 'queue' && state.currentIndex != null) {
                return state.queue[state.currentIndex] || null;
            }
            return null;
        },
        getMode: () => state.mode,
        getRepeat: () => state.repeat,
        isShuffle: () => state.shuffle,
        isPlaying: () => !audioEl.paused,
        isFavorited: (id) => state.queue.some(t => t.id === id),
        getVolume: () => audioEl.volume,

        seekTo(seconds) {
            if (typeof seconds !== 'number' || isNaN(seconds)) return;
            if (audioEl.duration && seconds >= 0 && seconds <= audioEl.duration) {
                audioEl.currentTime = seconds;
            }
        },

        setVolume(level) {
            const v = Math.max(0, Math.min(1, Number(level) || 0));
            audioEl.volume = v;
            persist();
            emit('state-change');
        },

        on: (name, fn) => target.addEventListener(name, fn),
        off: (name, fn) => target.removeEventListener(name, fn),

        toggleFavorite(track) {
            if (!track || !track.id) return;
            const i = state.queue.findIndex(t => t.id === track.id);
            if (i >= 0) {
                state.queue.splice(i, 1);
                if (state.mode === 'queue' && state.currentIndex != null) {
                    // Keep currentIndex pointing at the same track after splice:
                    // shift left if a track before us was removed; detach if our
                    // own track was removed (playback continues but is now orphaned).
                    if (i < state.currentIndex) state.currentIndex--;
                    else if (i === state.currentIndex) state.currentIndex = null;
                }
            } else {
                state.queue.push({ id: track.id, stem: track.stem, cue: track.cue, url: track.url });
            }
            // Queue length/indices just changed — any existing shuffle permutation
            // is now stale (missing the new index, or referencing a removed one).
            // Rebuild against the new queue so next/prev keep cycling correctly.
            if (state.shuffle) {
                state.shufflePerm = state.queue.length > 0 ? shufflePermutation() : null;
            }
            persist();
            emit('queue-change');
            emit('state-change');
        },

        preview(track) {
            if (!track || !track.url) return;
            state.previewTrack = track;
            state.mode = 'preview';
            audioEl.src = track.url;
            audioEl.play().catch(err => console.error('preview play failed', err));
            emit('track-change');
            emit('state-change');
        },

        playQueueAt(index) {
            if (index < 0 || index >= state.queue.length) return;
            state.currentIndex = index;
            state.previewTrack = null;
            state.mode = 'queue';
            audioEl.src = state.queue[index].url;
            audioEl.play().catch(err => console.error('queue play failed', err));
            emit('track-change');
            emit('state-change');
        },

        togglePlayPause() {
            if (state.mode === 'idle') {
                // Nothing loaded — start the queue from the top if it has items.
                if (state.queue.length > 0) {
                    state.currentIndex = 0;
                    state.mode = 'queue';
                    audioEl.src = state.queue[0].url;
                    audioEl.play().catch(err => console.error('play failed', err));
                    emit('track-change');
                    emit('state-change');
                }
                return;
            }
            if (audioEl.paused) {
                audioEl.play().catch(err => console.error('play failed', err));
            } else {
                audioEl.pause();
            }
        },

        next() {
            if (state.mode !== 'queue') return;
            advance(+1);
        },

        prev() {
            if (state.mode !== 'queue') return;
            advance(-1);
        },

        setRepeat(mode) {
            if (!['off', 'all', 'single'].includes(mode)) return;
            state.repeat = mode;
            persist();
            emit('state-change');
        },

        toggleShuffle() {
            state.shuffle = !state.shuffle;
            state.shufflePerm = state.shuffle ? shufflePermutation() : null;
            persist();
            emit('state-change');
        },

        clearQueue() {
            state.queue = [];
            state.currentIndex = null;
            state.shufflePerm = null;
            if (state.mode === 'queue') {
                audioEl.pause();
                state.mode = 'idle';
            }
            persist();
            emit('queue-change');
            emit('track-change');
            emit('state-change');
        },
    };
}
