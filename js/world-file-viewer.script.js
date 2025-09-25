document.addEventListener('DOMContentLoaded', () => {
    const galleryContainer = document.getElementById('gallery-container');
    const contentContainer = document.getElementById('content-container');

    /**
     * Creates and populates the gallery on the left side of the screen.
     * @param {object} data - The parsed JSON data containing the story worlds.
     */
    function initialize(data) {
        galleryContainer.innerHTML = ''; 

        for (const key in data) {
            const itemData = data[key];
            const galleryItem = document.createElement('div');
            galleryItem.className = 'gallery-item';
            galleryItem.style.backgroundImage = `url('assets/img/${itemData.id_2}.png')`;

            const itemName = document.createElement('div');
            itemName.className = 'gallery-item-name';
            itemName.textContent = key;

            galleryItem.appendChild(itemName);
            
            galleryItem.addEventListener('click', () => {
                const currentActive = document.querySelector('.gallery-item.active');
                if (currentActive) {
                    currentActive.classList.remove('active');
                }
                galleryItem.classList.add('active');

                displayContent(itemData.child);

                // ✨ Auto-scroll on mobile devices
                if (window.innerWidth <= 768) {
                    contentContainer.scrollIntoView({ behavior: 'smooth' });
                }
            });

            galleryContainer.appendChild(galleryItem);
        }
    }

    /**
     * Displays the story content for a selected item in the main content area.
     * @param {Array<object>} childData - The list of paragraphs for the selected story.
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
            content.innerHTML = paragraph.content.replace(/\n/g, '<br>');
            paragraphContainer.appendChild(content);

            contentContainer.appendChild(paragraphContainer);
        });
        
        contentContainer.scrollTop = 0;
    }

    /**
     * Sets up the theme switcher logic.
     */
    function setupThemeSwitcher() {
        const themeToggle = document.getElementById('theme-toggle');
        
        themeToggle.addEventListener('change', () => {
            contentContainer.classList.toggle('dark-mode', themeToggle.checked);
        });
    }

    /**
     * ✨ Sets up the font size control logic.
     */
    function setupFontControls() {
        const fontIncreaseBtn = document.getElementById('font-increase');
        const fontDecreaseBtn = document.getElementById('font-decrease');
        
        let currentFontSize = 16; // Base font size in pixels
        const step = 1;
        const minSize = 12;
        const maxSize = 22;

        const updateFontSize = () => {
            // We apply the font size to the container, and paragraphs with `em` units will scale.
            contentContainer.style.fontSize = `${currentFontSize}px`;
        };

        // Set initial font size
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

    // --- Main Execution ---
    fetch('data/processed_world_collection_data.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            initialize(data);
            setupThemeSwitcher();
            setupFontControls(); // Initialize the new font controls
        })
        .catch(error => {
            console.error('Error loading world data:', error);
            contentContainer.innerHTML = `<div class="placeholder" style="color: red;">
                <strong>Error:</strong> 스토리 데이터 파일을 불러올 수 없습니다..<br>
            </div>`;
        });
});