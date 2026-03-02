import { hideElement, getStorageItem, setStorageItem, fetchJSONWithCache } from './utils.js';
// =====================================================
// MAINPAGE SCRIPT - MERGED & OPTIMIZED
// Combines hero carousel, event carousel, and card animations
// =====================================================

// ===== SHARED UTILITIES =====

/**
 * Shared carousel utilities to avoid code duplication
 */
const CarouselUtils = {
    /**
     * Handle touch events for carousel swiping
     * @param {HTMLElement} element - Element to attach touch handlers to
     * @param {Function} onSwipeLeft - Callback for left swipe
     * @param {Function} onSwipeRight - Callback for right swipe
     * @param {Function} onTouchStart - Optional callback on touch start
     * @param {Function} onTouchEnd - Optional callback on touch end
     */
    setupTouchHandlers(element, onSwipeLeft, onSwipeRight, onTouchStart, onTouchEnd) {
        let touchStartX = 0;
        let touchStartY = 0;

        element.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
            if (onTouchStart) onTouchStart();
        });

        element.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].screenX;
            const touchEndY = e.changedTouches[0].screenY;

            const deltaX = touchEndX - touchStartX;
            const deltaY = touchEndY - touchStartY;

            // Only trigger if horizontal swipe is dominant (prevents scroll interference)
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
                if (deltaX < 0) {
                    onSwipeLeft();
                } else {
                    onSwipeRight();
                }
            }
            if (onTouchEnd) onTouchEnd();
        });
    },

    /**
     * Autoplay manager for carousels
     * @param {Function} callback - Function to call on interval
     * @param {number} interval - Interval in milliseconds
     * @returns {Object} - Controller object with start, stop, reset methods
     */
    createAutoplay(callback, interval = 5000) {
        let timer = null;

        return {
            start() {
                this.stop();
                timer = setInterval(callback, interval);
            },
            stop() {
                if (timer) {
                    clearInterval(timer);
                    timer = null;
                }
            },
            reset() {
                this.stop();
                this.start();
            }
        };
    }
};

// =====================================================
// HERO CAROUSEL
// =====================================================

function initHeroCarousel() {
    const carousel = document.querySelector('.hero-carousel');
    if (!carousel) return;

    const track = carousel.querySelector('.carousel-track');
    const slides = Array.from(track?.children || []);
    const nextButton = carousel.querySelector('.carousel-nav.next');
    const prevButton = carousel.querySelector('.carousel-nav.prev');
    const indicatorsContainer = carousel.querySelector('.carousel-indicators');

    if (!track || slides.length === 0) {
        console.warn('[Hero Carousel] Elements not found');
        return;
    }

    let currentIndex = 0;
    const totalSlides = slides.length;

    // Clear and create indicators
    indicatorsContainer.innerHTML = '';
    const indicators = slides.map((_, index) => {
        const indicator = document.createElement('button');
        indicator.classList.add('indicator');
        indicator.setAttribute('aria-label', `Go to slide ${index + 1}`);
        if (index === 0) indicator.classList.add('active');
        indicator.addEventListener('click', () => goToSlide(index));
        indicatorsContainer.appendChild(indicator);
        return indicator;
    });

    // Set initial state
    slides[0].classList.add('active');

    function updateCarousel() {
        slides.forEach((slide, i) => {
            slide.classList.toggle('active', i === currentIndex);
        });
        indicators.forEach((ind, i) => {
            ind.classList.toggle('active', i === currentIndex);
        });
        track.style.transform = `translateX(${-100 * currentIndex}%)`;
    }

    function goToSlide(index) {
        currentIndex = index;
        updateCarousel();
        autoplay.reset();
    }

    function nextSlide() {
        currentIndex = (currentIndex + 1) % totalSlides;
        updateCarousel();
    }

    function prevSlide() {
        currentIndex = (currentIndex - 1 + totalSlides) % totalSlides;
        updateCarousel();
    }

    // Setup autoplay
    const autoplay = CarouselUtils.createAutoplay(nextSlide, 5000);

    // Navigation buttons
    if (nextButton) {
        nextButton.addEventListener('click', () => {
            nextSlide();
            autoplay.reset();
        });
    }
    if (prevButton) {
        prevButton.addEventListener('click', () => {
            prevSlide();
            autoplay.reset();
        });
    }

    // Mouse events
    carousel.addEventListener('mouseenter', () => autoplay.stop());
    carousel.addEventListener('mouseleave', () => autoplay.start());

    // Touch events
    CarouselUtils.setupTouchHandlers(
        track,
        nextSlide,
        prevSlide,
        () => autoplay.stop(),
        () => autoplay.reset()
    );

    autoplay.start();
}

// =====================================================
// EVENT BANNER CAROUSEL
// =====================================================

const EventCarousel = (function () {
    const API_URL = 'https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/ShareCfg/activity_banner.json';
    const IMAGE_BASE_URL = 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/activitybanner/';
    const CACHE_KEY = 'eventBannersCache';
    const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

    let currentIndex = 0;
    let banners = [];
    let autoplay = null;

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
        if (!banner.time || banner.time === 'stop') return false;
        if (banner.time === 'always') return false;

        if (Array.isArray(banner.time) && banner.time.length === 2) {
            const now = new Date();
            const startDate = parseDate(banner.time[0]);
            const endDate = parseDate(banner.time[1]);
            return startDate && endDate && now >= startDate && now <= endDate;
        }

        return false;
    }

    // Format date for display
    function formatDate(dateArray) {
        const date = parseDate(dateArray);
        if (!date) return '';
        return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
    }

    // Create banner element
    function createBannerElement(banner) {
        const bannerDiv = document.createElement('div');
        bannerDiv.className = 'event-banner';

        const img = document.createElement('img');
        img.src = `${IMAGE_BASE_URL}${banner.pic}.webp`;
        img.alt = `Event Banner ${banner.id}`;
        img.loading = 'lazy';
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
            dateDiv.textContent = `${formatDate(banner.time[0])} ~ ${formatDate(banner.time[1])}`;
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
        if (index === 0) indicator.classList.add('active');
        indicator.addEventListener('click', () => goToSlide(index));
        return indicator;
    }

    // Update carousel position (optimized - no repeated DOM queries)
    function updateCarousel(indicatorsArray) {
        const track = document.querySelector('.event-carousel-track');
        track.style.transform = `translateX(${-100 * currentIndex}%)`;

        // Update indicators efficiently
        indicatorsArray.forEach((indicator, index) => {
            indicator.classList.toggle('active', index === currentIndex);
        });
    }

    // Go to specific slide
    function goToSlide(index) {
        currentIndex = index;
        const indicators = Array.from(document.querySelectorAll('.event-indicator'));
        updateCarousel(indicators);
        if (autoplay) autoplay.reset();
    }

    // Next/previous slide
    function nextSlide() {
        currentIndex = (currentIndex + 1) % banners.length;
        const indicators = Array.from(document.querySelectorAll('.event-indicator'));
        updateCarousel(indicators);
    }

    function prevSlide() {
        currentIndex = (currentIndex - 1 + banners.length) % banners.length;
        const indicators = Array.from(document.querySelectorAll('.event-indicator'));
        updateCarousel(indicators);
    }

    // Show empty state
    function showEmptyState() {
        const track = document.querySelector('.event-carousel-track');
        const prevButton = document.querySelector('.event-carousel-nav.prev');
        const nextButton = document.querySelector('.event-carousel-nav.next');
        const indicatorsContainer = document.querySelector('.event-carousel-indicators');

        track.innerHTML = `
            <div class="event-carousel-empty">
                <i class="fas fa-calendar-xmark"></i>
                <p>진행중인 이벤트가 없습니다</p>
            </div>
        `;

        if (prevButton) prevButton.style.display = 'none';
        if (nextButton) nextButton.style.display = 'none';
        if (indicatorsContainer) indicatorsContainer.style.display = 'none';
    }

    // Cache management
    function getCachedData() {
        try {
            const cached = getStorageItem(CACHE_KEY, null);
            if (!cached) return null;

            const { data, timestamp } = JSON.parse(cached);
            const now = Date.now();

            if (now - timestamp > CACHE_DURATION) {
                localStorage.removeItem(CACHE_KEY);
                return null;
            }

            return data;
        } catch (e) {
            console.warn('[Event Carousel] Cache read error:', e);
            return null;
        }
    }

    function setCachedData(data) {
        try {
            setStorageItem(CACHE_KEY, JSON.stringify({
                data,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.warn('[Event Carousel] Cache write error:', e);
        }
    }

    // Fetch and display banners
    async function loadBanners() {
        const track = document.querySelector('.event-carousel-track');
        const indicatorsContainer = document.querySelector('.event-carousel-indicators');
        const prevButton = document.querySelector('.event-carousel-nav.prev');
        const nextButton = document.querySelector('.event-carousel-nav.next');
        const loadingIndicator = document.querySelector('.event-carousel-loading');

        if (!track || !indicatorsContainer) {
            console.warn('[Event Carousel] Required elements not found');
            return;
        }

        try {
            // Try cache first
            let data = getCachedData();

            if (!data) {
                const response = await fetch(API_URL);
                if (!response.ok) throw new Error('Failed to fetch banners');
                data = await response.json();
                setCachedData(data);
            }

            // Filter active banners
            banners = Object.values(data)
                .filter(banner => isActiveBanner(banner))
                .sort((a, b) => {
                    if (a.type !== b.type) return a.type - b.type;
                    return a.id - b.id;
                });

            hideElement(loadingIndicator);

            if (banners.length === 0) {
                showEmptyState();
                return;
            }

            // Clear existing content
            track.innerHTML = '';
            indicatorsContainer.innerHTML = '';

            // Create elements
            const indicatorsArray = [];
            banners.forEach((banner, index) => {
                track.appendChild(createBannerElement(banner));
                const indicator = createIndicator(index);
                indicatorsContainer.appendChild(indicator);
                indicatorsArray.push(indicator);
            });

            // Setup controls
            if (banners.length > 1) {
                if (prevButton) {
                    prevButton.style.display = 'flex';
                    prevButton.addEventListener('click', prevSlide, { once: false });
                }
                if (nextButton) {
                    nextButton.style.display = 'flex';
                    nextButton.addEventListener('click', nextSlide, { once: false });
                }

                // Setup autoplay
                autoplay = CarouselUtils.createAutoplay(nextSlide, 5000);

                // Mouse events
                const carousel = document.querySelector('.event-carousel');
                if (carousel) {
                    carousel.addEventListener('mouseenter', () => autoplay.stop());
                    carousel.addEventListener('mouseleave', () => autoplay.start());
                }

                // Touch events
                CarouselUtils.setupTouchHandlers(
                    track,
                    nextSlide,
                    prevSlide,
                    () => autoplay.stop(),
                    () => autoplay.reset()
                );

                autoplay.start();
            } else {
                if (prevButton) prevButton.style.display = 'none';
                if (nextButton) nextButton.style.display = 'none';
                indicatorsContainer.style.display = 'none';
            }

        } catch (error) {
            console.error('[Event Carousel] Error loading banners:', error);
            if (loadingIndicator) {
                loadingIndicator.textContent = '이벤트 배너를 불러올 수 없습니다';
            }
            showEmptyState();
        }
    }

    // Cleanup
    function cleanup() {
        if (autoplay) autoplay.stop();
    }

    return {
        init: loadBanners,
        cleanup
    };
})();

// =====================================================
// BIRTHDAY SECTION
// =====================================================

const BirthdaySection = (function () {
    const birthdayList = document.getElementById('birthdayList');
    if (!birthdayList) return { init() {} };

    const titleText = document.querySelector('.birthday-title-text');
    const moreLink = document.querySelector('.birthday-more-link');
    const dateEl = document.getElementById('birthdayDate');

    function getBasePath() {
        return window.location.pathname.startsWith('/altoy') ? '/altoy' : '';
    }

    function getTodayBirthdays(data) {
        const now = new Date();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        return data.filter(item =>
            parseInt(item['월']) === month && parseInt(item['일']) === day
        );
    }

    function getUpcomingBirthdays(data, limit = 5) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const year = now.getFullYear();

        return data.map(item => {
            const month = parseInt(item['월']);
            const day = parseInt(item['일']);
            let nextDate = new Date(year, month - 1, day);
            if (nextDate < now) nextDate = new Date(year + 1, month - 1, day);
            return { ...item, nextDate };
        })
        .sort((a, b) => a.nextDate - b.nextDate)
        .slice(0, limit);
    }

    function renderBirthdayItem(item, showDate) {
        const base = getBasePath();
        const name = item['룽섭 이름'];
        const rarity = item['레어도'];
        const icon = item.icon || '';

        const a = document.createElement('a');
        a.className = 'birthday-item';
        a.href = `${base}/shipgirl/shipgirl-info/?ship=${encodeURIComponent(name)}`;

        const img = document.createElement('img');
        img.className = 'birthday-item-icon';
        img.src = icon;
        img.alt = name;
        img.loading = 'lazy';
        img.onerror = function () {
            this.onerror = null;
            this.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"%3E%3Crect width="36" height="36" fill="%23ddd" rx="18"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="10" fill="%23999"%3E?%3C/text%3E%3C/svg%3E';
        };

        const nameSpan = document.createElement('span');
        nameSpan.className = 'birthday-item-name';
        nameSpan.textContent = showDate
            ? `${name} (${parseInt(item['월'])}/${parseInt(item['일'])})`
            : name;

        const raritySpan = document.createElement('span');
        raritySpan.className = 'birthday-item-rarity';
        raritySpan.textContent = rarity || '';
        if (rarity) raritySpan.setAttribute('data-rarity', rarity);

        a.appendChild(img);
        a.appendChild(nameSpan);
        a.appendChild(raritySpan);

        return a;
    }

    async function init() {
        const now = new Date();
        const base = getBasePath();

        // Show today's date next to title
        if (dateEl) {
            dateEl.textContent = `${now.getMonth() + 1}월 ${now.getDate()}일`;
        }

        // Update calendar link to point to today's day view
        if (moreLink) {
            moreLink.href = `${base}/shipgirl/shipgirl-birthday/?view=day&year=${now.getFullYear()}&month=${now.getMonth() + 1}&day=${now.getDate()}`;
        }

        try {
            const data = await fetchJSONWithCache('data/shipgirl/shipgirl_birthday_data.json', { maxAge: 86400000 });

            const todayBirthdays = getTodayBirthdays(data);

            birthdayList.innerHTML = '';

            if (todayBirthdays.length > 0) {
                const frag = document.createDocumentFragment();
                todayBirthdays.forEach(item => {
                    frag.appendChild(renderBirthdayItem(item, false));
                });
                birthdayList.appendChild(frag);
            } else {
                if (titleText) titleText.textContent = '다가오는 생일';

                const upcoming = getUpcomingBirthdays(data, 5);
                if (upcoming.length > 0) {
                    const frag = document.createDocumentFragment();
                    upcoming.forEach(item => {
                        frag.appendChild(renderBirthdayItem(item, true));
                    });
                    birthdayList.appendChild(frag);
                } else {
                    birthdayList.innerHTML = `
                        <div class="birthday-empty">
                            <span class="material-symbols-outlined">sentiment_dissatisfied</span>
                            <span>생일 데이터를 찾을 수 없습니다</span>
                        </div>
                    `;
                }
            }
        } catch (err) {
            console.error('[Birthday] Error loading data:', err);
            birthdayList.innerHTML = `
                <div class="birthday-empty">
                    <span class="material-symbols-outlined">error</span>
                    <span>생일 데이터를 불러올 수 없습니다</span>
                </div>
            `;
        }
    }

    return { init };
})();

// =====================================================
// CARD ANIMATIONS
// =====================================================

function initCardAnimations() {
    const mainCards = document.querySelectorAll('.bento-grid > .bento-card');
    const externalCards = document.querySelectorAll('.external-links-section .bento-card');

    // Batch set CSS custom properties for better performance
    mainCards.forEach((card, index) => {
        card.style.setProperty('--card-index', index + 1);
    });

    externalCards.forEach((card, index) => {
        card.style.setProperty('--card-index', mainCards.length + index + 1);
    });
}

// =====================================================
// INITIALIZATION
// =====================================================

document.addEventListener('DOMContentLoaded', function () {
    // Initialize all components
    initHeroCarousel();
    EventCarousel.init();
    BirthdaySection.init();
    initCardAnimations();

    // Cleanup on page unload
    window.addEventListener('beforeunload', EventCarousel.cleanup);
});
