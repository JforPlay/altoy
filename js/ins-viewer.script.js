document.addEventListener('DOMContentLoaded', () => {
    const galleryView = document.getElementById('gallery-view');
    const postDisplay = document.getElementById('post-display');
    let postsData = {};

    // Fetch the JSON data from the local file
    fetch('data/processed_ins_data.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            postsData = data;
            populateGallery();
            // Display the first post by default
            const firstPostId = Object.keys(postsData)[0];
            if (firstPostId) {
                displayPost(firstPostId);
                highlightSelectedThumbnail(firstPostId);
            }
        })
        .catch(error => {
            console.error('Error fetching data:', error);
            galleryView.innerHTML = '<p>Error loading posts. Make sure processed_ins_data.json is in the same folder.</p>';
        });

    function populateGallery() {
        galleryView.innerHTML = ''; // Clear any existing content
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

        postDisplay.innerHTML = ''; // Clear previous post content

        // 1. Post Header
        const header = document.createElement('div');
        header.className = 'post-header';
        
        const authorInfo = document.createElement('div');
        authorInfo.className = 'post-author';
        authorInfo.innerHTML = `${post.korean_name}<span>${post.name}</span>`;
        header.appendChild(authorInfo);
        
        // 2. Post Image
        const image = document.createElement('img');
        image.src = post.picture_persist;
        image.alt = `Post image by ${post.korean_name}`;
        image.className = 'post-image';

        // 3. Post Message
        const message = document.createElement('p');
        message.className = 'post-message';
        message.textContent = post.message;

        // 4. Comments Section
        const commentsSection = document.createElement('div');
        commentsSection.className = 'comments-section';
        commentsSection.innerHTML = '<h3>Comments</h3>';
        
        // Process all reply groups dynamically
        let hasComments = false;
        for (let i = 1; ; i++) {
            const groupKey = `reply_group${i}`;
            if (!post[groupKey]) break; // Stop if no more reply groups
            
            hasComments = true;
            const threadContainer = document.createElement('div');
            threadContainer.className = 'comment-thread';
            
            const comments = post[groupKey];
            let isFirstInThread = true;

            for (const commentId in comments) {
                const commentData = comments[commentId];
                const author = Object.keys(commentData)[0];
                const text = commentData[author];

                const commentDiv = document.createElement('div');
                commentDiv.className = 'comment';
                if (!isFirstInThread) {
                    commentDiv.classList.add('reply');
                }
                
                commentDiv.innerHTML = `<div class="comment-author">${author}</div><div class="comment-text">${text}</div>`;
                threadContainer.appendChild(commentDiv);
                
                isFirstInThread = false;
            }
            commentsSection.appendChild(threadContainer);
        }

        // Append all parts to the display area
        postDisplay.appendChild(header);
        postDisplay.appendChild(image);
        postDisplay.appendChild(message);
        if (hasComments) {
            postDisplay.appendChild(commentsSection);
        }
    }
    
    function highlightSelectedThumbnail(postId) {
        // Remove 'selected' class from all other images
        galleryView.querySelectorAll('img').forEach(img => img.classList.remove('selected'));

        // Add 'selected' class to the clicked image
        const selectedImg = galleryView.querySelector(`img[data-post-id="${postId}"]`);
        if (selectedImg) {
            selectedImg.classList.add('selected');
        }
    }

    // Use Event Delegation for handling clicks on gallery images
    galleryView.addEventListener('click', (event) => {
        if (event.target.tagName === 'IMG') {
            const postId = event.target.dataset.postId;
            displayPost(postId);
            highlightSelectedThumbnail(postId);
        }
    });
});