// Event Carousel Handler
(function () {
    const API_URL = 'https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/activity_banner.json';
    const IMAGE_BASE_URL = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/activitybanner/';

    let currentIndex = 0;
    let banners = [];
    let autoplayInterval = null;

    // DOM Elements
    const track = document.querySelector('.event-carousel-track');
    const indicatorsContainer = document.querySelector('.event-carousel-indicators');
    const prevButton = document.querySelector('.event-carousel-nav.prev');
    const nextButton = document.querySelector('.event-carousel-nav.next');
    const loadingIndicator = document.querySelector('.event-carousel-loading');

    // Type names mapping
    const typeNames = {
        1: '이벤트',
        2: '상점',
        3: '공지',
        4: '시스템',
        9: '기타'
    };

    // Parse date from array format
    function parseDate(dateArray) {
        if (!Array.isArray(dateArray) || dateArray.length < 2) return null;
        const [date, time] = dateArray;
        return new Date(date[0], date[1] - 1, date[2], time[0] || 0, time[1] || 0, time[2] || 0);
    }

    // Check if banner is currently active
    function isActiveBanner(banner) {
        // Ignore banners without time field
        if (!banner.time) {
            return false;
        }

        // Ignore stopped banners
        if (banner.time === 'stop') {
            return false;
        }

        // Include always-active banners
        if (banner.time === 'always') {
            return false;
        }

        if (Array.isArray(banner.time) && banner.time.length === 2) {
            const now = new Date();
            const startDate = parseDate(banner.time[0]);
            const endDate = parseDate(banner.time[1]);

            if (startDate && endDate) {
                return now >= startDate && now <= endDate;
            }
        }

        return false;
    }

    // Format date for display
    function formatDate(dateArray) {
        const date = parseDate(dateArray);
        if (!date) return '';

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');

        return `${year}.${month}.${day}`;
    }

    // Create banner element
    function createBannerElement(banner, index) {
        const bannerDiv = document.createElement('div');
        bannerDiv.className = 'event-banner';
        bannerDiv.dataset.index = index;

        const img = document.createElement('img');
        img.src = `${IMAGE_BASE_URL}${banner.pic}.png`;
        img.alt = `Event Banner ${banner.id}`;
        img.loading = 'lazy';

        // Error handling for missing images
        img.onerror = function () {
            this.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 200"%3E%3Crect fill="%23141414" width="800" height="200"/%3E%3Ctext x="400" y="100" font-family="Arial" font-size="20" fill="%23666" text-anchor="middle"%3E이미지를 불러올 수 없습니다%3C/text%3E%3C/svg%3E';
        };

        const overlay = document.createElement('div');
        overlay.className = 'event-banner-overlay';

        const typeSpan = document.createElement('span');
        typeSpan.className = 'event-banner-type';
        typeSpan.textContent = typeNames[banner.type] || '이벤트';

        const dateDiv = document.createElement('div');
        dateDiv.className = 'event-banner-date';

        if (banner.time && Array.isArray(banner.time) && banner.time.length === 2) {
            const startDate = formatDate(banner.time[0]);
            const endDate = formatDate(banner.time[1]);
            dateDiv.textContent = `${startDate} ~ ${endDate}`;
        } else {
            dateDiv.textContent = '상시 진행';
        }

        overlay.appendChild(typeSpan);
        overlay.appendChild(dateDiv);
        bannerDiv.appendChild(img);
        bannerDiv.appendChild(overlay);

        return bannerDiv;
    }

    // Create indicator element
    function createIndicator(index) {
        const indicator = document.createElement('button');
        indicator.className = 'event-indicator';
        indicator.setAttribute('aria-label', `Go to event ${index + 1}`);
        indicator.dataset.index = index;

        if (index === 0) {
            indicator.classList.add('active');
        }

        indicator.addEventListener('click', () => goToSlide(index));
        return indicator;
    }

    // Update carousel position
    function updateCarousel() {
        const offset = -100 * currentIndex;
        track.style.transform = `translateX(${offset}%)`;

        // Update indicators
        document.querySelectorAll('.event-indicator').forEach((indicator, index) => {
            indicator.classList.toggle('active', index === currentIndex);
        });
    }

    // Go to specific slide
    function goToSlide(index) {
        currentIndex = index;
        updateCarousel();
        resetAutoplay();
    }

    // Next slide
    function nextSlide() {
        currentIndex = (currentIndex + 1) % banners.length;
        updateCarousel();
    }

    // Previous slide
    function prevSlide() {
        currentIndex = (currentIndex - 1 + banners.length) % banners.length;
        updateCarousel();
    }

    // Autoplay functionality
    function startAutoplay() {
        if (banners.length <= 1) return;
        autoplayInterval = setInterval(nextSlide, 5000);
    }

    function stopAutoplay() {
        if (autoplayInterval) {
            clearInterval(autoplayInterval);
            autoplayInterval = null;
        }
    }

    function resetAutoplay() {
        stopAutoplay();
        startAutoplay();
    }

    // Show empty state
    function showEmptyState() {
        track.innerHTML = `
            <div class="event-carousel-empty">
                <i class="fas fa-calendar-xmark"></i>
                <p>진행중인 이벤트가 없습니다</p>
            </div>
        `;

        if (prevButton) prevButton.style.display = 'none';
        if (nextButton) nextButton.style.display = 'none';
        indicatorsContainer.style.display = 'none';
    }

    // Fetch and display banners
    async function loadBanners() {
        try {
            const response = await fetch(API_URL);
            if (!response.ok) throw new Error('Failed to fetch banners');

            const data = await response.json();

            // Filter active banners
            banners = Object.values(data)
                .filter(banner => isActiveBanner(banner))
                .sort((a, b) => {
                    // Sort by type (events first) then by ID
                    if (a.type !== b.type) return a.type - b.type;
                    return a.id - b.id;
                });

            if (loadingIndicator) {
                loadingIndicator.classList.add('hidden');
            }

            if (banners.length === 0) {
                showEmptyState();
                return;
            }

            // Clear existing content
            track.innerHTML = '';
            indicatorsContainer.innerHTML = '';

            // Create banner elements
            banners.forEach((banner, index) => {
                track.appendChild(createBannerElement(banner, index));
                indicatorsContainer.appendChild(createIndicator(index));
            });

            // Setup controls
            if (banners.length > 1) {
                if (prevButton) {
                    prevButton.style.display = 'flex';
                    prevButton.addEventListener('click', prevSlide);
                }
                if (nextButton) {
                    nextButton.style.display = 'flex';
                    nextButton.addEventListener('click', nextSlide);
                }

                // Mouse events for autoplay
                const carousel = document.querySelector('.event-carousel');
                if (carousel) {
                    carousel.addEventListener('mouseenter', stopAutoplay);
                    carousel.addEventListener('mouseleave', startAutoplay);
                }

                // Touch events for mobile
                let touchStartX = 0;
                let touchEndX = 0;

                track.addEventListener('touchstart', (e) => {
                    touchStartX = e.changedTouches[0].screenX;
                    stopAutoplay();
                });

                track.addEventListener('touchend', (e) => {
                    touchEndX = e.changedTouches[0].screenX;
                    if (touchEndX < touchStartX - 50) {
                        nextSlide();
                    } else if (touchEndX > touchStartX + 50) {
                        prevSlide();
                    }
                    resetAutoplay();
                });

                startAutoplay();
            } else {
                if (prevButton) prevButton.style.display = 'none';
                if (nextButton) nextButton.style.display = 'none';
                indicatorsContainer.style.display = 'none';
            }

        } catch (error) {
            console.error('Error loading event banners:', error);
            if (loadingIndicator) {
                loadingIndicator.textContent = '이벤트 배너를 불러올 수 없습니다';
            }
            showEmptyState();
        }
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadBanners);
    } else {
        loadBanners();
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', stopAutoplay);
})();