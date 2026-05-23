/**
 * bgm-misc.js
 * Wires the bgm-misc page DOM to the Player controller. Rows expose ♥ (queue
 * toggle) and ▶ (preview-only). Sticky bar + drawer reflect player state.
 */
import { fetchJSON, makeKeyboardActivatable, requireElements, syncedStorage } from '../utils.js';
import { createPlayer, trackId } from './bgm-misc.player.js';
import { createVisualizer } from './bgm-misc.visualizer.js';

const STORAGE_KEY = 'bgm-misc-player';

const PREVIEW_BTN_ICONS = `
    <svg class="bgm-misc-icon-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <polygon points="6 4 20 12 6 20 6 4"></polygon>
    </svg>
    <svg class="bgm-misc-icon-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="6" y="4" width="4" height="16"></rect>
        <rect x="14" y="4" width="4" height="16"></rect>
    </svg>
`;

document.addEventListener('DOMContentLoaded', async () => {
    const listEl = document.getElementById('bgm-misc-list');
    const audioEl = document.getElementById('bgm-misc-audio');
    const searchEl = document.getElementById('bgm-misc-search');
    const countEl = document.getElementById('bgm-misc-search-count');
    const barEl = document.getElementById('bgm-misc-player-bar');
    const playPauseBtn = document.getElementById('bgm-misc-playpause');
    const prevBtn = document.getElementById('bgm-misc-prev');
    const nextBtn = document.getElementById('bgm-misc-next');
    const shuffleBtn = document.getElementById('bgm-misc-shuffle');
    const repeatBtn = document.getElementById('bgm-misc-repeat');
    const drawerToggleBtn = document.getElementById('bgm-misc-drawer-toggle');
    const drawerEl = document.getElementById('bgm-misc-queue-drawer');
    const queueListEl = document.getElementById('bgm-misc-queue-list');
    const queueCountEl = document.getElementById('bgm-misc-queue-count');
    const clearBtn = document.getElementById('bgm-misc-clear');
    const visualizerCanvas = document.getElementById('bgm-misc-visualizer');
    const nowLabelEl = document.getElementById('bgm-misc-now-label');
    const seekEl = document.getElementById('bgm-misc-seek');
    const volumeSliderEl = document.getElementById('bgm-misc-volume');
    const muteBtn = document.getElementById('bgm-misc-mute');
    const timeLabelEl = document.getElementById('bgm-misc-time-label');
    const toastEl = document.getElementById('bgm-misc-toast');

    if (!requireElements({
        listEl, audioEl, searchEl, countEl, barEl, playPauseBtn, prevBtn, nextBtn,
        shuffleBtn, repeatBtn, drawerToggleBtn, drawerEl, queueListEl, queueCountEl,
        clearBtn, visualizerCanvas, nowLabelEl, seekEl, volumeSliderEl, muteBtn,
        timeLabelEl, toastEl,
    }, 'BGM misc page')) return;

    audioEl.volume = 0.1;

    let orphans;
    try {
        orphans = await fetchJSON('data/misc/bgm_orphans.json');
    } catch (err) {
        console.error('Failed to load bgm_orphans.json', err);
        listEl.replaceChildren(makeMessage('데이터를 불러오지 못했습니다.'));
        return;
    }

    const stems = Object.keys(orphans).sort();
    if (stems.length === 0) {
        listEl.replaceChildren(makeMessage('보관된 BGM이 없습니다.'));
        return;
    }

    // Flat track index for id-based lookup (queue rehydrate, row events).
    const trackIndex = new Map();
    for (const stem of stems) {
        for (const t of orphans[stem].tracks) {
            const id = trackId(stem, t.cue);
            trackIndex.set(id, { id, stem, cue: t.cue, url: t.music_link });
        }
    }

    // Persistence wrapper. Stored shape = { queue: ids[], repeat, shuffle }.
    const storage = syncedStorage(STORAGE_KEY, {
        parse: (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : null,
        debounce: 150,
        version: 1,
        onRemoteChange: () => {
            // Another tab changed the queue. Simplest correct behavior is to
            // reload — keeps the player single-source-of-truth without a live
            // remote-patch protocol.
            window.location.reload();
        },
    });

    const player = createPlayer({
        audioEl,
        storage,
        resolveTrack: (id) => trackIndex.get(id) || null,
    });

    let barRevealed = false;
    function revealBar() {
        if (barRevealed) return;
        barRevealed = true;
        barEl.removeAttribute('hidden');
    }

    // ---- Row rendering ----
    const rows = stems.map(stem => {
        const album = orphans[stem];
        const el = makeStemRow(stem, album);
        const needle = [stem, ...(album.cues || [])].join(' ').toLowerCase();
        return { stem, el, needle };
    });
    const frag = document.createDocumentFragment();
    for (const r of rows) frag.appendChild(r.el);
    listEl.appendChild(frag);
    updateCount(rows.length, rows.length);

    // ---- Search ----
    let searchTimer = 0;
    searchEl.addEventListener('input', () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(applyFilter, 80);
    });
    function applyFilter() {
        const q = searchEl.value.trim().toLowerCase();
        let shown = 0;
        for (const r of rows) {
            const match = !q || r.needle.includes(q);
            r.el.hidden = !match;
            if (match) shown++;
        }
        updateCount(shown, rows.length);
    }
    function updateCount(shown, total) {
        countEl.textContent = shown === total ? `${total}` : `${shown} / ${total}`;
    }

    // ---- Visualizer ----
    const viz = createVisualizer(visualizerCanvas, { barCount: 32 });

    // ---- Sticky bar ----
    playPauseBtn.addEventListener('click', () => player.togglePlayPause());
    prevBtn.addEventListener('click', () => player.prev());
    nextBtn.addEventListener('click', () => player.next());
    shuffleBtn.addEventListener('click', () => {
        player.toggleShuffle();
        showToast(`셔플 · ${player.isShuffle() ? '켬' : '끔'}`);
    });
    repeatBtn.addEventListener('click', () => {
        const nextMode = { off: 'all', all: 'single', single: 'off' }[player.getRepeat()];
        player.setRepeat(nextMode);
        showToast(`반복 · ${({ off: '끔', all: '전체', single: '한 곡' })[player.getRepeat()]}`);
    });
    drawerToggleBtn.addEventListener('click', toggleDrawer);

    // ---- Seek bar wiring ----
    function formatTime(sec) {
        if (!Number.isFinite(sec)) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function updateSeekUI() {
        const dur = audioEl.duration;
        const cur = audioEl.currentTime;
        if (Number.isFinite(dur) && dur > 0) {
            seekEl.max = dur;
            seekEl.value = cur;
            seekEl.disabled = false;
            const pct = (cur / dur) * 100;
            seekEl.style.setProperty('--bgm-misc-seek-pct', `${pct}%`);
            timeLabelEl.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
        } else {
            seekEl.max = 0;
            seekEl.value = 0;
            seekEl.disabled = true;
            seekEl.style.setProperty('--bgm-misc-seek-pct', '0%');
            timeLabelEl.textContent = `0:00 / 0:00`;
        }
    }

    audioEl.addEventListener('loadedmetadata', updateSeekUI);
    audioEl.addEventListener('timeupdate', updateSeekUI);
    audioEl.addEventListener('emptied', updateSeekUI);

    seekEl.addEventListener('input', () => player.seekTo(seekEl.valueAsNumber));

    // ---- Volume wiring ----
    let lastNonZeroVolume = audioEl.volume > 0 ? audioEl.volume : 0.1;
    volumeSliderEl.value = String(audioEl.volume);
    volumeSliderEl.addEventListener('input', () => {
        const v = volumeSliderEl.valueAsNumber;
        if (v > 0) lastNonZeroVolume = v;
        player.setVolume(v);
    });
    muteBtn.addEventListener('click', () => {
        const cur = player.getVolume();
        if (cur > 0) {
            lastNonZeroVolume = cur;
            player.setVolume(0);
        } else {
            player.setVolume(lastNonZeroVolume || 0.1);
        }
    });

    // ---- Toast ----
    let toastTimer = 0;
    function showToast(message) {
        toastEl.textContent = message;
        toastEl.classList.add('is-visible');
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => {
            toastEl.classList.remove('is-visible');
        }, 1500);
    }
    // Click on the bar background (not on a button, canvas, or slider) toggles drawer.
    barEl.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        if (e.target.closest('.bgm-misc-visualizer')) return;
        if (e.target.closest('input[type="range"]')) return;
        toggleDrawer();
    });
    clearBtn.addEventListener('click', () => {
        if (window.confirm('재생 목록을 비우시겠습니까?')) player.clearQueue();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !drawerEl.hidden) toggleDrawer();
    });

    function toggleDrawer() {
        const open = drawerEl.hidden;
        drawerEl.hidden = !open;
        drawerToggleBtn.setAttribute('aria-expanded', String(open));
        drawerToggleBtn.setAttribute('aria-label', open ? '재생 목록 닫기' : '재생 목록 열기');
    }

    // ---- Player → UI sync ----
    player.on('state-change', renderPlayerState);
    player.on('queue-change', () => {
        renderQueue();
        renderRowFavoriteStates();
    });
    player.on('track-change', () => {
        // Re-disable seek bar until new metadata loads (duration may still
        // be the previous track's value until 'loadedmetadata' fires).
        seekEl.disabled = true;
        seekEl.value = 0;
        seekEl.style.setProperty('--bgm-misc-seek-pct', '0%');
        timeLabelEl.textContent = '0:00 / 0:00';
        renderPlayerState();
        renderQueue();
        syncRowPlayingStates();
    });
    player.on('state-change', syncRowPlayingStates);

    function renderPlayerState() {
        const playing = player.isPlaying();
        const current = player.getCurrentTrack();
        const mode = player.getMode();

        playPauseBtn.setAttribute('aria-label', playing ? '일시정지' : '재생');
        playPauseBtn.setAttribute('aria-pressed', String(playing));

        if (current) {
            const label = `${current.stem} · ${current.cue}`;
            nowLabelEl.textContent = mode === 'preview' ? `미리듣기 · ${label}` : label;
            revealBar();
        } else {
            nowLabelEl.textContent = '-';
        }

        const inQueue = mode === 'queue';
        prevBtn.disabled = !inQueue;
        nextBtn.disabled = !inQueue;

        shuffleBtn.setAttribute('aria-pressed', String(player.isShuffle()));
        shuffleBtn.setAttribute('aria-label', player.isShuffle() ? '셔플 켬' : '셔플 끔');
        shuffleBtn.classList.toggle('is-on', player.isShuffle());

        const rep = player.getRepeat();
        repeatBtn.dataset.mode = rep;
        repeatBtn.setAttribute('aria-label', `반복 ${({ off: '끔', all: '전체', single: '한 곡' })[rep]}`);
        repeatBtn.setAttribute('aria-pressed', String(rep !== 'off'));
        repeatBtn.classList.toggle('is-on', rep !== 'off');

        // Volume + mute sync
        const vol = player.getVolume();
        volumeSliderEl.value = String(vol);
        muteBtn.setAttribute('aria-pressed', String(vol === 0));
        muteBtn.setAttribute('aria-label', vol === 0 ? '음소거 해제' : '음소거');

        if (playing) viz.start(); else viz.stop();
    }

    function renderQueue() {
        const q = player.getQueue();
        queueCountEl.textContent = String(q.length);
        const current = player.getCurrentTrack();
        const currentId = current ? current.id : null;
        const inQueueMode = player.getMode() === 'queue';

        queueListEl.replaceChildren();
        q.forEach((t, i) => {
            const li = document.createElement('li');
            li.className = 'bgm-misc-queue-item';
            if (inQueueMode && t.id === currentId) li.classList.add('is-current');

            const marker = document.createElement('span');
            marker.className = 'bgm-misc-queue-marker';
            marker.textContent = (inQueueMode && t.id === currentId) ? '▶' : `${i + 1}.`;

            const name = document.createElement('span');
            name.className = 'bgm-misc-queue-name';
            name.textContent = `${t.stem} · ${t.cue}`;

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'bgm-misc-queue-remove';
            remove.textContent = '✕';
            remove.setAttribute('aria-label', '재생목록에서 제거');
            remove.addEventListener('click', (e) => {
                e.stopPropagation();
                player.toggleFavorite(t);  // toggling a favorited track removes it
            });

            li.append(marker, name, remove);
            li.addEventListener('click', () => player.playQueueAt(i));
            queueListEl.appendChild(li);
        });
    }

    function renderRowFavoriteStates() {
        for (const r of rows) {
            const favs = r.el.querySelectorAll('.bgm-misc-fav');
            favs.forEach(btn => {
                const id = btn.dataset.trackId;
                const on = player.isFavorited(id);
                btn.setAttribute('aria-pressed', String(on));
                btn.textContent = on ? '♥' : '♡';
                btn.setAttribute('aria-label', on ? '재생목록에서 제거' : '재생목록에 추가');
            });
        }
    }

    function syncRowPlayingStates() {
        const current = player.getCurrentTrack();
        const playing = player.isPlaying();
        const inPreview = player.getMode() === 'preview';
        document.querySelectorAll('.bgm-misc-play').forEach(btn => {
            btn.classList.remove('playing');
        });
        if (current && inPreview && playing) {
            const escapedId = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(current.id) : current.id;
            for (const fav of document.querySelectorAll(`.bgm-misc-fav[data-track-id="${escapedId}"]`)) {
                const btn = fav.parentElement?.querySelector('.bgm-misc-play');
                if (btn) btn.classList.add('playing');
            }
        }
    }

    // ---- Row construction ----
    function makeStemRow(stem, album) {
        const li = document.createElement('li');
        li.className = 'bgm-misc-row';

        const header = document.createElement('div');
        header.className = 'bgm-misc-row-header';

        const titles = document.createElement('div');
        titles.className = 'bgm-misc-titles';
        const stemLabel = document.createElement('span');
        stemLabel.className = 'bgm-misc-stem';
        stemLabel.textContent = stem;
        titles.appendChild(stemLabel);
        if (album.cues && album.cues.length > 0) {
            const cueLine = document.createElement('span');
            cueLine.className = 'bgm-misc-cue-line';
            cueLine.textContent = album.cues[0];
            titles.appendChild(cueLine);
        }

        const trackCount = document.createElement('span');
        trackCount.className = 'bgm-misc-count';
        if (album.tracks.length > 1) {
            trackCount.textContent = `${album.tracks.length}개의 트랙`;
        }

        header.append(titles, trackCount);
        li.appendChild(header);

        if (album.tracks.length === 1) {
            const t = album.tracks[0];
            const id = trackId(stem, t.cue);
            header.appendChild(makeFavBtn(id));
            header.appendChild(makePreviewBtn({ id, stem, cue: t.cue, url: t.music_link }));
        } else {
            const inner = document.createElement('ol');
            inner.className = 'bgm-misc-tracks';
            for (const t of album.tracks) {
                const id = trackId(stem, t.cue);
                const trackLi = document.createElement('li');
                const label = document.createElement('span');
                label.className = 'bgm-misc-cue-name';
                label.textContent = t.cue;
                trackLi.append(
                    label,
                    makeFavBtn(id),
                    makePreviewBtn({ id, stem, cue: t.cue, url: t.music_link })
                );
                inner.appendChild(trackLi);
            }
            li.appendChild(inner);

            inner.hidden = true;
            makeKeyboardActivatable(header, () => {
                inner.hidden = !inner.hidden;
                header.setAttribute('aria-expanded', String(!inner.hidden));
            });
            header.setAttribute('role', 'button');
            header.setAttribute('aria-expanded', 'false');
            header.tabIndex = 0;
        }
        return li;
    }

    function makeFavBtn(id) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bgm-misc-fav';
        btn.dataset.trackId = id;
        const initial = player.isFavorited(id);
        btn.textContent = initial ? '♥' : '♡';
        btn.setAttribute('aria-pressed', String(initial));
        btn.setAttribute('aria-label', initial ? '재생목록에서 제거' : '재생목록에 추가');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const track = trackIndex.get(id);
            if (track) player.toggleFavorite(track);
        });
        return btn;
    }

    function makePreviewBtn(track) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bgm-misc-play';
        btn.innerHTML = PREVIEW_BTN_ICONS;
        btn.setAttribute('aria-label', `미리듣기: ${track.cue}`);
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            // If this track is the active preview, toggle play/pause on it.
            const current = player.getCurrentTrack();
            if (current && current.id === track.id && player.getMode() === 'preview') {
                player.togglePlayPause();
                return;
            }
            player.preview(track);
        });
        return btn;
    }

    // Initial render.
    renderPlayerState();
    renderQueue();
    renderRowFavoriteStates();
    updateSeekUI();
    if (player.getQueue().length > 0) revealBar();

    function makeMessage(text) {
        const li = document.createElement('li');
        li.className = 'bgm-misc-message';
        li.textContent = text;
        return li;
    }
});
