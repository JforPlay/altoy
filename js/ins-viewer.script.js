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
    let nameCodeMap = {};

    // --- Data Fetching ---
    const postsDataUrl = 'data/processed_ins_data.json';
    const nameCodeUrl = 'https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/ShareCfg/name_code.json';

    Promise.all([
        fetch(postsDataUrl).then(res => res.json()),
        fetch(nameCodeUrl).then(res => res.json())
    ])
    .then(([posts, names]) => {
        postsData = posts;
        nameCodeMap = names.all;
        
        // --- Initialization ---
        initializeFilters();
        populateGallery(); // Initial population with all posts
        
        const firstPostId = Object.keys(postsData)[0];
        if (firstPostId) {
            displayPost(firstPostId);
            highlightSelectedThumbnail(firstPostId);
        }
    })
    .catch(error => {
        console.error('Error fetching data:', error);
        galleryView.innerHTML = `<p>Error loading data.</p>`;
    });

    // --- Filter Logic ---
    function initializeFilters() {
        const allPosts = Object.values(postsData);
        const allAuthors = [...new Set(allPosts.map(p => p.korean_name))].sort();
        const allMentioned = [...new Set(allPosts.flatMap(p => p.shipgirl_names || []))].sort();

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
        let filteredPosts = Object.values(postsData);

        if (filters.author) {
            filteredPosts = filteredPosts.filter(p => p.korean_name === filters.author);
        }
        if (filters.mentioned) {
            filteredPosts = filteredPosts.filter(p => p.shipgirl_names && p.shipgirl_names.includes(filters.mentioned));
        }

        if (filteredPosts.length === 0) {
            galleryView.innerHTML = '<p>No posts match the filter.</p>';
            postDisplayContainer.innerHTML = '';
            return;
        }

        filteredPosts.forEach(post => {
             if (post.picture_persist && post.picture_persist.trim() !== '') {
                const img = document.createElement('img');
                img.src = post.picture_persist;
                img.alt = `Post by ${post.korean_name}`;
                img.dataset.postId = post.id;
                galleryView.appendChild(img);
            }
        });

        const firstPostId = filteredPosts[0]?.id;
         if (firstPostId) {
            displayPost(firstPostId);
            highlightSelectedThumbnail(firstPostId);
        }
    }
    
    function replaceNameCodes(text) {
        if (!text || typeof text !== 'string') return text;
        return text.replace(/\{namecode:(\d+)\}/g, (match, code) => nameCodeMap[code] || match);
    }
    
    function displayPost(postId) {
        const post = Object.values(postsData).find(p => p.id == postId);
        if (!post) {
            postDisplayContainer.innerHTML = '<p>Post not found.</p>';
            return;
        }

        postDisplayContainer.innerHTML = '';

        const postContent = document.createElement('div');
        postContent.className = 'post-content';

        const header = document.createElement('div');
        header.className = 'post-header';
        const authorInfo = document.createElement('div');
        authorInfo.className = 'post-author';
        authorInfo.innerHTML = `${post.korean_name}<span>${post.name}</span>`;
        header.appendChild(authorInfo);
        
        const image = document.createElement('img');
        image.src = post.picture_persist;
        image.alt = `Post image by ${post.korean_name}`;
        image.className = 'post-image';

        const message = document.createElement('p');
        message.className = 'post-message';
        message.textContent = replaceNameCodes(post.message);

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
                const originalAuthor = Object.keys(commentData)[0];
                const originalText = commentData[originalAuthor];

                // --- FIX IS HERE ---
                // Process the author name in case it's a namecode
                let processedAuthor = originalAuthor;
                const match = originalAuthor.match(/\{namecode:(\d+)\}/);
                if (match && match[1]) {
                    const code = match[1];
                    processedAuthor = nameCodeMap[code] || originalAuthor; // Replace if found
                }
                
                // Process the comment text for namecodes
                const processedText = replaceNameCodes(originalText); 

                const commentDiv = document.createElement('div');
                commentDiv.className = 'comment';
                if (!isFirstInThread) commentDiv.classList.add('reply');
                commentDiv.innerHTML = `<div class="comment-author">${processedAuthor}:</div><div class="comment-text">${processedText}</div>`;
                threadContainer.appendChild(commentDiv);
                isFirstInThread = false;
            }
            commentsSection.appendChild(threadContainer);
        }
        
        if(hasComments) {
            const commentsHeader = document.createElement('h3');
            commentsHeader.textContent = 'Comments';
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
                    const processedReply = replaceNameCodes(replyText);
                    replyContainer.innerHTML = `<strong>You:</strong> ${optionText}<br><strong>${post.korean_name}:</strong> ${processedReply}`;
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
        postDisplayContainer.appendChild(commanderReplySection);
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