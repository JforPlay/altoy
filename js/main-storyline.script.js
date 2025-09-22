document.addEventListener('DOMContentLoaded', () => {
    const timelineContainer = document.getElementById('timeline-container');
    const canvas = document.getElementById('timeline-canvas');
    const ctx = canvas.getContext('2d');
    const chapterNav = document.getElementById('chapter-navigation');

    // Modal elements
    const modal = document.getElementById('details-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalDescription = document.getElementById('modal-description');
    const modalSummary = document.getElementById('modal-summary');
    const modalShipNation = document.getElementById('modal-shipnation');
    const modalBgm = document.getElementById('modal-bgm');
    const closeButton = document.querySelector('.close-button');

    const factionMap = {
        2: "Eagle Union", 3: "Sakura Empire", 4: "Iron Blood", 
        7: "Northern Parliament", 10: "Iris Libre"
    };

    let allData = {};

    fetch('data/processed_storyline_data.json')
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            allData = data;
            renderTimeline(Object.values(allData));
            setupChapters(Object.values(allData));
        })
        .catch(error => {
            console.error("Failed to load timeline data:", error);
            timelineContainer.innerHTML = `<p style="color: red; padding: 20px;">Error loading data. Please check the file path ('data/processed_storyline_data.json') and ensure the JSON format is correct.</p>`;
        });

    function renderTimeline(items) {
        timelineContainer.innerHTML = ''; // Clear previous items
        timelineContainer.appendChild(canvas); // Re-add canvas

        if (items.length === 0) return;
        
        const maxCol = Math.max(...items.map(item => item.column)) + 1;
        const maxRow = Math.max(...items.map(item => item.row)) + 1;

        timelineContainer.style.gridTemplateColumns = `repeat(${maxCol}, 180px)`;
        timelineContainer.style.gridTemplateRows = `repeat(${maxRow}, auto)`;
        
        items.forEach(itemData => {
            const itemElement = createTimelineItem(itemData);
            timelineContainer.appendChild(itemElement);
        });

        // Use requestAnimationFrame for smoother rendering
        requestAnimationFrame(() => drawLines(items.map(item => item.id)));
    }
    
    function createTimelineItem(itemData) {
        const itemElement = document.createElement('div');
        itemElement.className = 'timeline-item';
        itemElement.style.gridColumn = itemData.column;
        itemElement.style.gridRow = itemData.row + 1;
        
        Object.keys(itemData).forEach(key => {
             itemElement.dataset[key] = typeof itemData[key] === 'object' ? JSON.stringify(itemData[key]) : itemData[key];
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
        const chapters = [...new Set(items.map(item => item.chapter))].sort((a, b) => a - b);
        chapters.unshift('All'); // Add an 'All' button

        chapterNav.innerHTML = ''; // Clear existing buttons
        chapters.forEach(chapter => {
            const button = document.createElement('button');
            button.className = 'chapter-button';
            button.textContent = chapter === 'All' ? 'All Chapters' : `Chapter ${chapter}`;
            button.onclick = () => {
                const filteredItems = chapter === 'All' 
                    ? Object.values(allData) 
                    : Object.values(allData).filter(item => item.chapter === chapter);
                renderTimeline(filteredItems);
            };
            chapterNav.appendChild(button);
        });
    }

    function drawLines(visibleItemIds) {
        const containerRect = timelineContainer.getBoundingClientRect();
        canvas.width = timelineContainer.scrollWidth;
        canvas.height = containerRect.height;
        
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
                if (!visibleItemIds.includes(targetId)) return; // Only draw lines to visible items
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

    // Redraw lines on window resize to ensure they stay connected
    window.addEventListener('resize', () => {
        renderTimeline(Object.values(allData));
    });
});
