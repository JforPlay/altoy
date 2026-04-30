/**
 * juustagram.js
 * Instagram-style social feed viewer for Azur Lane's Juustagram feature.
 * Displays posts with gallery thumbnails, author/mentioned-shipgirl filters, lazy loading,
 * and threaded comments. Full post data is loaded before rendering detail views.
 */

import {
    fetchJSON,
    createImgElement,
    IMG_FALLBACKS,
    requireElements,
    renderStatus,
    observeLazyImages,
} from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
    // ===== DOM References =====
    const galleryView = document.getElementById('gallery-view');
    const postDisplayContainer = document.getElementById('post-display');
    const authorSearchInput = document.getElementById('author-search');
    const authorDropdown = document.getElementById('author-dropdown');
    const mentionedSearchInput = document.getElementById('mentioned-search');
    const mentionedDropdown = document.getElementById('mentioned-dropdown');
    const clearFiltersBtn = document.getElementById('clear-filters-btn');

    if (!requireElements({ galleryView, postDisplayContainer, authorSearchInput, authorDropdown,
        mentionedSearchInput, mentionedDropdown, clearFiltersBtn }, 'Juustagram')) {
        return;
    }

    // ===== Data Storage =====
    let postsData = {};              // Lite gallery data
    let fullPostsData = null;        // Full detailed post data
    let fullPostsPromise = null;     // Shared full-data request
    let shipgirlDataMap = {};        // Shipgirl metadata (names, icons) from ship_group_data.json
    let shipgroupTemplateMap = {};   // Template data for usernames from external API
    let lazyImageObserver = null;
    let displayRequestId = 0;
    let currentPostId = null;
    const currentFilters = {
        author: '',
        mentioned: '',
    };

    // Placeholder icon for unknown/missing shipgirls (gray circle SVG)
    const placeholderIcon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23e0e0e0'/%3E%3C/svg%3E";

    // ===== Image Preview Setup =====
    // Hover preview follows the cursor; positioned with flip logic to stay on-screen
    const imagePreview = document.createElement('img');
    imagePreview.id = 'image-preview';
    imagePreview.alt = '';
    imagePreview.setAttribute('aria-hidden', 'true');
    document.body.appendChild(imagePreview);

    // ===== Data Fetching & Initialization =====

    /**
     * Fetch local lite posts and shipgirl metadata. Username template data is optional:
     * if GitHub is unavailable, the page still renders with local data.
     */
    Promise.all([
        fetchJSON('data/juustagram_lite.json'),
        fetchJSON('data/ship_group_data.json'),
        fetchJSON('https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/CN/ShareCfg/activity_ins_ship_group_template.json')
            .catch((error) => {
                console.warn('Optional Juustagram username template data failed to load:', error);
                return {};
            }),
    ])
        .then(([posts, shipgirlData, templateData]) => {
            if (!isRecord(posts)) throw new Error('Invalid Juustagram lite data');
            if (!isRecord(shipgirlData)) throw new Error('Invalid shipgirl data');

            postsData = posts;
            shipgirlDataMap = shipgirlData;
            shipgroupTemplateMap = isRecord(templateData) ? templateData : {};

            // Start full-data loading before the first selected post renders.
            fullPostsPromise = loadFullPosts();

            initializeFilters();
            populateGallery();
        })
        .catch(error => {
            console.error('Error fetching data:', error);
            renderStatus(galleryView, '데이터를 불러오는 데 실패했습니다. 모든 .json 파일이 있는지 확인해주세요.', 'error');
            renderStatus(postDisplayContainer, '게시물을 표시할 수 없습니다.', 'error');
        });

    async function loadFullPosts() {
        try {
            const data = await fetchJSON('data/juustagram_data.json');
            if (!isRecord(data)) throw new Error('Invalid Juustagram full data');
            fullPostsData = data;
            return fullPostsData;
        } catch (error) {
            console.warn('Background loading of full data failed:', error);
        }
        return null;
    }

    function ensureFullPosts() {
        if (fullPostsData) return Promise.resolve(fullPostsData);
        if (!fullPostsPromise) fullPostsPromise = loadFullPosts();
        return fullPostsPromise;
    }

    // ===== Helper Functions =====

    function isRecord(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function clearElement(element) {
        element.replaceChildren();
    }

    function setPostBusy(isBusy) {
        postDisplayContainer.setAttribute('aria-busy', String(isBusy));
    }

    function createAvatar(src, alt, className) {
        return createImgElement(src || placeholderIcon, alt, {
            className,
            eager: true,
            fallback: placeholderIcon,
        });
    }

    function createSafeImage(src, alt, options = {}) {
        const fallback = options.fallback || IMG_FALLBACKS.CARD;
        return createImgElement(src || fallback, alt, {
            ...options,
            fallback,
        });
    }

    function appendTextElement(parent, tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        element.textContent = text ?? '';
        parent.appendChild(element);
        return element;
    }

    /**
     * Retrieve shipgirl display data by ID.
     * Combines local shipgirl data and optional username template data.
     *
     * @param {number|string} id - Shipgirl ID or unknown identifier
     * @returns {{name: string, icon: string, username: string}}
     */
    function getShipgirlData(id) {
        const shipData = shipgirlDataMap[id];
        const templateData = shipgroupTemplateMap[id];

        if (shipData) {
            const name = String(shipData.name || `ID ${id}`).trim();
            return {
                name,
                icon: shipData.icon || placeholderIcon,
                username: templateData ? `@${templateData.name}` : '',
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
     * Initialize filter dropdowns with all available authors and mentioned shipgirls.
     * Sets up event listeners for filter interactions.
     */
    function initializeFilters() {
        const allPosts = Object.values(postsData).filter(isRecord);

        const allAuthors = [...new Set(
            allPosts.map(p => getShipgirlData(p.ship_group).name).filter(Boolean)
        )].sort();

        const allMentioned = [...new Set(
            allPosts.flatMap(p => (Array.isArray(p.shipgirl_names) ? p.shipgirl_names : [])
                .map(id => getShipgirlData(id).name)
                .filter(Boolean))
        )].sort();

        populateDropdown(authorSearchInput, authorDropdown, allAuthors, (author) => {
            currentFilters.author = author;
            authorSearchInput.value = author;
            populateGallery();
        });

        populateDropdown(mentionedSearchInput, mentionedDropdown, allMentioned, (name) => {
            currentFilters.mentioned = name;
            mentionedSearchInput.value = name;
            populateGallery();
        });

        setupDropdownToggle(authorSearchInput, authorDropdown, 'author');
        setupDropdownToggle(mentionedSearchInput, mentionedDropdown, 'mentioned');

        clearFiltersBtn.addEventListener('click', () => {
            currentFilters.author = '';
            currentFilters.mentioned = '';
            authorSearchInput.value = '';
            mentionedSearchInput.value = '';
            filterDropdown(authorSearchInput, authorDropdown);
            filterDropdown(mentionedSearchInput, mentionedDropdown);
            populateGallery();
            authorSearchInput.focus();
        });
    }

    /**
     * Populate a dropdown element with selectable button items.
     *
     * @param {HTMLElement} dropdownElement - The dropdown container to populate
     * @param {Array<string>} items - Array of item names to display
     * @param {(item: string) => void} onSelectCallback - Function to call when an item is selected
     */
    function populateDropdown(input, dropdownElement, items, onSelectCallback) {
        clearElement(dropdownElement);
        items.forEach(item => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'dropdown-option';
            button.setAttribute('role', 'option');
            button.textContent = item;
            button.addEventListener('click', () => {
                onSelectCallback(item);
                closeDropdown(input, dropdownElement);
            });
            dropdownElement.appendChild(button);
        });
    }

    /**
     * Filter dropdown items based on input text (live search).
     *
     * @param {HTMLInputElement} input - The search input element
     * @param {HTMLElement} dropdown - The dropdown to filter
     */
    function filterDropdown(input, dropdown) {
        const filter = input.value.trim().toUpperCase();
        const items = dropdown.querySelectorAll('.dropdown-option');

        items.forEach(item => {
            const textValue = item.textContent || '';
            item.hidden = filter !== '' && !textValue.toUpperCase().includes(filter);
        });
    }

    function getVisibleDropdownOptions(dropdown) {
        return [...dropdown.querySelectorAll('.dropdown-option')]
            .filter(option => !option.hidden);
    }

    function openDropdown(input, dropdown) {
        dropdown.classList.add('open');
        input.setAttribute('aria-expanded', 'true');
    }

    function closeDropdown(input, dropdown) {
        dropdown.classList.remove('open');
        if (input) input.setAttribute('aria-expanded', 'false');
    }

    /**
     * Setup dropdown toggle behavior and keyboard navigation.
     *
     * @param {HTMLInputElement} input - The input that triggers the dropdown
     * @param {HTMLElement} dropdown - The dropdown to show/hide
     * @param {'author'|'mentioned'} filterKey - The currentFilters key controlled by this input
     */
    function setupDropdownToggle(input, dropdown, filterKey) {
        const container = dropdown.closest('.dropdown-container');

        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-controls', dropdown.id);
        input.setAttribute('aria-expanded', 'false');

        input.addEventListener('focus', () => openDropdown(input, dropdown));
        input.addEventListener('input', () => {
            filterDropdown(input, dropdown);
            openDropdown(input, dropdown);

            if (input.value.trim() === '' && currentFilters[filterKey]) {
                currentFilters[filterKey] = '';
                populateGallery();
            }
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                openDropdown(input, dropdown);
                getVisibleDropdownOptions(dropdown)[0]?.focus();
            } else if (event.key === 'Escape') {
                closeDropdown(input, dropdown);
            }
        });

        dropdown.addEventListener('keydown', (event) => {
            const options = getVisibleDropdownOptions(dropdown);
            const currentIndex = options.indexOf(document.activeElement);

            if (event.key === 'ArrowDown') {
                event.preventDefault();
                options[Math.min(currentIndex + 1, options.length - 1)]?.focus();
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (currentIndex <= 0) input.focus();
                else options[currentIndex - 1]?.focus();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                closeDropdown(input, dropdown);
                input.focus();
            }
        });

        container?.addEventListener('focusout', (event) => {
            if (!container.contains(event.relatedTarget)) {
                closeDropdown(input, dropdown);
            }
        });
    }

    // ===== Gallery Display & Post Filtering =====

    /**
     * Populate the image gallery with filtered posts.
     * Displays thumbnails in reverse chronological order (newest first).
     */
    function populateGallery() {
        if (lazyImageObserver) {
            lazyImageObserver.disconnect();
            lazyImageObserver = null;
        }

        clearElement(galleryView);

        let postEntries = Object.entries(postsData)
            .filter(([, post]) => isRecord(post))
            .reverse();

        if (currentFilters.author) {
            postEntries = postEntries.filter(([, post]) =>
                getShipgirlData(post.ship_group).name === currentFilters.author
            );
        }

        if (currentFilters.mentioned) {
            postEntries = postEntries.filter(([, post]) => {
                const mentionedNames = (Array.isArray(post.shipgirl_names) ? post.shipgirl_names : [])
                    .map(id => getShipgirlData(id).name);
                return mentionedNames.includes(currentFilters.mentioned);
            });
        }

        const visiblePostEntries = postEntries.filter(([, post]) =>
            typeof post.picture_persist === 'string' && post.picture_persist.trim() !== ''
        );

        if (visiblePostEntries.length === 0) {
            renderStatus(galleryView, '필터와 일치하는 게시물이 없습니다.', 'empty');
            renderStatus(postDisplayContainer, '표시할 게시물이 없습니다.', 'empty');
            return;
        }

        visiblePostEntries.forEach(([, post], index) => {
            const authorData = getShipgirlData(post.ship_group);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'gallery-thumbnail';
            button.dataset.postId = String(post.id);
            button.setAttribute('aria-label', `${authorData.name} 게시물 보기`);
            button.setAttribute('aria-pressed', 'false');

            const img = createGalleryImage(post.picture_persist, `Post by ${authorData.name}`, index < 12);
            button.appendChild(img);
            galleryView.appendChild(button);
        });

        lazyImageObserver = observeLazyImages(galleryView, { rootMargin: '200px' });

        // Preserve the user's selected post when it's still in the filtered set;
        // otherwise fall back to the first visible post.
        const visiblePostIds = visiblePostEntries.map(([, post]) => String(post.id));
        const targetPostId = currentPostId && visiblePostIds.includes(currentPostId)
            ? currentPostId
            : visiblePostIds[0];

        if (targetPostId !== undefined) {
            void displayPost(targetPostId);
        }
    }

    function createGalleryImage(src, alt, eager) {
        const img = document.createElement('img');
        img.alt = alt;
        img.loading = eager ? 'eager' : 'lazy';
        img.onerror = () => {
            if (img.src !== IMG_FALLBACKS.CARD) img.src = IMG_FALLBACKS.CARD;
        };

        if (eager) {
            img.src = src;
        } else {
            img.dataset.src = src;
            img.classList.add('lazy');
        }

        return img;
    }

    /**
     * Display a full post with all details (image, message, comments, reply options).
     *
     * @param {number|string} postId - The ID of the post to display
     */
    async function displayPost(postId) {
        const postIdString = String(postId);
        currentPostId = postIdString;
        highlightSelectedThumbnail(postIdString);

        const requestId = ++displayRequestId;
        setPostBusy(true);

        let source = fullPostsData;
        if (!source) {
            renderStatus(postDisplayContainer, '상세 내용 로딩 중...', 'loading');
            source = await ensureFullPosts();
            if (requestId !== displayRequestId) return;
        }

        if (!source) {
            setPostBusy(false);
            renderStatus(postDisplayContainer, '상세 내용을 불러오는데 실패했습니다.', 'error');
            return;
        }

        const post = source[postIdString];

        if (!post) {
            setPostBusy(false);
            renderStatus(postDisplayContainer, `게시물 ID '${postIdString}'를 찾을 수 없습니다.`, 'error');
            return;
        }

        postDisplayContainer.replaceChildren(createPostDetail(post));
        setPostBusy(false);
    }

    function createPostDetail(post) {
        const fragment = document.createDocumentFragment();
        const postContent = document.createElement('div');
        postContent.className = 'post-content';

        const authorData = getShipgirlData(post.ship_group);
        const header = document.createElement('div');
        header.className = 'post-header';

        const authorInfo = document.createElement('div');
        authorInfo.className = 'post-author';
        authorInfo.appendChild(createAvatar(authorData.icon, authorData.name, 'author-icon'));

        const authorText = document.createElement('div');
        appendTextElement(authorText, 'span', 'author-korean-name', authorData.name);
        appendTextElement(authorText, 'span', 'author-username', post.name || authorData.username);
        authorInfo.appendChild(authorText);
        header.appendChild(authorInfo);

        const image = createSafeImage(post.picture_persist, `Post image by ${authorData.name}`, {
            className: 'post-image',
            eager: true,
            fallback: IMG_FALLBACKS.DETAIL,
        });

        const message = document.createElement('p');
        message.className = 'post-message';
        message.textContent = post.message || '';

        postContent.appendChild(header);
        postContent.appendChild(image);
        postContent.appendChild(message);
        postContent.appendChild(createCommentsSection(post));
        fragment.appendChild(postContent);

        const replySection = createCommanderReplySection(post);
        if (replySection) fragment.appendChild(replySection);

        return fragment;
    }

    function createCommentsSection(post) {
        const commentsSection = document.createElement('div');
        commentsSection.className = 'comments-section';
        let hasComments = false;

        const groupKeys = Object.keys(post)
            .filter(key => /^reply_group\d+$/.test(key))
            .sort((a, b) => Number(a.replace('reply_group', '')) - Number(b.replace('reply_group', '')));

        groupKeys.forEach((groupKey) => {
            const group = post[groupKey];
            if (!isRecord(group)) return;

            const threadContainer = document.createElement('div');
            threadContainer.className = 'comment-thread';
            let isFirstInThread = true;

            Object.values(group).forEach((commentData) => {
                if (!isRecord(commentData)) return;
                const [authorId, text] = Object.entries(commentData)[0] || [];
                if (authorId === undefined) return;

                const author = getShipgirlData(authorId);
                const commentDiv = document.createElement('div');
                commentDiv.className = isFirstInThread ? 'comment' : 'comment reply';
                commentDiv.appendChild(createAvatar(author.icon, author.name, 'comment-icon'));

                const commentBody = document.createElement('div');
                commentBody.className = 'comment-body';
                appendTextElement(commentBody, 'span', 'comment-author-name', author.name);
                appendTextElement(commentBody, 'span', 'comment-username', `${author.username}:`);
                appendTextElement(commentBody, 'span', 'comment-text', text);
                commentDiv.appendChild(commentBody);

                threadContainer.appendChild(commentDiv);
                isFirstInThread = false;
                hasComments = true;
            });

            if (threadContainer.hasChildNodes()) {
                commentsSection.appendChild(threadContainer);
            }
        });

        if (hasComments) {
            const commentsHeader = document.createElement('h3');
            commentsHeader.textContent = '댓글';
            commentsSection.prepend(commentsHeader);
        }

        return commentsSection;
    }

    function createCommanderReplySection(post) {
        if (!post.op_option1 || post.op_option1 === 'Translation Source Missing') {
            return null;
        }

        const commanderReplySection = document.createElement('footer');
        commanderReplySection.className = 'commander-reply-section';

        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'commander-options';

        const replyContainer = document.createElement('div');
        replyContainer.className = 'shipgirl-reply';
        replyContainer.tabIndex = -1;

        const createReplyHandler = (optionText, replyText, replierId) => {
            return () => {
                const replierData = getShipgirlData(replierId);
                replyContainer.replaceChildren(
                    createReplyLine('지휘관:', optionText),
                    createReplyLine(`${replierData.name}:`, replyText)
                );
                optionsContainer.hidden = true;
                commanderReplySection.appendChild(replyContainer);
                replyContainer.focus({ preventScroll: true });
            };
        };

        optionsContainer.appendChild(createReplyButton(
            post.op_option1,
            createReplyHandler(post.op_option1, post.op_reply1, post.reply1_shipgirl)
        ));

        if (post.op_option2 && post.op_option2 !== 'Translation Source Missing') {
            optionsContainer.appendChild(createReplyButton(
                post.op_option2,
                createReplyHandler(post.op_option2, post.op_reply2, post.reply2_shipgirl)
            ));
        }

        commanderReplySection.appendChild(optionsContainer);
        return commanderReplySection;
    }

    function createReplyButton(text, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.addEventListener('click', onClick);
        return button;
    }

    function createReplyLine(label, text) {
        const line = document.createElement('div');
        line.className = 'reply-line';

        const strong = document.createElement('strong');
        strong.textContent = label;
        line.appendChild(strong);
        line.appendChild(document.createTextNode(` ${text || ''}`));
        return line;
    }

    /**
     * Mark a gallery thumbnail as selected and clear all others.
     * @param {number|string} postId - The ID of the post to highlight
     */
    function highlightSelectedThumbnail(postId) {
        galleryView.querySelectorAll('.gallery-thumbnail').forEach(button => {
            const isSelected = button.dataset.postId === String(postId);
            button.classList.toggle('selected', isSelected);
            button.setAttribute('aria-pressed', String(isSelected));
        });
    }

    // ===== Gallery Interactions =====

    galleryView.addEventListener('click', (event) => {
        const button = event.target.closest('.gallery-thumbnail');
        if (!button || !galleryView.contains(button)) return;

        void displayPost(button.dataset.postId);
    });

    galleryView.addEventListener('mouseover', (event) => {
        const img = event.target.closest('.gallery-thumbnail img');
        if (!img || !galleryView.contains(img)) return;

        imagePreview.src = img.currentSrc || img.src || img.dataset.src || '';
        imagePreview.style.display = 'block';
    });

    galleryView.addEventListener('mouseout', (event) => {
        const img = event.target.closest('.gallery-thumbnail img');
        if (!img || !galleryView.contains(img)) return;

        imagePreview.style.display = 'none';
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

        preview.style.left = `${newX}px`;
        preview.style.top = `${newY}px`;
    });

    window.addEventListener('pagehide', () => {
        if (lazyImageObserver) lazyImageObserver.disconnect();
        imagePreview.remove();
    }, { once: true });
});
