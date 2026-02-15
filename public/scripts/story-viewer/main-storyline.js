import { debounce, fetchJSON, hideElement, showElement, resolveUrl } from '../utils.js';

document.addEventListener('DOMContentLoaded', () => {
    // =========================================================================
    // UTILITY FUNCTIONS
    // =========================================================================

    // Removed responsive font sizing - using fixed sizes instead

    // =========================================================================
    // DOM ELEMENTS - Cached for performance
    // =========================================================================
    const elements = {
        loadingOverlay: document.getElementById('loading-overlay'),
        timelineWrapper: document.querySelector('.timeline-wrapper'),
        timelineContainer: document.getElementById('timeline-container'),
        canvas: document.getElementById('timeline-canvas'),
        indicator: document.getElementById('timeline-indicator'),
        progressBarContainer: document.getElementById('progress-bar-container'),
        progressBar: document.getElementById('progress-bar'),
        filterButton: document.getElementById('filter-button'),
        filterPanel: document.getElementById('filter-panel'),
        filterBadge: document.getElementById('filter-badge'),
        searchInput: document.getElementById('search-input'),
        modal: document.getElementById('details-modal'),
        modalTitle: document.getElementById('modal-title'),
        modalDescription: document.getElementById('modal-description'),
        modalSummary: document.getElementById('modal-summary'),
        modalShipNation: document.getElementById('modal-shipnation'),
        modalBgm: document.getElementById('modal-bgm'),
        modalFooter: document.querySelector('#details-modal .modal-footer'),
        closeButton: document.querySelector('.close-button'),
        storyButton: null // Will be created once and reused
    };

    const ctx = elements.canvas.getContext('2d');

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

    // =========================================================================
    // STATE
    // =========================================================================
    let allData = {};
    let allDataArray = []; // Cache Object.values result
    let domElementsCache = new Map(); // Cache for DOM queries

    // =========================================================================
    // DATA LOADING
    // =========================================================================
    fetchJSON('data/story-viewer/main_story_meta.json')
        .then(data => {
            allData = data;
            allDataArray = Object.values(allData); // Cache the array

            renderTimeline(allDataArray);
            populateFilters(allDataArray);
            setupFilterListeners();
            setupSearchListener();
            setupKeyboardNavigation();
            setupProgressBarClick();
            setTimeout(() => {
                setupChapters(allDataArray);
                // Scroll vertically to show rows 2, 3, 4 (skip the first row)
                const firstCard = elements.timelineContainer.querySelector('.timeline-item');
                if (firstCard) {
                    const cardHeight = firstCard.offsetHeight;
                    const gridGapVertical = parseFloat(getComputedStyle(elements.timelineContainer).rowGap) || 60; // 3.75rem = 60px
                    elements.timelineWrapper.scrollTop = cardHeight + gridGapVertical;
                }
                hideLoading();
            }, 100);
        })
        .catch(error => {
            console.error("Failed to load timeline data:", error);
            hideLoading();
            elements.timelineContainer.innerHTML = `<p style="color: var(--text-color); padding: 20px;">데이터 로드 실패. 페이지를 새로고침 해주세요.</p>`;
        });

    function hideLoading() {
        hideElement(elements.loadingOverlay);
    }

    function renderTimeline(items) {
        elements.timelineContainer.innerHTML = '';
        elements.timelineContainer.appendChild(elements.canvas);
        domElementsCache.clear(); // Clear DOM cache when re-rendering

        if (items.length === 0) return;

        const maxCol = Math.max(...items.map(item => item.column)) + 1;
        const maxRow = Math.max(...items.map(item => item.row)) + 2;

        elements.timelineContainer.style.gridTemplateColumns = `repeat(${maxCol}, 13.5rem)`;
        elements.timelineContainer.style.gridTemplateRows = `repeat(${maxRow}, auto)`;

        items.forEach(itemData => {
            const itemElement = createTimelineItem(itemData);
            elements.timelineContainer.appendChild(itemElement);
            // Cache the DOM element
            domElementsCache.set(itemData.id, itemElement);
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

        const timelineScrollWidth = elements.timelineContainer.scrollWidth;
        if (timelineScrollWidth <= 0) return;

        items.sort((a, b) => a.id - b.id);

        const chaptersData = [];
        const uniqueChapters = [...new Set(items.map(item => item.chapter))].sort((a, b) => a - b);

        uniqueChapters.forEach(chapter => {
            const firstItemOfChapter = items.find(item => item.chapter === chapter);
            // Use cached DOM element if available
            const domElement = domElementsCache.get(firstItemOfChapter.id) || document.querySelector(`.timeline-item[data-id='${firstItemOfChapter.id}']`);
            if (domElement) {
                let chapterText;
                if (chapter === 0) {
                    chapterText = '서장';
                } else {
                    chapterText = `제 ${chapter}장`;
                }

                chaptersData.push({
                    text: chapterText,
                    offsetLeft: domElement.offsetLeft,
                    itemId: firstItemOfChapter.id
                });
            }
        });

        chaptersData.forEach(data => {
            const marker = document.createElement('div');
            marker.className = 'chapter-marker';
            marker.textContent = data.text;

            // Position marker based on scrollable position (matches indicator calculation)
            const scrollableWidth = elements.timelineWrapper.scrollWidth - elements.timelineWrapper.clientWidth;
            const percentage = scrollableWidth > 0 ? (data.offsetLeft / scrollableWidth) * 100 : 0;
            marker.style.left = `${percentage}%`;

            marker.onclick = () => {
                // Scroll directly to the item position
                elements.timelineWrapper.scrollTo({
                    left: data.offsetLeft,
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

        elements.filterPanel.innerHTML = filterHtml;
    }

    function setupFilterListeners() {
        elements.filterButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = elements.filterPanel.classList.toggle('hidden');

            // Disable dragging when the filter panel is open
            if (!isHidden) {
                elements.timelineWrapper.style.pointerEvents = 'none';
                elements.timelineWrapper.style.cursor = 'default';
            } else {
                elements.timelineWrapper.style.pointerEvents = 'auto';
                elements.timelineWrapper.style.cursor = 'grab';
            }
        });

        document.addEventListener('click', (e) => {
            if (!elements.filterPanel.contains(e.target) && !elements.filterButton.contains(e.target)) {
                if (!elements.filterPanel.classList.contains('hidden')) {
                    hideElement(elements.filterPanel);
                    // Re-enable dragging when the panel is closed
                    elements.timelineWrapper.style.pointerEvents = 'auto';
                    elements.timelineWrapper.style.cursor = 'grab';
                }
            }
        });

        elements.filterPanel.addEventListener('change', (e) => {
            const allCheckbox = document.getElementById('nation-all');
            const otherCheckboxes = [...elements.filterPanel.querySelectorAll('input[type="checkbox"]')]
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

            const allCheckboxes = [...elements.filterPanel.querySelectorAll('input[type="checkbox"]')];
            if (allCheckboxes.every(cb => !cb.checked)) {
                allCheckbox.checked = true;
            }

            applyFilter();
            updateFilterBadge();
        });
    }

    function updateFilterBadge() {
        const selectedCount = [...elements.filterPanel.querySelectorAll('input[type="checkbox"]:checked')]
            .filter(cb => cb.id !== 'nation-all').length;

        if (selectedCount > 0) {
            elements.filterBadge.textContent = selectedCount;
            showElement(elements.filterBadge);
        } else {
            hideElement(elements.filterBadge);
        }
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

        const selectedNationIds = [...elements.filterPanel.querySelectorAll('input:checked')].map(cb => cb.value);

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
        elements.canvas.width = elements.timelineContainer.scrollWidth;
        elements.canvas.height = elements.timelineContainer.scrollHeight;

        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--line-color') || '#5c677d';
        ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(92, 103, 125, 0.7)';
        ctx.shadowBlur = 7;

        visibleItemIds.forEach(itemId => {
            const itemData = allData[itemId];
            if (!itemData || !itemData.link_event || String(itemData.link_event).length === 0) return;

            // Use cached DOM element if available
            const startNode = domElementsCache.get(itemId) || document.querySelector(`.timeline-item[data-id='${itemId}']`);
            if (!startNode) return;

            const startX = startNode.offsetLeft + startNode.offsetWidth / 2;
            const startY = startNode.offsetTop + startNode.offsetHeight / 2;

            const linkedEvents = Array.isArray(itemData.link_event) ? itemData.link_event : [itemData.link_event];

            linkedEvents.forEach(targetId => {
                const targetData = allData[targetId];
                if (!targetData || !visibleItemIds.includes(targetId)) return;

                // Use cached DOM element if available
                const endNode = domElementsCache.get(targetId) || document.querySelector(`.timeline-item[data-id='${targetId}']`);
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

    elements.timelineContainer.addEventListener('click', (event) => {
        const item = event.target.closest('.timeline-item');
        if (!item) return;

        // The 'id' is now correctly destructured from item.dataset
        const { id, name, description, summary, shipnation, bgm } = item.dataset;

        elements.modalTitle.textContent = name;
        elements.modalDescription.textContent = description;
        elements.modalSummary.textContent = summary || "요약 정보가 없습니다.";

        const nations = JSON.parse(shipnation).map(id => factionMap[id] || `진영 ${id}`).join(', ');
        elements.modalShipNation.textContent = nations;

        // Create or reuse button (performance improvement)
        if (!elements.storyButton) {
            elements.storyButton = document.createElement('button');
            elements.storyButton.id = 'view-story-btn';
            elements.storyButton.textContent = '해당 스토리 보러가기';
            elements.storyButton.className = 'chapter-button';
            elements.storyButton.style.marginTop = '1rem';
            elements.modalFooter.prepend(elements.storyButton);
        }

        // Update onclick handler
        elements.storyButton.onclick = () => {
            window.location.href = resolveUrl(`story-viewer/main-story/?eventid=${id}`);
        };

        if (bgm && bgm.trim() !== "") {
            elements.modalBgm.src = `https://github.com/Fernando2603/AzurLane/raw/refs/heads/main/audio/bgm/${bgm}.ogg`;
            elements.modalBgm.volume = 0.01;
            elements.modalBgm.play().catch(e => console.warn("Audio playback blocked or failed:", e));
        } else {
            elements.modalBgm.src = "";
        }

        elements.modal.style.display = 'block';
    });

    const closeModal = () => {
        elements.modal.style.display = 'none';
        if (elements.modalBgm.src) {
            elements.modalBgm.pause();
            elements.modalBgm.currentTime = 0;
        }
    };

    elements.closeButton.addEventListener('click', closeModal);
    window.addEventListener('click', (event) => {
        if (event.target === elements.modal) closeModal();
    });

    function updateIndicator() {
        const scrollableWidth = elements.timelineWrapper.scrollWidth - elements.timelineWrapper.clientWidth;
        if (scrollableWidth <= 0) {
            elements.indicator.style.left = '0px';
            return;
        }
        const scrollPercentage = elements.timelineWrapper.scrollLeft / scrollableWidth;
        const indicatorMaxPos = elements.progressBarContainer.clientWidth;
        const indicatorPos = scrollPercentage * indicatorMaxPos;
        elements.indicator.style.left = `${indicatorPos}px`;
    }

    elements.timelineWrapper.addEventListener('scroll', () => requestAnimationFrame(updateIndicator));

    let isDown = false;
    let startX, startY;
    let scrollLeft, scrollTop;
    elements.timelineWrapper.addEventListener('mousedown', (e) => {
        if (elements.timelineWrapper.style.pointerEvents === 'none') return;
        if (e.target.closest('.timeline-item')) {
            return;
        }

        isDown = true;
        elements.timelineWrapper.classList.add('active');
        startX = e.pageX - elements.timelineWrapper.offsetLeft;
        startY = e.pageY - elements.timelineWrapper.offsetTop;
        scrollLeft = elements.timelineWrapper.scrollLeft;
        scrollTop = elements.timelineWrapper.scrollTop;
    });
    elements.timelineWrapper.addEventListener('mouseleave', () => {
        isDown = false;
        elements.timelineWrapper.classList.remove('active');
    });
    elements.timelineWrapper.addEventListener('mouseup', () => {
        isDown = false;
        elements.timelineWrapper.classList.remove('active');
    });
    elements.timelineWrapper.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();

        const x = e.pageX - elements.timelineWrapper.offsetLeft;
        const walkX = (x - startX) * 2;
        elements.timelineWrapper.scrollLeft = scrollLeft - walkX;

        const y = e.pageY - elements.timelineWrapper.offsetTop;
        const walkY = (y - startY) * 2;
        elements.timelineWrapper.scrollTop = scrollTop - walkY;
    });

    // =========================================================================
    // SEARCH FUNCTIONALITY
    // =========================================================================
    function setupSearchListener() {
        if (!elements.searchInput) return;

        const debouncedSearch = debounce((searchTerm) => {
            const items = document.querySelectorAll('.timeline-item');
            const term = searchTerm.toLowerCase().trim();

            if (!term) {
                items.forEach(item => {
                    item.classList.remove('dimmed', 'highlighted');
                });
                return;
            }

            items.forEach(item => {
                const name = item.dataset.name?.toLowerCase() || '';
                const description = item.dataset.description?.toLowerCase() || '';
                const chapter = item.dataset.chapter || '';

                if (name.includes(term) || description.includes(term) || chapter.includes(term)) {
                    item.classList.add('highlighted');
                    item.classList.remove('dimmed');
                } else {
                    item.classList.add('dimmed');
                    item.classList.remove('highlighted');
                }
            });
        }, 300);

        elements.searchInput.addEventListener('input', (e) => {
            debouncedSearch(e.target.value);
        });
    }

    // =========================================================================
    // KEYBOARD NAVIGATION
    // =========================================================================
    function setupKeyboardNavigation() {
        document.addEventListener('keydown', (e) => {
            // ESC to close modal
            if (e.key === 'Escape' && elements.modal.style.display === 'block') {
                closeModal();
            }

            // Arrow keys for scrolling timeline
            if (!elements.searchInput || document.activeElement !== elements.searchInput) {
                const scrollAmount = 200;
                switch(e.key) {
                    case 'ArrowLeft':
                        elements.timelineWrapper.scrollLeft -= scrollAmount;
                        e.preventDefault();
                        break;
                    case 'ArrowRight':
                        elements.timelineWrapper.scrollLeft += scrollAmount;
                        e.preventDefault();
                        break;
                    case 'ArrowUp':
                        elements.timelineWrapper.scrollTop -= scrollAmount;
                        e.preventDefault();
                        break;
                    case 'ArrowDown':
                        elements.timelineWrapper.scrollTop += scrollAmount;
                        e.preventDefault();
                        break;
                }
            }
        });
    }

    // =========================================================================
    // INTERACTIVE PROGRESS BAR
    // =========================================================================
    function setupProgressBarClick() {
        if (!elements.progressBar) return;

        elements.progressBar.addEventListener('click', (e) => {
            const rect = elements.progressBar.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percentage = clickX / rect.width;

            const scrollableWidth = elements.timelineWrapper.scrollWidth - elements.timelineWrapper.clientWidth;
            const targetScrollLeft = percentage * scrollableWidth;

            elements.timelineWrapper.scrollTo({
                left: targetScrollLeft,
                behavior: 'smooth'
            });
        });
    }

    // =========================================================================
    // RESIZE HANDLER (DEBOUNCED)
    // =========================================================================
    const debouncedResizeHandler = debounce(() => {
        renderTimeline(allDataArray);
        setTimeout(() => {
            setupChapters(allDataArray);
            updateIndicator();
        }, 100);
    }, 250);

    window.addEventListener('resize', debouncedResizeHandler);
});