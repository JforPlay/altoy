/**
 * event-story.js
 * Page entry for the 이벤트 스토리 archive. Configures the shared StoryViewer
 * engine with event-archive data sources and supplies a year-sectioned,
 * chip-filtered index renderer via the engine's config.renderEventGrid hook.
 */
import { resolveUrl } from '../utils.js';
import { groupAndFilterEvents } from './event-story.filter.js';

// The game's own subtype labels (gametip memory_actiivty_ex / _sp / _daily).
const SUBTYPE_LABEL = { 1: 'E.X.', 2: 'S.P.', 3: '데일리' };
const filterState = { subtypes: [], faction: '' };

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
        faction: filterState.faction,
    });

    if (groups.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'page-status page-status--empty';
        empty.textContent = '조건에 맞는 이벤트가 없습니다.';
        grid.appendChild(empty);
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

            const badge = document.createElement('span');
            badge.className = 'badge badge-info event-subtype-badge';
            badge.textContent = [SUBTYPE_LABEL[ev.subtype], specialLink ? '메인스토리' : '']
                .filter(Boolean).join(' · ');
            card.querySelector('.card-content')?.appendChild(badge);
            if (specialLink) card.classList.add('event-deeplink');

            cardGrid.appendChild(card);
        }

        section.append(heading, cardGrid);
        grid.appendChild(section);
    }

    populateFactionOptions(records);
}

/** One-time fill of the faction <select> from the loaded records. */
let factionFilled = false;
function populateFactionOptions(records) {
    if (factionFilled) return;
    const sel = document.getElementById('faction-filter');
    if (!sel) return;
    const factions = [...new Set(records.map(r => r.faction).filter(Boolean))].sort();
    for (const f of factions) {
        const opt = document.createElement('option');
        opt.value = f; opt.textContent = f;
        sel.appendChild(opt);
    }
    factionFilled = true;
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

    // Filter chips + faction select re-render through the same engine entry point.
    const rerender = () => window.StoryViewer.populateEventGrid(document.getElementById('search-bar')?.value || '');

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

    const factionSel = document.getElementById('faction-filter');
    factionSel?.addEventListener('change', () => { filterState.faction = factionSel.value; rerender(); });
});
