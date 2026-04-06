/**
 * juustagram.js
 * Instagram-style social feed viewer for Azur Lane's Juustagram feature.
 * Displays posts with gallery thumbnails, author/mentioned-shipgirl filters, lazy loading,
 * and threaded comments. Full post data is loaded in the background after initial render.
 */

import { fetchJSON } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
    // ===== DOM References =====
    const galleryView = document.getElementById('gallery-view');
    const postDisplayContainer = document.getElementById('post-display');
    const authorSearchInput = document.getElementById('author-search');
    const authorDropdown = document.getElementById('author-dropdown');
    const mentionedSearchInput = document.getElementById('mentioned-search');
    const mentionedDropdown = document.getElementById('mentioned-dropdown');
    const clearFiltersBtn = document.getElementById('clear-filters-btn');

    // ===== Data Storage =====
    let postsData = {};              // Main posts data (initially lite, then full if needed for list)
    let fullPostsData = null;        // Full detailed post data
    let fullPostsPromise = null;     // Promise for background loading
    let shipgirlDataMap = {};        // Shipgirl metadata (names, icons) from ship_group_data.json
    let shipgroupTemplateMap = {};   // Template data for usernames from external API

    // Placeholder icon for unknown/missing shipgirls (gray circle SVG)
    const placeholderIcon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23e0e0e0'/%3E%3C/svg%3E";

    // ===== Image Preview Setup =====
    // Hover preview follows the cursor; positioned with flip logic to stay on-screen
    const imagePreview = document.createElement('img');
    imagePreview.id = 'image-preview';
    document.body.appendChild(imagePreview);

    // ===== Data Fetching & Initialization =====

    /**
     * Fetch three sources in parallel: lite posts (gallery), shipgirl metadata (icons/names),
     * and AzurLaneTools CN template data (usernames). Full post data loads in the background.
     */
    Promise.all([
        fetchJSON('data/juustagram_lite.json'),
        fetchJSON('data/ship_group_data.json'),
        fetchJSON('https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/CN/ShareCfg/activity_ins_ship_group_template.json')
    ])
        .then(([posts, shipgirlData, templateData]) => {
            postsData = posts;
            shipgirlDataMap = shipgirlData;
            shipgroupTemplateMap = templateData;

            initializeFilters();
            populateGallery();

            // Background-load full post data so detail view is ready when the user clicks
            fullPostsPromise = loadFullPosts();
        })
        .catch(error => {
            console.error('Error fetching data:', error);
            galleryView.innerHTML = `<p>데이터를 불러오는 데 실패했습니다. 모든 .json 파일이 있는지 확인해주세요.</p>`;
        });

    async function loadFullPosts() {
        try {
            fullPostsData = await fetchJSON('data/juustagram_data.json');
            return fullPostsData;
        } catch (error) {
            console.warn("Background loading of full data failed:", error);
        }
        return null;
    }

    // ===== Helper Functions =====

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

        if (shipData) {
            return {
                name: shipData.name.trim(),
                icon: shipData.icon,
                username: templateData ? `@${templateData.name}` : ''
            };
        }

        // Some IDs are pre-labeled "Unknown" in the source data
        if (typeof id === 'string' && id.startsWith('Unknown')) {
            return { name: id, icon: placeholderIcon, username: '' };
        }

        // Fallback for completely unknown IDs
        return { name: `Unknown ID: ${id}`, icon: placeholderIcon, username: '' };
    }

    // ===== Filter Initialization & Logic =====

    /**
     * Initialize filter dropdowns with all available authors and mentioned shipgirls
     * Sets up event listeners for filter interactions
     */
    function initializeFilters() {
        const allPosts = Object.values(postsData);

        const allAuthors = [...new Set(
            allPosts.map(p => getShipgirlData(p.ship_group).name).filter(Boolean)
        )].sort();

        const allMentioned = [...new Set(
            allPosts.flatMap(p => (p.shipgirl_names || []).map(id => getShipgirlData(id).name).filter(Boolean))
        )].sort();

        populateDropdown(authorDropdown, allAuthors, (author) => {
            authorSearchInput.value = author;
            populateGallery({ author });
        });

        populateDropdown(mentionedDropdown, allMentioned, (name) => {
            mentionedSearchInput.value = name;
            populateGallery({ mentioned: name });
        });

        authorSearchInput.addEventListener('keyup', () => filterDropdown(authorSearchInput, authorDropdown));
        mentionedSearchInput.addEventListener('keyup', () => filterDropdown(mentionedSearchInput, mentionedDropdown));

        setupDropdownToggle(authorSearchInput, authorDropdown);
        setupDropdownToggle(mentionedSearchInput, mentionedDropdown);

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
            // Delay lets click events on dropdown items fire before the dropdown hides
            setTimeout(() => {
                dropdown.style.display = 'none';
            }, 150);
        });
    }
    // ===== Gallery Display & Post Filtering =====

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

        let postEntries = [...Object.entries(postsData)].reverse(); // Newest posts first

        if (filters.author) {
            postEntries = postEntries.filter(([key, post]) =>
                getShipgirlData(post.ship_group).name === filters.author
            );
        }

        if (filters.mentioned) {
            postEntries = postEntries.filter(([key, post]) => {
                const mentionedNames = (post.shipgirl_names || []).map(id => getShipgirlData(id).name);
                return mentionedNames.includes(filters.mentioned);
            });
        }

        if (postEntries.length === 0) {
            galleryView.innerHTML = '<p>필터와 일치하는 게시물이 없습니다.</p>';
            postDisplayContainer.innerHTML = '';
            return;
        }

        postEntries.forEach(([key, post], index) => {
            if (post.picture_persist && post.picture_persist.trim() !== '') {
                const authorData = getShipgirlData(post.ship_group);
                const img = document.createElement('img');

                // First 12 images load eagerly; the rest use data-src + IntersectionObserver
                if (index < 12) {
                    img.src = post.picture_persist;
                } else {
                    img.dataset.src = post.picture_persist;
                    img.classList.add('lazy');
                }

                img.alt = `Post by ${authorData.name}`;
                img.dataset.postId = post.id;
                img.loading = 'lazy';
                galleryView.appendChild(img);
            }
        });

        observeLazyImages();

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
    async function displayPost(postId) {
        // Ensure full data is loaded for details
        if (!fullPostsData) {
            postDisplayContainer.innerHTML = '<div style="text-align:center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> 상세 내용 로딩 중...</div>';
            try {
                await fullPostsPromise;
            } catch (e) {
                postDisplayContainer.innerHTML = '<p>상세 내용을 불러오는데 실패했습니다.</p>';
                return;
            }
        }

        const post = fullPostsData ? fullPostsData[postId] : postsData[postId];

        // Handle invalid post ID
        if (!post) {
            postDisplayContainer.innerHTML = `<p>게시물 ID '${postId}'를 찾을 수 없습니다.</p>`;
            return;
        }

        postDisplayContainer.innerHTML = '';
        const postContent = document.createElement('div');
        postContent.className = 'post-content';

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

        const image = document.createElement('img');
        image.src = post.picture_persist;
        image.alt = `Post image by ${authorData.name}`;
        image.className = 'post-image';

        const message = document.createElement('p');
        message.className = 'post-message';
        message.textContent = post.message;

        const commentsSection = document.createElement('div');
        commentsSection.className = 'comments-section';

        let hasComments = false;

        // Threads are stored as reply_group1, reply_group2, … until a key is missing
        for (let i = 1; ; i++) {
            const groupKey = `reply_group${i}`;
            if (!post[groupKey]) break;
            hasComments = true;

            const threadContainer = document.createElement('div');
            threadContainer.className = 'comment-thread';

            let isFirstInThread = true;

            for (const commentId in post[groupKey]) {
                const commentData = post[groupKey][commentId];
                const authorId = Object.keys(commentData)[0];
                const author = getShipgirlData(authorId);
                const text = commentData[authorId];

                const commentDiv = document.createElement('div');
                commentDiv.className = 'comment';

                if (!isFirstInThread) commentDiv.classList.add('reply');

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

        if (hasComments) {
            const commentsHeader = document.createElement('h3');
            commentsHeader.textContent = '댓글';
            commentsSection.prepend(commentsHeader);
        }

        postContent.appendChild(header);
        postContent.appendChild(image);
        postContent.appendChild(message);
        postContent.appendChild(commentsSection);

        const commanderReplySection = document.createElement('footer');
        commanderReplySection.className = 'commander-reply-section';

        if (post.op_option1 && post.op_option1 !== "Translation Source Missing") {
            const optionsContainer = document.createElement('div');
            optionsContainer.className = 'commander-options';
            const replyContainer = document.createElement('div');
            replyContainer.className = 'shipgirl-reply';

            const createReplyHandler = (optionText, replyText, replierId) => {
                return () => {
                    const replierData = getShipgirlData(replierId);
                    replyContainer.innerHTML = `<strong>지휘관:</strong> ${optionText}<br><strong>${replierData.name}:</strong> ${replyText}`;
                    optionsContainer.style.display = 'none';
                    commanderReplySection.appendChild(replyContainer);
                };
            };

            const button1 = document.createElement('button');
            button1.textContent = post.op_option1;
            button1.addEventListener('click', createReplyHandler(post.op_option1, post.op_reply1, post.reply1_shipgirl));
            optionsContainer.appendChild(button1);

            if (post.op_option2 && post.op_option2 !== "Translation Source Missing") {
                const button2 = document.createElement('button');
                button2.textContent = post.op_option2;
                button2.addEventListener('click', createReplyHandler(post.op_option2, post.op_reply2, post.reply2_shipgirl));
                optionsContainer.appendChild(button2);
            }

            commanderReplySection.appendChild(optionsContainer);
        }

        postDisplayContainer.appendChild(postContent);
        if (commanderReplySection.hasChildNodes()) {
            postDisplayContainer.appendChild(commanderReplySection);
        }
    }
    /**
     * Mark a gallery thumbnail as selected and clear all others.
     * @param {number|string} postId - The ID of the post to highlight
     */
    function highlightSelectedThumbnail(postId) {
        galleryView.querySelectorAll('img').forEach(img => img.classList.remove('selected'));
        const selectedImg = galleryView.querySelector(`img[data-post-id="${postId}"]`);
        if (selectedImg) {
            selectedImg.classList.add('selected');
        }
    }

    /**
     * Set up IntersectionObserver to load gallery images as they approach the viewport.
     * Falls back to eager loading on browsers without IntersectionObserver support.
     */
    function observeLazyImages() {
        const lazyImages = galleryView.querySelectorAll('img.lazy');

        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src;
                        img.classList.remove('lazy');
                        img.classList.add('loaded');
                        observer.unobserve(img);
                    }
                });
            }, {
                root: galleryView,
                rootMargin: '200px', // Pre-load slightly before viewport entry
                threshold: 0.01
            });

            lazyImages.forEach(img => imageObserver.observe(img));
        } else {
            // Fallback: load all immediately on older browsers
            lazyImages.forEach(img => {
                img.src = img.dataset.src;
                img.classList.remove('lazy');
            });
        }
    }

    // ===== Gallery Interactions =====

    galleryView.addEventListener('click', (event) => {
        if (event.target.tagName === 'IMG') {
            const postId = event.target.dataset.postId;
            displayPost(postId);
            highlightSelectedThumbnail(postId);
        }
    });

    galleryView.addEventListener('mouseover', (event) => {
        if (event.target.tagName === 'IMG') {
            imagePreview.src = event.target.src;
            imagePreview.style.display = 'block';
        }
    });

    galleryView.addEventListener('mouseout', (event) => {
        if (event.target.tagName === 'IMG') {
            imagePreview.style.display = 'none';
        }
    });

    // Mouse-follow preview with edge-flip so it stays on-screen
    galleryView.addEventListener('mousemove', (event) => {
        const preview = imagePreview;
        if (preview.style.display !== 'block') return;

        const offsetX = 20;
        const offsetY = 20;

        let newX = event.clientX + offsetX;
        let newY = event.clientY + offsetY;

        if (newX + preview.offsetWidth > window.innerWidth) {
            newX = event.clientX - preview.offsetWidth - offsetX;
        }
        if (newY + preview.offsetHeight > window.innerHeight) {
            newY = event.clientY - preview.offsetHeight - offsetY;
        }

        preview.style.left = newX + 'px';
        preview.style.top = newY + 'px';
    });
});