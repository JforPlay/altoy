document.addEventListener('DOMContentLoaded', () => {
    function setResponsiveFontSize() {
        const baseWidth = 1920;
        const minWidth = 1024;
        const maxWidth = 2560;

        let windowWidth = window.innerWidth;
        if (windowWidth < minWidth) windowWidth = minWidth;
        if (windowWidth > maxWidth) windowWidth = maxWidth;

        const scaleFactor = windowWidth / baseWidth;
        const baseFontSize = 16;

        document.documentElement.style.fontSize = `${baseFontSize * scaleFactor}px`;
    }

    setResponsiveFontSize();
    window.addEventListener('resize', setResponsiveFontSize);

    const timelineWrapper = document.querySelector('.timeline-wrapper');
    const timelineContainer = document.getElementById('timeline-container');
    const canvas = document.getElementById('timeline-canvas');
    const ctx = canvas.getContext('2d');
    const indicator = document.getElementById('timeline-indicator');
    const progressBarContainer = document.getElementById('progress-bar-container');
    const filterButton = document.getElementById('filter-button');
    const filterPanel = document.getElementById('filter-panel');

    const modal = document.getElementById('details-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalDescription = document.getElementById('modal-description');
    const modalSummary = document.getElementById('modal-summary');
    const modalShipNation = document.getElementById('modal-shipnation');
    const modalBgm = document.getElementById('modal-bgm');
    const closeButton = document.querySelector('.close-button');

    const factionMap = {
        1: "이글 유니온",
        2: "로열 네이비",
        3: "사쿠라 엠파이어",
        4: "메탈 블러드",
        5: "이스트 글림",
        6: "사르데냐 엠파이어",
        7: "노스 유니온",
        8: "아이리스 리브레",
        9: "비시아 성좌",
        10: "아이리스 연합",
        96: "템페스타",
        97: "META"
    };

    let allData = {};

    fetch('data/processed_storyline_data.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            allData = data;
            renderTimeline(Object.values(allData));
            populateFilters(Object.values(allData));
            setupFilterListeners();
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

        // CHANGE: Grid column width increased to match the new card width
        timelineContainer.style.gridTemplateColumns = `repeat(${maxCol}, 13.5rem)`;
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
        if (itemData.icon) {
            icon.style.backgroundImage = `url('https://raw.githubusercontent.com/JforPlay/data_for_toy/main/memorystoryline/${itemData.icon}.png')`;
            icon.style.backgroundSize = 'cover';
            icon.style.backgroundPosition = 'center';
            icon.style.backgroundColor = 'transparent'; // Remove placeholder color if image exists
        }
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

        items.sort((a, b) => a.id - b.id);

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
                // Calculate the precise scroll position that will align the indicator with this marker.
                const scrollableWidth = timelineWrapper.scrollWidth - timelineWrapper.clientWidth;
                const targetScrollLeft = (data.offsetLeft / timelineScrollWidth) * scrollableWidth;

                timelineWrapper.scrollTo({
                    left: targetScrollLeft,
                    behavior: 'smooth'
                });
            };
            chapterMarkersContainer.appendChild(marker);
        });
    }

    function populateFilters(items) {
        const uniqueNations = new Map();
        items.forEach(item => {
            if (item.shipnation) {
                const nations = item.shipnation;
                nations.forEach(nationId => {
                    if (!uniqueNations.has(nationId) && factionMap[nationId]) {
                        uniqueNations.set(nationId, factionMap[nationId]);
                    }
                });
            }
        });

        let filterHtml = `
            <div class="filter-option">
                <input type="checkbox" id="nation-all" value="all" checked>
                <label for="nation-all">전체</label>
            </div>`;

        const sortedNations = [...uniqueNations.entries()].sort((a, b) => a[0] - b[0]);

        sortedNations.forEach(([id, name]) => {
            filterHtml += `
                <div class="filter-option">
                    <input type="checkbox" id="nation-${id}" value="${id}">
                    <label for="nation-${id}">${name}</label>
                </div>`;
        });

        filterPanel.innerHTML = filterHtml;
    }

    function setupFilterListeners() {
        filterButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = filterPanel.classList.toggle('hidden');

            // Disable dragging when the filter panel is open
            if (!isHidden) {
                timelineWrapper.style.pointerEvents = 'none';
                timelineWrapper.style.cursor = 'default';
            } else {
                timelineWrapper.style.pointerEvents = 'auto';
                timelineWrapper.style.cursor = 'grab';
            }
        });

        document.addEventListener('click', (e) => {
            if (!filterPanel.contains(e.target) && !filterButton.contains(e.target)) {
                if (!filterPanel.classList.contains('hidden')) {
                    filterPanel.classList.add('hidden');
                    // Re-enable dragging when the panel is closed
                    timelineWrapper.style.pointerEvents = 'auto';
                    timelineWrapper.style.cursor = 'grab';
                }
            }
        });

        filterPanel.addEventListener('change', (e) => {
            const allCheckbox = document.getElementById('nation-all');
            const otherCheckboxes = [...filterPanel.querySelectorAll('input[type="checkbox"]')]
                .filter(cb => cb.id !== 'nation-all');

            if (e.target.id === 'nation-all') {
                if (allCheckbox.checked) {
                    otherCheckboxes.forEach(cb => cb.checked = false);
                }
            } else {
                if (otherCheckboxes.some(cb => cb.checked)) {
                    allCheckbox.checked = false;
                }
            }

            const allCheckboxes = [...filterPanel.querySelectorAll('input[type="checkbox"]')];
            if (allCheckboxes.every(cb => !cb.checked)) {
                allCheckbox.checked = true;
            }

            applyFilter();
        });
    }

    function applyFilter() {
        const allCheckbox = document.getElementById('nation-all');
        const timelineItems = document.querySelectorAll('.timeline-item');

        if (allCheckbox.checked) {
            timelineItems.forEach(item => {
                item.classList.remove('dimmed', 'highlighted');
            });
            return;
        }

        const selectedNationIds = [...filterPanel.querySelectorAll('input:checked')].map(cb => cb.value);

        timelineItems.forEach(item => {
            const itemNationIds = JSON.parse(item.dataset.shipnation || '[]');
            const isMatch = itemNationIds.some(id => selectedNationIds.includes(String(id)));

            if (isMatch) {
                item.classList.add('highlighted');
                item.classList.remove('dimmed');
            } else {
                item.classList.add('dimmed');
                item.classList.remove('highlighted');
            }
        });
    }

    // draw lines between linked events
    function drawLines(visibleItemIds) {
        canvas.width = timelineContainer.scrollWidth;
        canvas.height = timelineContainer.scrollHeight;

        ctx.strokeStyle = '#5c677d';
        ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(92, 103, 125, 0.7)';
        ctx.shadowBlur = 7;

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

    timelineContainer.addEventListener('click', (event) => {
        const item = event.target.closest('.timeline-item');
        if (!item) return;

        // The 'id' is now correctly destructured from item.dataset
        const { id, name, description, summary, shipnation, bgm } = item.dataset;

        modalTitle.textContent = name;
        modalDescription.textContent = description;
        modalSummary.textContent = summary || "No summary available.";

        const nations = JSON.parse(shipnation).map(id => factionMap[id] || `Faction ${id}`).join(', ');
        modalShipNation.textContent = nations;

        const modalFooter = document.querySelector('#details-modal .modal-footer');
        const oldBtn = document.getElementById('view-story-btn');
        if (oldBtn) oldBtn.remove();

        const storyButton = document.createElement('button');
        storyButton.id = 'view-story-btn';
        storyButton.textContent = '해당 스토리 보러가기'; // Updated Text
        storyButton.className = 'chapter-button';
        storyButton.style.marginTop = '1rem';
        storyButton.onclick = () => {
            // This now correctly links to the Tier 2 memory selection page
            window.location.href = `main-story-viewer.html?eventId=${id}`;
        };
        modalFooter.prepend(storyButton);

        if (bgm && bgm.trim() !== "") {
            modalBgm.src = `https://github.com/Fernando2603/AzurLane/raw/refs/heads/main/audio/bgm/${bgm}.ogg`;
            modalBgm.volume = 0.01;
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
        if (timelineWrapper.style.pointerEvents === 'none') return;
        if (e.target.closest('.timeline-item')) {
            return;
        }

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