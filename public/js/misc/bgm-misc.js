/**
 * bgm-misc.js
 * Renders BGM stems unreferenced by any album in bgm_data.json. Each
 * stem is a synthetic album (single-cue stems render as 1-track albums).
 * One shared <audio> element; rows are expandable.
 */
import { fetchJSON, makeKeyboardActivatable, requireElements } from '../utils.js';

document.addEventListener('DOMContentLoaded', async () => {
    const listEl = document.getElementById('bgm-misc-list');
    const audioEl = document.getElementById('bgm-misc-audio');
    const searchEl = document.getElementById('bgm-misc-search');
    const countEl = document.getElementById('bgm-misc-search-count');
    if (!requireElements({ listEl, audioEl, searchEl, countEl }, 'BGM misc page')) return;

    audioEl.volume = 0.1;
    let currentBtn = null;

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

    // Stable row references for filtering. Search needles cover stem +
    // every cue name (lowercased once at build time so the keystroke path
    // stays cheap).
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

    let searchTimer = 0;
    searchEl.addEventListener('input', () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(applyFilter, 80);
    });

    function applyFilter() {
        const q = searchEl.value.trim().toLowerCase();
        let shown = 0;
        if (!q) {
            for (const r of rows) {
                r.el.hidden = false;
                shown++;
            }
        } else {
            for (const r of rows) {
                const match = r.needle.includes(q);
                r.el.hidden = !match;
                if (match) shown++;
            }
        }
        updateCount(shown, rows.length);
    }

    function updateCount(shown, total) {
        countEl.textContent = shown === total ? `${total}` : `${shown} / ${total}`;
    }

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

        // Cue line: original stream-name metadata (the "real" track title set
        // by the sound designer — often Japanese/Chinese/French). For
        // multi-cue stems show only the first cue here; the expanded list
        // renders the rest.
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
            const play = makePlayBtn(t.cue, t.music_link);
            header.appendChild(play);
        } else {
            const inner = document.createElement('ol');
            inner.className = 'bgm-misc-tracks';
            for (const t of album.tracks) {
                const trackLi = document.createElement('li');
                const label = document.createElement('span');
                label.className = 'bgm-misc-cue-name';
                label.textContent = t.cue;
                trackLi.appendChild(label);
                trackLi.appendChild(makePlayBtn(t.cue, t.music_link));
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

    function makePlayBtn(cue, url) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bgm-misc-play';
        btn.textContent = '▶';
        btn.setAttribute('aria-label', `재생: ${cue}`);
        btn.addEventListener('click', (e) => {
            // Prevent expand toggle when clicking the play button on the header.
            e.stopPropagation();
            if (currentBtn === btn && !audioEl.paused) {
                audioEl.pause();
                resetBtn(btn);
                return;
            }
            if (currentBtn) resetBtn(currentBtn);
            currentBtn = btn;
            btn.textContent = '⏸';
            btn.classList.add('playing');
            audioEl.src = url;
            audioEl.play().catch(err => {
                console.error('playback failed for', url, err);
                resetBtn(btn);
                currentBtn = null;
            });
        });
        return btn;
    }

    function resetBtn(btn) {
        btn.textContent = '▶';
        btn.classList.remove('playing');
    }

    audioEl.addEventListener('ended', () => {
        if (currentBtn) {
            resetBtn(currentBtn);
            currentBtn = null;
        }
    });

    function makeMessage(text) {
        const li = document.createElement('li');
        li.className = 'bgm-misc-message';
        li.textContent = text;
        return li;
    }
});
