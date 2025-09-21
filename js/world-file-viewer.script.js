document.addEventListener('DOMContentLoaded', () => {
    const galleryContainer = document.getElementById('gallery-container');
    const contentContainer = document.getElementById('content-container');

    /**
     * Creates and populates the gallery on the left side of the screen.
     * @param {object} data - The parsed JSON data containing the story worlds.
     */
    function initialize(data) {
        galleryContainer.innerHTML = ''; // Clear any existing gallery items

        for (const key in data) {
            const itemData = data[key];
            const galleryItem = document.createElement('div');
            galleryItem.className = 'gallery-item';
            galleryItem.style.backgroundImage = `url('assets/${itemData.id_2}.png')`;

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
            });

            galleryContainer.appendChild(galleryItem);
        }
    }

    /**
     * Displays the story content for a selected item in the main content area.
     * @param {Array<object>} childData - The list of paragraphs for the selected story.
     */
    function displayContent(childData) {
        contentContainer.querySelector('.placeholder')?.remove(); // Remove placeholder on first click
        // Clear previous content if any
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
     * ✨ Sets up the theme switcher logic.
     */
    function setupThemeSwitcher() {
        const themeToggle = document.getElementById('theme-toggle');
        
        themeToggle.addEventListener('change', () => {
            if (themeToggle.checked) {
                contentContainer.classList.add('dark-mode');
            } else {
                contentContainer.classList.remove('dark-mode');
            }
        });
    }

    // --- Main Execution ---
    fetch('processed_world_collection_data.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            initialize(data); // Initialize the gallery
            setupThemeSwitcher(); // Setup the theme toggle switch
        })
        .catch(error => {
            console.error('Error loading world data:', error);
            contentContainer.innerHTML = `<div class="placeholder" style="color: red;">
                <strong>Error:</strong> Could not load the story data file.<br>
                Please ensure 'processed_world_collection_data.json' is in the same folder as the HTML file and that the server is running correctly.
            </div>`;
        });
});