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

    // Faction ID to Name mapping
    const factionMap = {
        2: "Eagle Union",
        3: "Sakura Empire",
        4: "Iron Blood",
        7: "Northern Parliament",
        10: "Iris Libre"
    };

    // Fetch and process data from the 'data' folder
    fetch('data/processed_storyline_data.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            const items = Object.values(data);

            if (items.length === 0) return;

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
                icon.className = 'item-icon'; // CSS will style this as a white box

                const name = document.createElement('div');
                name.className = 'item-name';
                name.textContent = itemData.name;

                itemElement.appendChild(icon);
                itemElement.appendChild(name);

                timelineContainer.appendChild(itemElement);
            });

            // Wait for elements to be rendered to draw lines
            setTimeout(() => drawLines(data), 100);
        })
        .catch(error => {
            console.error("Failed to load timeline data:", error);
            timelineContainer.innerHTML = `<p style="color: red;">Error loading data. Please check the file path and JSON format.</p>`;
        });

    function drawLines(data) {
        // Resize canvas to fit the grid
        canvas.width = timelineContainer.scrollWidth;
        canvas.height = timelineContainer.scrollHeight;

        ctx.strokeStyle = '#95a5a6';
        ctx.lineWidth = 3;

        Object.values(data).forEach(itemData => {
            if (!itemData.link_event || String(itemData.link_event).length === 0) return;

            const startNode = document.querySelector(`.timeline-item[data-id='${itemData.id}']`);
            if (!startNode) return;

            // Use position relative to the container itself
            const startX = startNode.offsetLeft + startNode.offsetWidth / 2;
            const startY = startNode.offsetTop + startNode.offsetHeight / 2;
            
            const linkedEvents = Array.isArray(itemData.link_event) ? itemData.link_event : [itemData.link_event];

            linkedEvents.forEach(targetId => {
                const endNode = document.querySelector(`.timeline-item[data-id='${targetId}']`);
                if (!endNode) return;

                const endX = endNode.offsetLeft + endNode.offsetWidth / 2;
                const endY = endNode.offsetTop + endNode.offsetHeight / 2;

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