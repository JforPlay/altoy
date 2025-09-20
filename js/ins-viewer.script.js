document.addEventListener('DOMContentLoaded', () => {
    const galleryView = document.getElementById('gallery-view');
    const postDisplayContainer = document.getElementById('post-display');
    let postsData = {};

    fetch('data/processed_ins_data.json')
        .then(response => response.json())
        .then(data => {
            postsData = data;
            populateGallery();
            const firstPostId = Object.keys(postsData)[0];
            if (firstPostId) {
                displayPost(firstPostId);
                highlightSelectedThumbnail(firstPostId);
            }
        })
        .catch(error => {
            console.error('Error fetching data:', error);
            galleryView.innerHTML = '<p>Error loading posts.</p>';
        });

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

        postDisplayContainer.innerHTML = ''; // Clear previous content

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
                const author = Object.keys(commentData)[0];
                const text = commentData[author];

                const commentDiv = document.createElement('div');
                commentDiv.className = 'comment';
                if (!isFirstInThread) {
                    commentDiv.classList.add('reply');
                }
                commentDiv.innerHTML = `<div class="comment-author">${author}:</div><div class="comment-text">${text}</div>`;
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
        
        // --- NEW: Commander Reply Section ---
        const commanderReplySection = document.createElement('footer');
        commanderReplySection.className = 'commander-reply-section';

        if (post.op_option1 && post.op_option1 !== "Translation Source Missing") {
            const optionsContainer = document.createElement('div');
            optionsContainer.className = 'commander-options';

            const replyContainer = document.createElement('div');
            replyContainer.className = 'shipgirl-reply';

            // Option 1 Button
            const button1 = document.createElement('button');
            button1.textContent = post.op_option1;
            button1.addEventListener('click', () => {
                replyContainer.innerHTML = `<strong>You:</strong> ${post.op_option1}<br><strong>${post.korean_name}:</strong> ${post.op_reply1}`;
                optionsContainer.style.display = 'none'; // Hide buttons after choice
                commanderReplySection.appendChild(replyContainer);
            });
            optionsContainer.appendChild(button1);
            
            // Option 2 Button
            const button2 = document.createElement('button');
            button2.textContent = post.op_option2;
            button2.addEventListener('click', () => {
                replyContainer.innerHTML = `<strong>You:</strong> ${post.op_option2}<br><strong>${post.korean_name}:</strong> ${post.op_reply2}`;
                optionsContainer.style.display = 'none'; // Hide buttons after choice
                commanderReplySection.appendChild(replyContainer);
            });
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