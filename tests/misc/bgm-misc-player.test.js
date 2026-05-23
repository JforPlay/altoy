import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, trackId } from '../../public/js/misc/bgm-misc.player.js';

function makeFakeAudio() {
    const listeners = new Map();
    return {
        src: '',
        paused: true,
        volume: 1,
        duration: 0,
        play() { this.paused = false; (listeners.get('play') || []).forEach(f => f()); return Promise.resolve(); },
        pause() { this.paused = true; (listeners.get('pause') || []).forEach(f => f()); },
        addEventListener(ev, fn) {
            if (!listeners.has(ev)) listeners.set(ev, []);
            listeners.get(ev).push(fn);
        },
        removeEventListener() {},
        _emit(ev) { (listeners.get(ev) || []).forEach(fn => fn()); },
    };
}

test('trackId composes stem and cue', () => {
    assert.equal(trackId('myStem', 'myCue'), 'myStem::myCue');
});

test('player starts in idle mode with empty queue', () => {
    const audio = makeFakeAudio();
    const player = createPlayer({ audioEl: audio, storage: null });
    assert.equal(player.getMode(), 'idle');
    assert.deepEqual(player.getQueue(), []);
    assert.equal(player.isPlaying(), false);
});

test('toggleFavorite adds track to queue, second call removes', () => {
    const audio = makeFakeAudio();
    const player = createPlayer({ audioEl: audio, storage: null });
    const t = { id: 'a::1', stem: 'a', cue: '1', url: 'http://x/1' };

    player.toggleFavorite(t);
    assert.equal(player.isFavorited('a::1'), true);
    assert.equal(player.getQueue().length, 1);

    player.toggleFavorite(t);
    assert.equal(player.isFavorited('a::1'), false);
    assert.equal(player.getQueue().length, 0);
});

test('toggleFavorite emits queue-change', () => {
    const audio = makeFakeAudio();
    const player = createPlayer({ audioEl: audio, storage: null });
    let count = 0;
    player.on('queue-change', () => count++);
    player.toggleFavorite({ id: 'a::1', stem: 'a', cue: '1', url: 'http://x/1' });
    assert.equal(count, 1);
});

test('toggleFavorite saves to storage when provided', () => {
    const audio = makeFakeAudio();
    let saved = null;
    const storage = { load: () => null, save: (s) => { saved = s; } };
    const player = createPlayer({ audioEl: audio, storage });
    player.toggleFavorite({ id: 'a::1', stem: 'a', cue: '1', url: 'http://x/1' });
    assert.deepEqual(saved, { queue: ['a::1'], repeat: 'off', shuffle: false, volume: 1 });
});

test('preview sets mode to preview and loads track', () => {
    const audio = makeFakeAudio();
    const player = createPlayer({ audioEl: audio, storage: null });
    const t = { id: 'a::1', stem: 'a', cue: '1', url: 'http://x/1' };
    player.preview(t);
    assert.equal(player.getMode(), 'preview');
    assert.equal(audio.src, 'http://x/1');
    assert.equal(player.getCurrentTrack(), t);
});

test('playQueueAt sets mode to queue and plays from queue', () => {
    const audio = makeFakeAudio();
    const player = createPlayer({ audioEl: audio, storage: null });
    player.toggleFavorite({ id: 'a::1', stem: 'a', cue: '1', url: 'http://x/1' });
    player.toggleFavorite({ id: 'b::2', stem: 'b', cue: '2', url: 'http://x/2' });
    player.playQueueAt(1);
    assert.equal(player.getMode(), 'queue');
    assert.equal(audio.src, 'http://x/2');
});

test('playQueueAt with invalid index is a no-op', () => {
    const audio = makeFakeAudio();
    const player = createPlayer({ audioEl: audio, storage: null });
    player.playQueueAt(0);
    assert.equal(player.getMode(), 'idle');
});

test('togglePlayPause pauses then plays', () => {
    const audio = makeFakeAudio();
    const player = createPlayer({ audioEl: audio, storage: null });
    player.preview({ id: 'a::1', stem: 'a', cue: '1', url: 'http://x/1' });
    assert.equal(audio.paused, false);
    player.togglePlayPause();
    assert.equal(audio.paused, true);
    player.togglePlayPause();
    assert.equal(audio.paused, false);
});

test('setRepeat cycles values', () => {
    const audio = makeFakeAudio();
    const player = createPlayer({ audioEl: audio, storage: null });
    assert.equal(player.getRepeat(), 'off');
    player.setRepeat('all');
    assert.equal(player.getRepeat(), 'all');
    player.setRepeat('single');
    assert.equal(player.getRepeat(), 'single');
});

test('next advances queue, wraps with repeat=all', () => {
    const audio = makeFakeAudio();
    const player = createPlayer({ audioEl: audio, storage: null });
    player.toggleFavorite({ id: 'a::1', stem: 'a', cue: '1', url: 'http://x/1' });
    player.toggleFavorite({ id: 'b::2', stem: 'b', cue: '2', url: 'http://x/2' });
    player.playQueueAt(0);
    player.next();
    assert.equal(audio.src, 'http://x/2');
    player.setRepeat('all');
    player.next();
    assert.equal(audio.src, 'http://x/1');
});

test('next at end with repeat=off stays put', () => {
    const audio = makeFakeAudio();
    const player = createPlayer({ audioEl: audio, storage: null });
    player.toggleFavorite({ id: 'a::1', stem: 'a', cue: '1', url: 'http://x/1' });
    player.toggleFavorite({ id: 'b::2', stem: 'b', cue: '2', url: 'http://x/2' });
    player.playQueueAt(1);
    player.next();
    assert.equal(audio.src, 'http://x/2');
});

test('ended in queue mode with repeat=single replays', () => {
    const audio = makeFakeAudio();
    const player = createPlayer({ audioEl: audio, storage: null });
    player.toggleFavorite({ id: 'a::1', stem: 'a', cue: '1', url: 'http://x/1' });
    player.playQueueAt(0);
    player.setRepeat('single');
    audio.src = '';            // simulate audio finishing
    audio._emit('ended');
    assert.equal(audio.src, 'http://x/1');
});

test('ended in preview mode does not advance', () => {
    const audio = makeFakeAudio();
    const player = createPlayer({ audioEl: audio, storage: null });
    player.toggleFavorite({ id: 'a::1', stem: 'a', cue: '1', url: 'http://x/1' });
    player.preview({ id: 'b::2', stem: 'b', cue: '2', url: 'http://x/2' });
    audio._emit('ended');
    assert.equal(player.getMode(), 'idle');
});

test('toggleShuffle generates and clears permutation', () => {
    const audio = makeFakeAudio();
    const player = createPlayer({ audioEl: audio, storage: null });
    [1, 2, 3, 4, 5].forEach(n =>
        player.toggleFavorite({ id: `t::${n}`, stem: 't', cue: `${n}`, url: `http://x/${n}` })
    );
    player.toggleShuffle();
    assert.equal(player.isShuffle(), true);
    player.toggleShuffle();
    assert.equal(player.isShuffle(), false);
});

test('clearQueue empties queue and stops playback', () => {
    const audio = makeFakeAudio();
    const player = createPlayer({ audioEl: audio, storage: null });
    player.toggleFavorite({ id: 'a::1', stem: 'a', cue: '1', url: 'http://x/1' });
    player.playQueueAt(0);
    player.clearQueue();
    assert.equal(player.getQueue().length, 0);
    assert.equal(audio.paused, true);
    assert.equal(player.getMode(), 'idle');
});

test('player rehydrates queue from storage on construction', () => {
    const audio = makeFakeAudio();
    const stored = { queue: ['a::1', 'b::2'], repeat: 'all', shuffle: false };
    const storage = { load: () => stored, save: () => {} };
    const resolve = (id) => {
        const [stem, cue] = id.split('::');
        return { id, stem, cue, url: `http://x/${cue}` };
    };
    const player = createPlayer({ audioEl: audio, storage, resolveTrack: resolve });
    assert.equal(player.getQueue().length, 2);
    assert.equal(player.getQueue()[0].url, 'http://x/1');
    assert.equal(player.getRepeat(), 'all');
});

test('player drops unresolvable track ids on rehydrate', () => {
    const audio = makeFakeAudio();
    const stored = { queue: ['a::1', 'missing::x'], repeat: 'off', shuffle: false };
    const storage = { load: () => stored, save: () => {} };
    const resolve = (id) => id === 'missing::x' ? null : { id, stem: 'a', cue: '1', url: 'http://x/1' };
    const player = createPlayer({ audioEl: audio, storage, resolveTrack: resolve });
    assert.equal(player.getQueue().length, 1);
});

test('player rehydrates shuffle flag from storage', () => {
    const audio = makeFakeAudio();
    const stored = { queue: ['a::1', 'b::2'], repeat: 'off', shuffle: true };
    const storage = { load: () => stored, save: () => {} };
    const resolve = (id) => {
        const [stem, cue] = id.split('::');
        return { id, stem, cue, url: `http://x/${cue}` };
    };
    const player = createPlayer({ audioEl: audio, storage, resolveTrack: resolve });
    assert.equal(player.isShuffle(), true);
});

test('toggleFavorite while shuffle is on rebuilds the permutation', () => {
    const audio = makeFakeAudio();
    const player = createPlayer({ audioEl: audio, storage: null });
    player.toggleFavorite({ id: 'a::1', stem: 'a', cue: '1', url: 'http://x/1' });
    player.toggleFavorite({ id: 'b::2', stem: 'b', cue: '2', url: 'http://x/2' });
    player.toggleShuffle();
    // Add a third track AFTER shuffle is on — permutation must include all 3 indices.
    player.toggleFavorite({ id: 'c::3', stem: 'c', cue: '3', url: 'http://x/3' });
    player.playQueueAt(0);
    // Walk next twice with repeat=all and verify we cover all 3 distinct urls.
    player.setRepeat('all');
    const visited = new Set([audio.src]);
    player.next();
    visited.add(audio.src);
    player.next();
    visited.add(audio.src);
    assert.equal(visited.size, 3, 'shuffle should visit all 3 tracks (no missing index from stale perm)');
});

test('seekTo sets audio currentTime within duration', () => {
    const audio = makeFakeAudio();
    audio.duration = 120;
    audio.currentTime = 0;
    const player = createPlayer({ audioEl: audio, storage: null });
    player.seekTo(45);
    assert.equal(audio.currentTime, 45);
});

test('seekTo ignores out-of-range or invalid values', () => {
    const audio = makeFakeAudio();
    audio.duration = 120;
    audio.currentTime = 10;
    const player = createPlayer({ audioEl: audio, storage: null });
    player.seekTo(-5);
    assert.equal(audio.currentTime, 10);
    player.seekTo(999);
    assert.equal(audio.currentTime, 10);
    player.seekTo('not a number');
    assert.equal(audio.currentTime, 10);
});

test('setVolume clamps and persists', () => {
    const audio = makeFakeAudio();
    let saved = null;
    const storage = { load: () => null, save: (s) => { saved = s; } };
    const player = createPlayer({ audioEl: audio, storage });
    player.setVolume(0.5);
    assert.equal(audio.volume, 0.5);
    assert.equal(saved.volume, 0.5);
    player.setVolume(2);
    assert.equal(audio.volume, 1);
    player.setVolume(-1);
    assert.equal(audio.volume, 0);
});

test('player rehydrates volume from storage', () => {
    const audio = makeFakeAudio();
    audio.volume = 1;
    const stored = { queue: [], repeat: 'off', shuffle: false, volume: 0.25 };
    const storage = { load: () => stored, save: () => {} };
    const player = createPlayer({ audioEl: audio, storage, resolveTrack: () => null });
    assert.equal(audio.volume, 0.25);
});
