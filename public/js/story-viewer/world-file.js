/**
 * world-file.js
 * Text-based "world file" (Operation Siren intel documents) viewer.
 * Renders a thumbnail gallery on the left; clicking an entry loads its
 * paragraphs into the content area on the right. Includes font-size controls.
 */
import { fetchJSON, resolveUrl, makeKeyboardActivatable } from '../utils.js';

document.addEventListener('DOMContentLoaded', () => {
    const galleryContainer = document.getElementById('gallery-container');
    const contentContainer = document.getElementById('content-container');

    /**
     * Build the gallery list from loaded data.
     * Each entry gets a background image from the local assets folder.
     */
    function initialize(data) {
        galleryContainer.textContent = '';

        for (const key in data) {
            const itemData = data[key];
            const galleryItem = document.createElement('div');
            galleryItem.className = 'gallery-item';
            galleryItem.setAttribute('aria-pressed', 'false');
            galleryItem.style.backgroundImage = `url('${resolveUrl(`assets/img/${itemData.id_2}.webp`)}')`;

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
