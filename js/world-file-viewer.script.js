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
            // Set the background image, assuming images are in an 'assets' folder
            galleryItem.style.backgroundImage = `url('assets/${itemData.id_2}.png')`;

            const itemName = document.createElement('div');
            itemName.className = 'gallery-item-name';
            itemName.textContent = key;

            galleryItem.appendChild(itemName);
            
            // Add click event listener to show content and highlight the item
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
        contentContainer.innerHTML = ''; // Clear previous content

        childData.forEach(paragraph => {
            const paragraphContainer = document.createElement('div');
            paragraphContainer.className = 'content-paragraph';

            // Create and append the title (h2)
            const title = document.createElement('h2');
            title.textContent = paragraph.name;
            paragraphContainer.appendChild(title);

            // Create and append the subtitle (h3) if it exists
            if (paragraph.subTitle && paragraph.subTitle.trim() !== '') {
                const subTitle = document.createElement('h3');
                subTitle.textContent = paragraph.subTitle;
                paragraphContainer.appendChild(subTitle);
            }

            // Create and append the main content (p), replacing newline characters
            const content = document.createElement('p');
            content.innerHTML = paragraph.content.replace(/\n/g, '<br>');
            paragraphContainer.appendChild(content);

            contentContainer.appendChild(paragraphContainer);
        });
        
        // Scroll to the top of the content area for better user experience
        contentContainer.scrollTop = 0;
    }

    // --- Main Execution ---
    // Fetch the JSON data file from the server.
    fetch('data/processed_world_collection_data.json')
        .then(response => {
            // Check if the request was successful
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            initialize(data); // If data is loaded successfully, initialize the page
        })
        .catch(error => {
            // If an error occurs (e.g., file not found), display an error message
            console.error('Error loading world data:', error);
            contentContainer.innerHTML = `<div class="placeholder" style="color: red;">
                <strong>Error:</strong> Could not load the story data file.<br>
                Please ensure 'processed_world_collection_data.json' is in the same folder as the HTML file and that the server is running correctly.
            </div>`;
        });
});