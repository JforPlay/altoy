/**
 * event-story.js
 * Page entry for the 이벤트 스토리 archive. Configures the shared StoryViewer
 * engine with event-archive data sources and supplies a year-sectioned,
 * chip-filtered index renderer via the engine's config.renderEventGrid hook.
 */
import { resolveUrl, renderStatus } from '../utils.js';
import { groupAndFilterEvents } from './event-story.filter.js';
import { setupFactionFilter } from './faction-filter.js';

// The game's own subtype labels (gametip memory_actiivty_ex / _sp / _daily).
const SUBTYPE_LABEL = { 1: 'E.X.', 2: 'S.P.', 3: '데일리' };
// Chibi covers for events without banner art. Every E.X. event has real art,
// so only S.P./데일리 need one (unknown subtypes default to the S.P. cover).
const PLACEHOLDER_COVER = {
    2: 'assets/img/story_cover_placeholder1.webp', // S.P.
    3: 'assets/img/story_cover_placeholder2.webp', // 데일리
};
const filterState = { subtypes: [], factions: [] };

const rerender = () =>
    window.StoryViewer.populateEventGrid(document.getElementById('search-bar')?.value || '');

function subtitleFor(ev) {
    return ev.dateRange || ev.description || '';
}

/** Render the year-sectioned, filtered event index into #event-grid. */
function renderEventGrid(viewer, searchTerm) {
    const grid = viewer.elements.eventGrid;
    grid.textContent = '';

    const records = Object.values(viewer.storylineData || {});
    if (records.length === 0) {
        for (let i = 0; i < 6; i++) grid.appendChild(viewer.createSkeletonCard());
        return;
    }

    const groups = groupAndFilterEvents(records, {
        search: searchTerm,
        subtypes: filterState.subtypes,
        factions: filterState.factions,
    });

    if (groups.length === 0) {
        renderStatus(grid, '조건에 맞는 이벤트가 없습니다.', 'empty');
        return;
    }

    for (const g of groups) {
        const section = document.createElement('section');
        section.className = 'event-year-section';

        const heading = document.createElement('h2');
        heading.className = 'section-title';
        heading.textContent = g.label;

        const cardGrid = document.createElement('div');
        cardGrid.className = 'card-grid card-grid--fit';

        for (const ev of g.events) {
            const specialLink = viewer.config.getEventLink ? viewer.config.getEventLink(ev) : null;
            const card = viewer.createCard(
                ev.name,
                subtitleFor(ev),
                ev.icon,
                viewer.config.getEventIconPath(ev),
                () => {
                    if (specialLink) { window.location.href = specialLink; return; }
                    viewer.selectEvent(ev.id);
                },
                ev.id
            );

            if (!ev.icon) {
                const thumb = card.querySelector('.card-thumbnail');
                if (thumb) {
                    thumb.classList.add('cover-placeholder');
                    const cover = PLACEHOLDER_COVER[ev.subtype] || PLACEHOLDER_COVER[2];
                    thumb.style.backgroundImage = `url("${resolveUrl(cover)}")`;
                }
            }

            const badge = document.createElement('span');
            badge.className = 'badge badge--info event-subtype-badge';
            badge.textContent = [SUBTYPE_LABEL[ev.subtype], specialLink ? '메인스토리' : '']
                .filter(Boolean).join(' · ');
            card.querySelector('.card-content')?.appendChild(badge);
            if (specialLink) card.classList.add('event-deeplink');

            cardGrid.appendChild(card);
        }

        section.append(heading, cardGrid);
        grid.appendChild(section);
    }

    ensureFactionFilter(records);
}

/** One-time wiring of the shared 진영 필터 dropdown from the loaded records. */
let factionFilterReady = false;
function ensureFactionFilter(records) {
    if (factionFilterReady) return;
    const button = document.getElementById('filter-button');
    const panel = document.getElementById('filter-panel');
    if (!button || !panel) return;
    // 'X' is the timeline curator's no-faction placeholder — not a real 진영.
    const factions = [...new Set(records.map(r => r.faction).filter(f => f && f !== 'X'))].sort();
    setupFactionFilter({
        button,
        panel,
        badge: document.getElementById('filter-badge'),
        options: factions.map(f => ({ value: f, label: f })),
        onChange: (selected) => {
            filterState.factions = selected;
            rerender();
        },
    });
    factionFilterReady = true;
}

document.addEventListener('DOMContentLoaded', () => {
    const config = {
        viewerType: 'event',
        dataPaths: [
            'data/story-viewer/event_story_index.json',
            'data/story-viewer/shipgirl_data.json',
        ],
        chapterDataPath: 'data/story-viewer/event_story_chunks/chunk_{id}.json',
        processLoadedData: (viewer, dataArray) => {
            viewer.storylineData = dataArray[0];
            viewer.shipgirlData = dataArray[1];
        },
        getEventMemories: (eventData) => eventData?.memory_id,
        findMemory: (eventData, storyId) => eventData?.memory_id?.find(m => m.id == storyId),
        getMemoryStory: (memoryData) => memoryData?.story,
        // Event icons are BASE_URL-relative paths WITH folder (deeplink majors:
        // memorystoryline/<banner>; inline: a distinctive bg/<mask>; '' -> placeholder).
        getEventIconPath: () => window.StoryViewer.BASE_URL,
        getEventLink: (eventData) => {
            if (eventData?.route !== 'deeplink') return null;
            // resolveUrl → site base (/altoy/…), NOT StoryViewer.BASE_URL (asset CDN).
            const path = eventData.deeplinkPath || 'story-viewer/main-story/';
            const q = eventData.deeplinkEventId != null ? `?eventid=${eventData.deeplinkEventId}` : '';
            return `${resolveUrl(path)}${q}`;
        },
        renderEventGrid,
    };

    window.StoryViewer.init(config);

    // Filter chips + 진영 필터 re-render through the same engine entry point.
    document.querySelectorAll('[data-subtype-chip]').forEach((chip) => {
        chip.addEventListener('click', () => {
            const st = Number(chip.dataset.subtypeChip);
            const i = filterState.subtypes.indexOf(st);
            if (i >= 0) filterState.subtypes.splice(i, 1); else filterState.subtypes.push(st);
            const active = chip.classList.toggle('active');
            chip.setAttribute('aria-pressed', String(active));
            rerender();
        });
    });
});
