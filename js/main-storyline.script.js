document.addEventListener('DOMContentLoaded', () => {
    function setResponsiveFontSize() {
        const baseWidth = 1920; // The width the original px values were designed for
        const minWidth = 1024; // A minimum width to stop scaling down further
        const maxWidth = 2560; // A maximum width to stop scaling up
        
        let windowWidth = window.innerWidth;
        if (windowWidth < minWidth) windowWidth = minWidth;
        if (windowWidth > maxWidth) windowWidth = maxWidth;

        const scaleFactor = windowWidth / baseWidth;
        const baseFontSize = 16; // This is our baseline for 1rem = 16px

        document.documentElement.style.fontSize = `${baseFontSize * scaleFactor}px`;
    }

    // Call it once on load and add a listener for window resize
    setResponsiveFontSize();
    window.addEventListener('resize', setResponsiveFontSize);

    const timelineWrapper = document.querySelector('.timeline-wrapper');
    const timelineContainer = document.getElementById('timeline-container');
    const canvas = document.getElementById('timeline-canvas');
    const ctx = canvas.getContext('2d');
    const indicator = document.getElementById('timeline-indicator');
    const progressBarContainer = document.getElementById('progress-bar-container');

    // Modal elements
    const modal = document.getElementById('details-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalDescription = document.getElementById('modal-description');
    const modalSummary = document.getElementById('modal-summary');
    const modalShipNation = document.getElementById('modal-shipnation');
    const modalBgm = document.getElementById('modal-bgm');
    const closeButton = document.querySelector('.close-button');

    // Faction names localized to Korean
    const factionMap = {
        2: "이글 유니온", 3: "사쿠라 엠파이어", 4: "메탈 블러드", 
        7: "노스 유니온", 10: "아이리스 리브레"
    };

    let allData = {};

    fetch('data/processed_storyline_data.json')
        .then(response => response.json())
        .then(data => {
            allData = data;
            renderTimeline(Object.values(allData));
            // Call setupChapters after a short delay to ensure DOM is fully rendered
            setTimeout(() => setupChapters(Object.values(allData)), 100);
        })
        .catch(error => {
            console.error("Failed to load timeline data:", error);
            timelineContainer.innerHTML = `<p style="color: red; padding: 20px;">Error loading data.</p>`;
        });

    function renderTimeline(items) {
        timelineContainer.innerHTML = '';
        timelineContainer.appendChild(canvas);

        if (items.length === 0) return;
        
        const maxCol = Math.max(...items.map(item => item.column)) + 1;
        const maxRow = Math.max(...items.map(item => item.row)) + 2;

        timelineContainer.style.gridTemplateColumns = `repeat(${maxCol}, 11.25rem)`;
        timelineContainer.style.gridTemplateRows = `repeat(${maxRow}, auto)`;
        
        items.forEach(itemData => {
            const itemElement = createTimelineItem(itemData);
            timelineContainer.appendChild(itemElement);
        });

        requestAnimationFrame(() => drawLines(items.map(item => item.id)));
    }
    
    function createTimelineItem(itemData) {
        const itemElement = document.createElement('div');
        itemElement.className = 'timeline-item';
        itemElement.style.gridColumn = itemData.column;

        let gridRowValue;
        if (itemData.row === -1) {
            gridRowValue = 1; 
        } else {
            gridRowValue = itemData.row + 2;
        }
        itemElement.style.gridRow = gridRowValue;
        
        const keysToStore = ['id', 'name', 'description', 'summary', 'shipnation', 'bgm', 'link_event', 'chapter'];
        keysToStore.forEach(key => {
            if (itemData[key] !== undefined) {
                const value = itemData[key];
                itemElement.dataset[key] = typeof value === 'object' ? JSON.stringify(value) : value;
            }
        });

        const icon = document.createElement('div');
        icon.className = 'item-icon';
        const name = document.createElement('div');
        name.className = 'item-name';
        name.textContent = itemData.name;
        
        itemElement.appendChild(icon);
        itemElement.appendChild(name);
        return itemElement;
    }

    function setupChapters(items) {
        const chapterMarkersContainer = document.getElementById('chapter-markers');
        chapterMarkersContainer.innerHTML = '';

        const timelineScrollWidth = timelineContainer.scrollWidth;
        if (timelineScrollWidth <= 0) return;

        const chaptersData = [];
        const uniqueChapters = [...new Set(items.map(item => item.chapter))].sort((a, b) => a - b);
        
        uniqueChapters.forEach(chapter => {
            const firstItemOfChapter = items.find(item => item.chapter === chapter);
            const domElement = document.querySelector(`.timeline-item[data-id='${firstItemOfChapter.id}']`);
            if (domElement) {
                let chapterText;
                if (chapter === 0) {
                    chapterText = '서장';
                } else {
                    chapterText = `제 ${chapter}장`;
                }

                chaptersData.push({
                    text: chapterText,
                    offsetLeft: domElement.offsetLeft
                });
            }
        });

        chaptersData.forEach(data => {
            const marker = document.createElement('div');
            marker.className = 'chapter-marker';
            marker.textContent = data.text;
            
            const percentage = (data.offsetLeft / timelineScrollWidth) * 100;
            marker.style.left = `${percentage}%`;
            
            marker.onclick = () => {
                const remSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
                const offset = 3.125 * remSize; // Equivalent to 50px at 16px base
                timelineWrapper.scrollTo({
                    left: data.offsetLeft - offset,
                    behavior: 'smooth'
                });
            };
            chapterMarkersContainer.appendChild(marker);
        });
    }

    function drawLines(visibleItemIds) {
        canvas.width = timelineContainer.scrollWidth;
        canvas.height = timelineContainer.scrollHeight;
        
        ctx.strokeStyle = '#9a8c98';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#c9ada7';
        ctx.shadowBlur = 5;

        visibleItemIds.forEach(itemId => {
            const itemData = allData[itemId];
            if (!itemData || !itemData.link_event || String(itemData.link_event).length === 0) return;

            const startNode = document.querySelector(`.timeline-item[data-id='${itemId}']`);
            if (!startNode) return;

            const startX = startNode.offsetLeft + startNode.offsetWidth / 2;
            const startY = startNode.offsetTop + startNode.offsetHeight / 2;
            
            const linkedEvents = Array.isArray(itemData.link_event) ? itemData.link_event : [itemData.link_event];

            linkedEvents.forEach(targetId => {
                const targetData = allData[targetId];
                if (!targetData || !visibleItemIds.includes(targetId)) return;
                const endNode = document.querySelector(`.timeline-item[data-id='${targetId}']`);
                if (!endNode) return;

                const endX = endNode.offsetLeft + endNode.offsetWidth / 2;
                const endY = endNode.offsetTop + endNode.offsetHeight / 2;

                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.lineTo(endX, endY);
                ctx.stroke();
            });
        });
    }

    // Modal Logic
    timelineContainer.addEventListener('click', (event) => {
        const item = event.target.closest('.timeline-item');
        if (!item) return;

        const { name, description, summary, shipnation, bgm } = item.dataset;
        
        modalTitle.textContent = name;
        modalDescription.textContent = description;
        modalSummary.textContent = summary || "No summary available.";
        
        const nations = JSON.parse(shipnation).map(id => factionMap[id] || `Faction ${id}`).join(', ');
        modalShipNation.textContent = nations;

        if (bgm && bgm.trim() !== "") {
            modalBgm.src = `https://github.com/Fernando2603/AzurLane/raw/refs/heads/main/audio/bgm/${bgm}.ogg`;
            modalBgm.volume = 0.2;
            modalBgm.play().catch(e => console.error("Audio playback error:", e));
        } else {
            modalBgm.src = "";
        }
        
        modal.style.display = 'block';
    });
    
    const closeModal = () => {
        modal.style.display = 'none';
        if (modalBgm.src) {
            modalBgm.pause();
            modalBgm.currentTime = 0;
        }
    };

    closeButton.addEventListener('click', closeModal);
    window.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });

    function updateIndicator() {
        const scrollableWidth = timelineWrapper.scrollWidth - timelineWrapper.clientWidth;
        if (scrollableWidth <= 0) {
            indicator.style.transform = `translateX(0px) translateY(-50%)`;
            return;
        }
        const scrollPercentage = timelineWrapper.scrollLeft / scrollableWidth;
        const indicatorMaxPos = progressBarContainer.clientWidth;
        indicator.style.transform = `translateX(${scrollPercentage * indicatorMaxPos}px) translateY(-50%)`;
    }
    
    timelineWrapper.addEventListener('scroll', () => requestAnimationFrame(updateIndicator));

    let isDown = false;
    let startX, startY;
    let scrollLeft, scrollTop;
    timelineWrapper.addEventListener('mousedown', (e) => {
      isDown = true;
      timelineWrapper.classList.add('active');
      startX = e.pageX - timelineWrapper.offsetLeft;
      startY = e.pageY - timelineWrapper.offsetTop;
      scrollLeft = timelineWrapper.scrollLeft;
      scrollTop = timelineWrapper.scrollTop;
    });
    timelineWrapper.addEventListener('mouseleave', () => {
      isDown = false;
      timelineWrapper.classList.remove('active');
    });
    timelineWrapper.addEventListener('mouseup', () => {
      isDown = false;
      timelineWrapper.classList.remove('active');
    });
    timelineWrapper.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      
      const x = e.pageX - timelineWrapper.offsetLeft;
      const walkX = (x - startX) * 2;
      timelineWrapper.scrollLeft = scrollLeft - walkX;
      
      const y = e.pageY - timelineWrapper.offsetTop;
      const walkY = (y - startY) * 2; 
      timelineWrapper.scrollTop = scrollTop - walkY;
    });

    const originalResizeHandler = () => {
        renderTimeline(Object.values(allData));
        setTimeout(() => {
            setupChapters(Object.values(allData));
            updateIndicator();
        }, 100);
    };

    window.addEventListener('resize', () => {
        setResponsiveFontSize();
        originalResizeHandler();
    });
});