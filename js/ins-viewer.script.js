document.addEventListener('DOMContentLoaded', () => {
    const galleryView = document.getElementById('gallery-view');
    const postDisplayContainer = document.getElementById('post-display');
    let postsData = {};
    let nameCodeMap = {}; // To store the ship names

    // URLs for the data files
    const postsDataUrl = 'data/processed_ins_data.json';
    const nameCodeUrl = 'https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/main/KR/ShareCfg/name_code.json';

    // Use Promise.all to fetch both JSON files before initializing
    Promise.all([
        fetch(postsDataUrl).then(res => {
            if (!res.ok) throw new Error(`Could not fetch ${postsDataUrl}`);
            return res.json();
        }),
        fetch(nameCodeUrl).then(res => {
            if (!res.ok) throw new Error(`Could not fetch ${nameCodeUrl}`);
            return res.json();
        })
    ])
    .then(([posts, names]) => {
        postsData = posts;
        nameCodeMap = names.all; // The JSON has the map inside the 'all' key
        
        populateGallery();
        const firstPostId = Object.keys(postsData)[0];
        if (firstPostId) {
            displayPost(firstPostId);
            highlightSelectedThumbnail(firstPostId);
        }
    })
    .catch(error => {
        console.error('Error fetching data:', error);
        galleryView.innerHTML = `<p>Error loading data. If running locally, you might need a local server due to browser security policies (CORS). Using the "Live Server" extension in VS Code is an easy solution.</p>`;
    });

    /**
     * Replaces all {namecode:XX} placeholders in a string with the actual ship names.
     * @param {string} text The text to process.
     * @returns {string} The processed text with names replaced.
     */
    function replaceNameCodes(text) {
        if (!text || typeof text !== 'string') return text;
        
        // Regex to find all instances of {namecode:XX}
        return text.replace(/\{namecode:(\d+)\}/g, (match, code) => {
            // Look up the code in the nameCodeMap and return the name, or the original placeholder if not found.
            return nameCodeMap[code] || match; 
        });
    }

    function populateGallery() {
        galleryView.innerHTML = '';
        for (const postId in postsData) {
            const post = postsData[postId];
            if (post.picture_persist && post.picture_persist.trim() !== '') {
                const img = document.createElement('img');
                img.src = post.picture_persist;
                img.alt = `Post by ${post.korean_name}`;
                img.dataset.postId = postId;
                galleryView.appendChild(img);
            }
        }
    }

    function displayPost(postId) {
        const post = postsData[postId];
        if (!post) return;

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
        message.textContent = replaceNameCodes(post.message); // Replace namecodes here

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
                const author = Object.keys(commentData)[0];
                const originalText = commentData[author];
                const processedText = replaceNameCodes(originalText); // Replace namecodes here

                const commentDiv = document.createElement('div');
                commentDiv.className = 'comment';
                if (!isFirstInThread) {
                    commentDiv.classList.add('reply');
                }
                commentDiv.innerHTML = `<div class="comment-author">${author}:</div><div class="comment-text">${processedText}</div>`;
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
                    const processedReply = replaceNameCodes(replyText); // Replace namecodes here
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