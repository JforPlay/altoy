/**
 * Juustagram Viewer - Instagram-style social media post viewer for Azur Lane
 * Displays posts from shipgirls with filtering, comments, and commander interactions
 */
document.addEventListener('DOMContentLoaded', () => {
    // ============================================================================
    // DOM ELEMENT REFERENCES
    // ============================================================================
    const galleryView = document.getElementById('gallery-view');
    const postDisplayContainer = document.getElementById('post-display');
    const authorSearchInput = document.getElementById('author-search');
    const authorDropdown = document.getElementById('author-dropdown');
    const mentionedSearchInput = document.getElementById('mentioned-search');
    const mentionedDropdown = document.getElementById('mentioned-dropdown');
    const clearFiltersBtn = document.getElementById('clear-filters-btn');

    // ============================================================================
    // DATA STORAGE
    // ============================================================================
    let postsData = {};              // Main posts data from juustagram_data.json
    let shipgirlDataMap = {};        // Shipgirl metadata (names, icons) from ship_group_data.json
    let shipgroupTemplateMap = {};   // Template data for usernames from external API

    // Placeholder icon for unknown/missing shipgirls (gray circle SVG)
    const placeholderIcon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23e0e0e0'/%3E%3C/svg%3E";

    // ============================================================================
    // IMAGE PREVIEW SETUP
    // ============================================================================
    // Create hover preview element that follows mouse cursor over gallery thumbnails
    const imagePreview = document.createElement('img');
    imagePreview.id = 'image-preview';
    document.body.appendChild(imagePreview);

    // ============================================================================
    // DATA FETCHING & INITIALIZATION
    // ============================================================================
    /**
     * Fetch all required data sources in parallel:
     * 1. juustagram_data.json - Post content, images, comments
     * 2. ship_group_data.json - Shipgirl names and icons
     * 3. External API - Username templates from AzurLaneTools
     */
    Promise.all([
        fetch('data/juustagram_data.json').then(res => res.json()),
        fetch('data/ship_group_data.json').then(res => res.json()),
        fetch('https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/CN/ShareCfg/activity_ins_ship_group_template.json').then(res => res.json())
    ])
        .then(([posts, shipgirlData, templateData]) => {
            // Store fetched data in module-level variables
            postsData = posts;
            shipgirlDataMap = shipgirlData;
            shipgroupTemplateMap = templateData;

            // Initialize filter dropdowns with available options
            initializeFilters();

            // Populate gallery with all posts (no filters applied initially)
            populateGallery();
        })
        .catch(error => {
            console.error('Error fetching data:', error);
            galleryView.innerHTML = `<p>데이터를 불러오는 데 실패했습니다. 모든 .json 파일이 있는지 확인해주세요.</p>`;
        });

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    /**
     * Retrieve shipgirl display data by ID
     * Combines data from multiple sources to create complete shipgirl info
     *
     * @param {number|string} id - Shipgirl ID or unknown identifier
     * @returns {Object} Object containing name, icon URL, and username
     */
    function getShipgirlData(id) {
        const shipData = shipgirlDataMap[id];
        const templateData = shipgroupTemplateMap[id];

        // If shipgirl data exists, combine with template data
        if (shipData) {
            return {
                name: shipData.name.trim(),
                icon: shipData.icon,
                username: templateData ? `@${templateData.name}` : ''
            };
        }

        // Handle unknown IDs that are already marked as such
        if (typeof id === 'string' && id.startsWith('Unknown')) {
            return { name: id, icon: placeholderIcon, username: '' };
        }

        // Fallback for completely unknown IDs
        return { name: `Unknown ID: ${id}`, icon: placeholderIcon, username: '' };
    }

    // ============================================================================
    // FILTER INITIALIZATION & LOGIC
    // ============================================================================

    /**
     * Initialize filter dropdowns with all available authors and mentioned shipgirls
     * Sets up event listeners for filter interactions
     */
    function initializeFilters() {
        const allPosts = Object.values(postsData);

        // Extract unique author names from all posts and sort alphabetically
        const allAuthors = [...new Set(
            allPosts.map(p => getShipgirlData(p.ship_group).name).filter(Boolean)
        )].sort();

        // Extract unique mentioned shipgirl names from all posts and sort alphabetically
        const allMentioned = [...new Set(
            allPosts.flatMap(p => (p.shipgirl_names || []).map(id => getShipgirlData(id).name).filter(Boolean))
        )].sort();

        // Populate author dropdown with click handlers
        populateDropdown(authorDropdown, allAuthors, (author) => {
            authorSearchInput.value = author;
            populateGallery({ author });
        });

        // Populate mentioned shipgirl dropdown with click handlers
        populateDropdown(mentionedDropdown, allMentioned, (name) => {
            mentionedSearchInput.value = name;
            populateGallery({ mentioned: name });
        });

        // Setup live search filtering for dropdowns
        authorSearchInput.addEventListener('keyup', () => filterDropdown(authorSearchInput, authorDropdown));
        mentionedSearchInput.addEventListener('keyup', () => filterDropdown(mentionedSearchInput, mentionedDropdown));

        // Setup dropdown show/hide behavior on focus/blur
        setupDropdownToggle(authorSearchInput, authorDropdown);
        setupDropdownToggle(mentionedSearchInput, mentionedDropdown);

        // Clear all filters and show all posts
        clearFiltersBtn.addEventListener('click', () => {
            authorSearchInput.value = '';
            mentionedSearchInput.value = '';
            populateGallery();
        });
    }

    /**
     * Populate a dropdown element with clickable items
     *
     * @param {HTMLElement} dropdownElement - The dropdown container to populate
     * @param {Array} items - Array of item names to display
     * @param {Function} onSelectCallback - Function to call when an item is selected
     */
    function populateDropdown(dropdownElement, items, onSelectCallback) {
        dropdownElement.innerHTML = '';
        items.forEach(item => {
            const a = document.createElement('a');
            a.textContent = item;
            a.addEventListener('click', () => {
                onSelectCallback(item);
                dropdownElement.style.display = 'none';
            });
            dropdownElement.appendChild(a);
        });
    }

    /**
     * Filter dropdown items based on input text (live search)
     *
     * @param {HTMLInputElement} input - The search input element
     * @param {HTMLElement} dropdown - The dropdown to filter
     */
    function filterDropdown(input, dropdown) {
        const filter = input.value.toUpperCase();
        const items = dropdown.getElementsByTagName('a');

        // Show only items that contain the search text
        for (let i = 0; i < items.length; i++) {
            const txtValue = items[i].textContent || items[i].innerText;
            items[i].style.display = txtValue.toUpperCase().indexOf(filter) > -1 ? "" : "none";
        }
    }

    /**
     * Setup dropdown toggle behavior (show on focus, hide on blur)
     *
     * @param {HTMLInputElement} input - The input that triggers the dropdown
     * @param {HTMLElement} dropdown - The dropdown to show/hide
     */
    function setupDropdownToggle(input, dropdown) {
        input.addEventListener('focus', () => dropdown.style.display = 'block');
        input.addEventListener('blur', () => {
            // Delay hiding to allow click events on dropdown items to fire
            setTimeout(() => {
                dropdown.style.display = 'none';
            }, 150);
        });
    }
    // ============================================================================
    // GALLERY DISPLAY & POST FILTERING
    // ============================================================================

    /**
     * Populate the image gallery with filtered posts
     * Displays thumbnails in reverse chronological order (newest first)
     *
     * @param {Object} filters - Filter criteria object
     * @param {string} [filters.author] - Filter by post author name
     * @param {string} [filters.mentioned] - Filter by mentioned shipgirl name
     */
    function populateGallery(filters = {}) {
        galleryView.innerHTML = '';

        // Convert posts object to array for filtering/sorting (creates new array, doesn't mutate original)
        let postEntries = [...Object.entries(postsData)].reverse(); // Newest posts first

        // Apply author filter if specified
        if (filters.author) {
            postEntries = postEntries.filter(([key, post]) =>
                getShipgirlData(post.ship_group).name === filters.author
            );
        }

        // Apply mentioned shipgirl filter if specified
        if (filters.mentioned) {
            postEntries = postEntries.filter(([key, post]) => {
                const mentionedNames = (post.shipgirl_names || []).map(id => getShipgirlData(id).name);
                return mentionedNames.includes(filters.mentioned);
            });
        }

        // Handle no results case
        if (postEntries.length === 0) {
            galleryView.innerHTML = '<p>필터와 일치하는 게시물이 없습니다.</p>';
            postDisplayContainer.innerHTML = '';
            return;
        }

        // Create thumbnail images for each post
        postEntries.forEach(([key, post], index) => {
            // Only create thumbnail if post has an image
            if (post.picture_persist && post.picture_persist.trim() !== '') {
                const authorData = getShipgirlData(post.ship_group);
                const img = document.createElement('img');

                // Lazy loading: First 12 images load immediately, rest load as they come into viewport
                if (index < 12) {
                    img.src = post.picture_persist;
                } else {
                    img.dataset.src = post.picture_persist; // Store URL for lazy loading
                    img.classList.add('lazy'); // Mark as lazy-load image
                }

                img.alt = `Post by ${authorData.name}`;
                img.dataset.postId = post.id;
                img.loading = 'lazy'; // Native browser lazy loading
                galleryView.appendChild(img);
            }
        });

        // Initialize Intersection Observer for lazy loading images beyond first 12
        observeLazyImages();

        // Auto-select and display the first post in the filtered results
        const firstPostId = postEntries[0]?.[1]?.id;
        if (firstPostId) {
            displayPost(firstPostId);
            highlightSelectedThumbnail(firstPostId);
        }
    }
    /**
     * Display a full post with all details (image, message, comments, reply options)
     *
     * @param {number|string} postId - The ID of the post to display
     */
    function displayPost(postId) {
        const post = postsData[postId];

        // Handle invalid post ID
        if (!post) {
            postDisplayContainer.innerHTML = `<p>게시물 ID '${postId}'를 찾을 수 없습니다.</p>`;
            return;
        }

        // Clear previous content and create new post container
        postDisplayContainer.innerHTML = '';
        const postContent = document.createElement('div');
        postContent.className = 'post-content';

        // Build post header with author info
        const authorData = getShipgirlData(post.ship_group);
        const header = document.createElement('div');
        header.className = 'post-header';
        const authorInfo = document.createElement('div');
        authorInfo.className = 'post-author';
        authorInfo.innerHTML = `
            <img src="${authorData.icon}" class="author-icon" alt="${authorData.name}">
            <div>
                <span class="author-korean-name">${authorData.name}</span>
                <span class="author-username">${post.name}</span>
            </div>`;
        header.appendChild(authorInfo);

        // Create main post image
        const image = document.createElement('img');
        image.src = post.picture_persist;
        image.alt = `Post image by ${authorData.name}`;
        image.className = 'post-image';

        // Create post message text
        const message = document.createElement('p');
        message.className = 'post-message';
        message.textContent = post.message;

        // Build comments section with threaded replies
        const commentsSection = document.createElement('div');
        commentsSection.className = 'comments-section';

        let hasComments = false;

        // Iterate through reply groups (reply_group1, reply_group2, etc.)
        for (let i = 1; ; i++) {
            const groupKey = `reply_group${i}`;
            if (!post[groupKey]) break; // No more reply groups
            hasComments = true;

            // Create container for this comment thread
            const threadContainer = document.createElement('div');
            threadContainer.className = 'comment-thread';

            let isFirstInThread = true;

            // Process each comment in the thread
            for (const commentId in post[groupKey]) {
                const commentData = post[groupKey][commentId];
                const authorId = Object.keys(commentData)[0];
                const author = getShipgirlData(authorId);
                const text = commentData[authorId];

                const commentDiv = document.createElement('div');
                commentDiv.className = 'comment';

                // Indent replies (comments after the first in a thread)
                if (!isFirstInThread) commentDiv.classList.add('reply');

                // Build comment HTML with icon, author, and text
                commentDiv.innerHTML = `
                    <img src="${author.icon}" class="comment-icon" alt="${author.name}">
                    <div class="comment-body">
                        <span class="comment-author-name">${author.name}</span>
                        <span class="comment-username">${author.username}:</span>
                        <span class="comment-text">${text}</span>
                    </div>`;
                threadContainer.appendChild(commentDiv);
                isFirstInThread = false;
            }
            commentsSection.appendChild(threadContainer);
        }

        // Add "Comments" header if any comments exist
        if (hasComments) {
            const commentsHeader = document.createElement('h3');
            commentsHeader.textContent = '댓글';
            commentsSection.prepend(commentsHeader);
        }

        // Assemble all post components
        postContent.appendChild(header);
        postContent.appendChild(image);
        postContent.appendChild(message);
        postContent.appendChild(commentsSection);

        // Build commander reply interaction section (if available)
        const commanderReplySection = document.createElement('footer');
        commanderReplySection.className = 'commander-reply-section';

        // Check if post has commander reply options
        if (post.op_option1 && post.op_option1 !== "Translation Source Missing") {
            const optionsContainer = document.createElement('div');
            optionsContainer.className = 'commander-options';
            const replyContainer = document.createElement('div');
            replyContainer.className = 'shipgirl-reply';

            /**
             * Create click handler for reply options
             * Shows shipgirl's response when commander selects an option
             */
            const createReplyHandler = (optionText, replyText, replierId) => {
                return () => {
                    const replierData = getShipgirlData(replierId);
                    replyContainer.innerHTML = `<strong>지휘관:</strong> ${optionText}<br><strong>${replierData.name}:</strong> ${replyText}`;
                    optionsContainer.style.display = 'none'; // Hide options after selection
                    commanderReplySection.appendChild(replyContainer);
                };
            };

            // Create first reply option button
            const button1 = document.createElement('button');
            button1.textContent = post.op_option1;
            button1.addEventListener('click', createReplyHandler(post.op_option1, post.op_reply1, post.reply1_shipgirl));
            optionsContainer.appendChild(button1);

            // Create second reply option button (if exists)
            if (post.op_option2 && post.op_option2 !== "Translation Source Missing") {
                const button2 = document.createElement('button');
                button2.textContent = post.op_option2;
                button2.addEventListener('click', createReplyHandler(post.op_option2, post.op_reply2, post.reply2_shipgirl));
                optionsContainer.appendChild(button2);
            }

            commanderReplySection.appendChild(optionsContainer);
        }

        // Add all components to display container
        postDisplayContainer.appendChild(postContent);
        if (commanderReplySection.hasChildNodes()) {
            postDisplayContainer.appendChild(commanderReplySection);
        }
    }
    /**
     * Highlight the selected thumbnail in the gallery
     * Removes highlight from all thumbnails, then adds it to the selected one
     *
     * @param {number|string} postId - The ID of the post to highlight
     */
    function highlightSelectedThumbnail(postId) {
        // Remove 'selected' class from all thumbnails
        galleryView.querySelectorAll('img').forEach(img => img.classList.remove('selected'));

        // Add 'selected' class to the clicked thumbnail
        const selectedImg = galleryView.querySelector(`img[data-post-id="${postId}"]`);
        if (selectedImg) {
            selectedImg.classList.add('selected');
        }
    }

    /**
     * Setup Intersection Observer for lazy loading images
     * Images load when they come within 200px of the viewport
     */
    function observeLazyImages() {
        const lazyImages = galleryView.querySelectorAll('img.lazy');

        // Check if browser supports Intersection Observer
        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src; // Load the actual image
                        img.classList.remove('lazy'); // Remove lazy class
                        img.classList.add('loaded'); // Add loaded class for potential styling
                        observer.unobserve(img); // Stop observing this image
                    }
                });
            }, {
                root: galleryView,
                rootMargin: '200px', // Start loading 200px before image enters viewport
                threshold: 0.01
            });

            // Observe all lazy images
            lazyImages.forEach(img => imageObserver.observe(img));
        } else {
            // Fallback for older browsers - load all images immediately
            lazyImages.forEach(img => {
                img.src = img.dataset.src;
                img.classList.remove('lazy');
            });
        }
    }

    // ============================================================================
    // EVENT LISTENERS - Gallery Interactions
    // ============================================================================

    /**
     * Handle thumbnail clicks - display the selected post
     */
    galleryView.addEventListener('click', (event) => {
        if (event.target.tagName === 'IMG') {
            const postId = event.target.dataset.postId;
            displayPost(postId);
            highlightSelectedThumbnail(postId);
        }
    });

    /**
     * Show preview image when hovering over thumbnails
     */
    galleryView.addEventListener('mouseover', (event) => {
        if (event.target.tagName === 'IMG') {
            imagePreview.src = event.target.src;
            imagePreview.style.display = 'block';
        }
    });

    /**
     * Hide preview image when mouse leaves thumbnail
     */
    galleryView.addEventListener('mouseout', (event) => {
        if (event.target.tagName === 'IMG') {
            imagePreview.style.display = 'none';
        }
    });

    /**
     * Position preview image to follow mouse cursor
     * Automatically flips to left/top if preview would go off-screen
     */
    galleryView.addEventListener('mousemove', (event) => {
        const preview = imagePreview;
        if (preview.style.display !== 'block') return;

        const offsetX = 20; // Cursor offset to prevent blocking thumbnail
        const offsetY = 20;

        let newX = event.clientX + offsetX;
        let newY = event.clientY + offsetY;

        // Flip to left if preview would overflow right edge
        if (newX + preview.offsetWidth > window.innerWidth) {
            newX = event.clientX - preview.offsetWidth - offsetX;
        }

        // Flip to top if preview would overflow bottom edge
        if (newY + preview.offsetHeight > window.innerHeight) {
            newY = event.clientY - preview.offsetHeight - offsetY;
        }

        preview.style.left = newX + 'px';
        preview.style.top = newY + 'px';
    });
});