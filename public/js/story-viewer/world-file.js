/**
 * world-file.js
 * Text-based "world file" (Operation Siren intel documents) viewer.
 * Renders a thumbnail gallery on the left; clicking an entry loads its
 * paragraphs into the content area on the right. Includes font-size controls.
 */
import { fetchJSON, resolveUrl, dataForToyUrl, createImgElement, makeKeyboardActivatable } from '../utils.js';

// Cover art comes from two places. The 24 hand-sourced 477x508 document cards in
// assets/img/ have NO game equivalent, and that is settled rather than unsearched:
// the client composes its own card from two generic atlas frames picked by the
// group's `type`, plus the title banner and two text fields (KR
// worldmediacollectionfilegrouplayer.lua, OnUpdateFileGroup). So there is no
// per-group cover to extract and the hand cards stay -- the client ships only the
// title banner (collectionfiletitle) and the per-document illustration
// (collectionfileillustration). The cards now cover every group through id_2 190
// (2026-09-22: four drawn for the 2025-12-18 groups, which had been falling back).
// A group ABOVE this line has no card yet and falls back to the game's own title
// art, keyed by `t` (the config's name_abbreviate) -- so a new 문서 group is never
// a blank tile. Raise LAST_CARD_ID when a card is drawn for it; the fallback needs
// no other change, and `.gallery-item.banner` exists for exactly that window.
const LAST_CARD_ID = 190;

document.addEventListener('DOMContentLoaded', () => {
    const galleryContainer = document.getElementById('gallery-container');
    const contentContainer = document.getElementById('content-container');

    /**
     * Build the gallery list from loaded data.
     * Each entry gets a hand-sourced card, or the game's title banner (see
     * LAST_CARD_ID); a group with neither renders as a plain named card.
     */
    function initialize(data) {
        galleryContainer.textContent = '';

        for (const key in data) {
            const itemData = data[key];
            const galleryItem = document.createElement('div');
            galleryItem.className = 'gallery-item';
            galleryItem.setAttribute('aria-pressed', 'false');
            const groupId = Number(itemData.id_2);
            const isCard = Number.isNaN(groupId) || groupId <= LAST_CARD_ID; // hanazuki is hand-made too
            const art = isCard
                ? resolveUrl(`assets/img/${itemData.id_2}.webp`)
                : (itemData.t ? dataForToyUrl(`collectionfiletitle/${itemData.t}.webp`) : '');
            if (art) {
                galleryItem.style.backgroundImage = `url('${art}')`;
                if (!isCard) galleryItem.classList.add('banner'); // contain, not cover: a ~176x66 strip
            }

            const itemName = document.createElement('div');
            itemName.className = 'gallery-item-name';
            itemName.textContent = key;

            galleryItem.appendChild(itemName);

            makeKeyboardActivatable(galleryItem, () => {
                const currentActive = document.querySelector('.gallery-item.active');
                if (currentActive) {
                    currentActive.classList.remove('active');
                    currentActive.setAttribute('aria-pressed', 'false');
                }
                galleryItem.classList.add('active');
                galleryItem.setAttribute('aria-pressed', 'true');

                displayContent(itemData.child);

                if (window.innerWidth <= 768) { // auto-scroll to content on narrow screens
                    contentContainer.scrollIntoView({ behavior: 'smooth' });
                }
            });

            galleryContainer.appendChild(galleryItem);
        }
    }

    /**
     * Render the paragraphs of a selected world entry into the content area.
     * Preserves newlines with <br> and supports an optional subtitle per paragraph.
     * `pic` (the config's own field) is written only for documents whose
     * illustration was actually extracted, so it never points at a 404.
     */
    function displayContent(childData) {
        contentContainer.querySelector('.placeholder')?.remove();
        
        const paragraphs = contentContainer.querySelectorAll('.content-paragraph');
        paragraphs.forEach(p => p.remove());

        childData.forEach(paragraph => {
            const paragraphContainer = document.createElement('div');
            paragraphContainer.className = 'content-paragraph';

            const title = document.createElement('h2');
            title.textContent = paragraph.name;
            paragraphContainer.appendChild(title);

            if (paragraph.subTitle && paragraph.subTitle.trim() !== '') {
                const subTitle = document.createElement('h3');
                subTitle.textContent = paragraph.subTitle;
                paragraphContainer.appendChild(subTitle);
            }

            const content = document.createElement('p');
            String(paragraph.content || '').split('\n').forEach((line, index) => {
                if (index > 0) content.appendChild(document.createElement('br'));
                content.appendChild(document.createTextNode(line));
            });
            paragraphContainer.appendChild(content);

            if (paragraph.pic) {
                paragraphContainer.appendChild(createImgElement(
                    dataForToyUrl(`collectionfileillustration/${paragraph.pic}.webp`),
                    paragraph.name || '',
                    { className: 'content-illustration' }
                ));
            }

            contentContainer.appendChild(paragraphContainer);
        });
        
        contentContainer.scrollTop = 0;
    }

    /**
     * Wire the font-size +/- buttons. Applies size to the container so
     * paragraph text in em units scales automatically.
     */
    function setupFontControls() {
        const fontIncreaseBtn = document.getElementById('font-increase');
        const fontDecreaseBtn = document.getElementById('font-decrease');
        if (!fontIncreaseBtn || !fontDecreaseBtn) return;

        let currentFontSize = 16;
        const step = 1;
        const minSize = 12;
        const maxSize = 22;

        const updateFontSize = () => {
            contentContainer.style.fontSize = `${currentFontSize}px`;
        };

        updateFontSize();

        fontIncreaseBtn.addEventListener('click', () => {
            if (currentFontSize < maxSize) {
                currentFontSize += step;
                updateFontSize();
            }
        });

        fontDecreaseBtn.addEventListener('click', () => {
            if (currentFontSize > minSize) {
                currentFontSize -= step;
                updateFontSize();
            }
        });
    }

    // LIVE again (2026-09-22): story_world_file_collection.py is back in WSL §8.
    // It had been archived as frozen, but only the world STORY half is dead -- the
    // 대작전 문서 collection still gets content (last drop 2025-12-18), and this page
    // served a 2026-02-15 copy for seven months because the processor wrote the repo
    // ROOT instead of story-viewer/, so its output never arrived. The revived one
    // MERGES (하나즈키 요약 is hand-made and the config has never produced it) and
    // emits `t` (name_abbreviate -> title banner) + `pic` itself, so a re-run
    // reproduces this file byte for byte. Its sibling world_story_data.json IS
    // still frozen, and correct -- see world-story.js.
    fetchJSON('data/story-viewer/world_collection_data.json')
        .then(data => {
            initialize(data);
            setupFontControls();
        })
        .catch(error => {
            console.error('Error loading world data:', error);
            contentContainer.textContent = '';
            const errorMessage = document.createElement('div');
            errorMessage.className = 'placeholder';
            errorMessage.style.color = 'red';
            const label = document.createElement('strong');
            label.textContent = 'Error:';
            errorMessage.append(label, document.createTextNode(' 스토리 데이터 파일을 불러올 수 없습니다.'));
            contentContainer.appendChild(errorMessage);
        });
});
