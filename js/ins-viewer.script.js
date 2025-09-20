document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const galleryView = document.getElementById('gallery-view');
    const postDisplayContainer = document.getElementById('post-display');
    const authorSearchInput = document.getElementById('author-search');
    const authorDropdown = document.getElementById('author-dropdown');
    const mentionedSearchInput = document.getElementById('mentioned-search');
    const mentionedDropdown = document.getElementById('mentioned-dropdown');
    const clearFiltersBtn = document.getElementById('clear-filters-btn');

    // Data storage
    let postsData = {};
    let shipgirlDataMap = {};
    const placeholderIcon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23e0e0e0'/%3E%3C/svg%3E";


    // --- Data Fetching ---
    Promise.all([
        fetch('data/processed_ins_data.json').then(res => res.json()),
        fetch('data/shipgirl_group_data.json').then(res => res.json())
    ])
    .then(([posts, shipgirlData]) => {
        postsData = posts;
        shipgirlDataMap = shipgirlData;

        initializeFilters();
        populateGallery();
        
        const firstPostKey = Object.keys(postsData)[0];
        if (postsData[firstPostKey]) {
            displayPost(postsData[firstPostKey].id);
            highlightSelectedThumbnail(postsData[firstPostKey].id);
        }
    })
    .catch(error => {
        console.error('Error fetching data:', error);
        galleryView.innerHTML = `<p>데이터를 불러오는 데 실패했습니다. 모든 .json 파일이 있는지 확인해주세요.</p>`;
    });

    // --- Helper Functions ---
    function getShipgirlData(id) {
        if (shipgirlDataMap[id]) {
            return {
                name: shipgirlDataMap[id].name.trim(),
                icon: shipgirlDataMap[id].icon
            };
        }
        if (typeof id === 'string' && id.startsWith('Unknown')) {
             return { name: id, icon: placeholderIcon };
        }
        return { name: `Unknown ID: ${id}`, icon: placeholderIcon };
    }

    // --- Filter Logic ---
    function initializeFilters() {
        const allPosts = Object.values(postsData);
        const allAuthors = [...new Set(allPosts.map(p => getShipgirlData(p.ship_group).name).filter(Boolean))].sort();
        const allMentioned = [...new Set(allPosts.flatMap(p => (p.shipgirl_names || []).map(id => getShipgirlData(id).name).filter(Boolean)))].sort();

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

    function filterDropdown(input, dropdown) {
        const filter = input.value.toUpperCase();
        const items = dropdown.getElementsByTagName('a');
        for (let i = 0; i < items.length; i++) {
            const txtValue = items[i].textContent || items[i].innerText;
            items[i].style.display = txtValue.toUpperCase().indexOf(filter) > -1 ? "" : "none";
        }
    }
    
    function setupDropdownToggle(input, dropdown) {
        input.addEventListener('focus', () => dropdown.style.display = 'block');
        input.addEventListener('blur', () => {
            setTimeout(() => {
                dropdown.style.display = 'none';
            }, 150);
        });
    }
    
    // --- Gallery and Post Display ---
    function populateGallery(filters = {}) {
        galleryView.innerHTML = '';
        let postEntries = Object.entries(postsData);

        if (filters.author) {
            postEntries = postEntries.filter(([key, post]) => getShipgirlData(post.ship_group).name === filters.author);
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

        postEntries.forEach(([key, post]) => {
             if (post.picture_persist && post.picture_persist.trim() !== '') {
                const authorData = getShipgirlData(post.ship_group);
                const img = document.createElement('img');
                img.src = post.picture_persist;
                img.alt = `Post by ${authorData.name}`;
                img.dataset.postId = post.id;
                galleryView.appendChild(img);
            }
        });

        const firstPostId = postEntries[0]?.[1]?.id;
         if (firstPostId) {
            displayPost(firstPostId);
            highlightSelectedThumbnail(firstPostId);
        }
    }
    
    function displayPost(postId) {
        const post = postsData[postId];

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
                    <div class="comment-author">
                        <img src="${author.icon}" class="comment-icon" alt="${author.name}">
                        <span>${author.name}:</span>
                    </div>
                    <div class="comment-text">${text}</div>`;
                threadContainer.appendChild(commentDiv);
                isFirstInThread = false;
            }
            commentsSection.appendChild(threadContainer);
        }
        
        if(hasComments) {
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

            const createReplyHandler = (optionText, replyText) => {
                return () => {
                    replyContainer.innerHTML = `<strong>지휘관:</strong> ${optionText}<br><strong>${authorData.name}:</strong> ${replyText}`;
                    optionsContainer.style.display = 'none';
                    commanderReplySection.appendChild(replyContainer);
                };
            };

            const button1 = document.createElement('button');
            button1.textContent = post.op_option1;
            button1.addEventListener('click', createReplyHandler(post.op_option1, post.op_reply1));
            optionsContainer.appendChild(button1);
            
            const button2 = document.createElement('button');
            button2.textContent = post.op_option2;
            button2.addEventListener('click', createReplyHandler(post.op_option2, post.op_reply2));
            optionsContainer.appendChild(button2);
            
            commanderReplySection.appendChild(optionsContainer);
        }
        
        postDisplayContainer.appendChild(postContent);
        if (commanderReplySection.hasChildNodes()) {
            postDisplayContainer.appendChild(commanderReplySection);
        }
    }
    
    function highlightSelectedThumbnail(postId) {
        galleryView.querySelectorAll('img').forEach(img => img.classList.remove('selected'));
        const selectedImg = galleryView.querySelector(`img[data-post-id="${postId}"]`);
        if (selectedImg) {
            selectedImg.classList.add('selected');
        }
    }

    galleryView.addEventListener('click', (event) => {
        if (event.target.tagName === 'IMG') {
            const postId = event.target.dataset.postId;
            displayPost(postId);
            highlightSelectedThumbnail(postId);
        }
    });
});