document.addEventListener('DOMContentLoaded', () => {
    const timelineContainer = document.getElementById('timeline-container');
    const canvas = document.getElementById('timeline-canvas');
    const ctx = canvas.getContext('2d');

    // Modal elements
    const modal = document.getElementById('details-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalDescription = document.getElementById('modal-description');
    const modalSummary = document.getElementById('modal-summary');
    const modalShipNation = document.getElementById('modal-shipnation');
    const modalBgm = document.getElementById('modal-bgm');
    const closeButton = document.querySelector('.close-button');
    
    // Faction ID to Name mapping (example)
    const factionMap = {
        2: "Eagle Union",
        3: "Sakura Empire",
        4: "Iron Blood",
        7: "Northern Parliament",
        10: "Iris Libre"
    };

    // Fetch and process data
    fetch('data/processed_storyline_data.json')
        .then(response => response.json())
        .then(data => {
            const items = Object.values(data);
            
            // Determine grid size
            const maxCol = Math.max(...items.map(item => item.column)) + 1;
            const maxRow = Math.max(...items.map(item => item.row)) + 1;
            
            timelineContainer.style.gridTemplateColumns = `repeat(${maxCol}, 120px)`;
            timelineContainer.style.gridTemplateRows = `repeat(${maxRow}, auto)`;

            // Create and place items
            items.forEach(itemData => {
                const itemElement = document.createElement('div');
                itemElement.className = 'timeline-item';
                itemElement.style.gridColumn = itemData.column + 1;
                itemElement.style.gridRow = itemData.row + 1;
                
                // Store data for the modal
                itemElement.dataset.id = itemData.id;
                itemElement.dataset.name = itemData.name;
                itemElement.dataset.description = itemData.description;
                itemElement.dataset.summary = itemData.summary || "No summary available.";
                itemElement.dataset.shipnation = JSON.stringify(itemData.shipnation);
                itemElement.dataset.bgm = itemData.bgm;
                
                // Create icon and name elements
                const icon = document.createElement('div');
                icon.className = 'item-icon';
                icon.textContent = itemData.icon; // Placeholder
                
                const name = document.createElement('div');
                name.className = 'item-name';
                name.textContent = itemData.name;
                
                itemElement.appendChild(icon);
                itemElement.appendChild(name);
                
                timelineContainer.appendChild(itemElement);
            });

            // Wait for elements to be in the DOM to draw lines
            setTimeout(() => drawLines(data), 100);
        });

    function drawLines(data) {
        // Resize canvas to fit the grid
        canvas.width = timelineContainer.scrollWidth;
        canvas.height = timelineContainer.scrollHeight;

        ctx.strokeStyle = '#7f8c8d';
        ctx.lineWidth = 2;

        Object.values(data).forEach(itemData => {
            if (!itemData.link_event || itemData.link_event.length === 0) return;
            
            const startNode = document.querySelector(`.timeline-item[data-id='${itemData.id}']`);
            if (!startNode) return;

            const startRect = startNode.getBoundingClientRect();
            const containerRect = timelineContainer.getBoundingClientRect();

            // Calculate center of the start node relative to the container
            const startX = startRect.left - containerRect.left + startRect.width / 2;
            const startY = startRect.top - containerRect.top + startRect.height / 2;
            
            // Ensure link_event is an array
            const linkedEvents = Array.isArray(itemData.link_event) ? itemData.link_event : [itemData.link_event];

            linkedEvents.forEach(targetId => {
                const endNode = document.querySelector(`.timeline-item[data-id='${targetId}']`);
                if (!endNode) return;

                const endRect = endNode.getBoundingClientRect();
                
                // Calculate center of the end node relative to the container
                const endX = endRect.left - containerRect.left + endRect.width / 2;
                const endY = endRect.top - containerRect.top + endRect.height / 2;
                
                // Draw line
                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.lineTo(endX, endY);
                ctx.stroke();
            });
        });
    }

    // Modal logic
    timelineContainer.addEventListener('click', (event) => {
        const item = event.target.closest('.timeline-item');
        if (!item) return;

        const { name, description, summary, shipnation, bgm } = item.dataset;
        
        modalTitle.textContent = name;
        modalDescription.textContent = description;
        modalSummary.textContent = summary;
        
        const nations = JSON.parse(shipnation).map(id => factionMap[id] || `Faction ${id}`).join(', ');
        modalShipNation.textContent = nations;

        if (bgm) {
            modalBgm.src = `https://github.com/Fernando2603/AzurLane/raw/refs/heads/main/audio/bgm/${bgm}.ogg`;
            modalBgm.play();
        } else {
            modalBgm.src = "";
        }
        
        modal.style.display = 'block';
    });
    
    const closeModal = () => {
        modal.style.display = 'none';
        modalBgm.pause();
        modalBgm.currentTime = 0;
    };

    closeButton.addEventListener('click', closeModal);
    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeModal();
        }
    });
});