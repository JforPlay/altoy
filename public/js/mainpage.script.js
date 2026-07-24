/**
 * mainpage.script.js
 * Main page entry point: hero carousel, live event banner carousel, birthday widget, card animations.
 * Loaded only on index.astro. Event banner data comes from the local lua2json pipeline
 * (public/data/activity_banner.json), cached in localStorage for 30 minutes.
 */

import {
    createImgElement,
    DATA_FOR_TOY_BASE,
    getBasePath,
    hideElement,
    getStorageItem,
    setStorageItem,
    fetchJSONWithCache,
    renderStatus
} from './utils.js';

// ===== Shared Carousel Utilities =====

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
        }, { passive: true });

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
        }, { passive: true });
    },

    /**
     * Autoplay manager for carousels.
     * `enabled` tracks intent so resume() (after a tab-visibility pause) only restarts
     * if start()/reset() was the last call, not stop()/disable().
     */
    createAutoplay(callback, interval = 5000) {
        let timer = null;
        let enabled = false;

        const clear = () => {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        };

        return {
            start() {
                enabled = true;
                clear();
                if (!document.hidden) timer = setInterval(callback, interval);
            },
            stop: clear,
            resume() {
                if (enabled && !timer && !document.hidden) {
                    timer = setInterval(callback, interval);
                }
            },
            reset() { this.start(); },
            disable() {
                enabled = false;
                clear();
            }
        };
    }
};

function setButtonCurrent(button, isCurrent) {
    button.classList.toggle('active', isCurrent);
    button.setAttribute('aria-current', isCurrent ? 'true' : 'false');
}

// ===== Hero Carousel =====

/**
 * Initialize the main hero image carousel with indicators, autoplay, and touch/mouse handlers.
 * Stops autoplay on hover; resumes when mouse leaves.
 */
function initHeroCarousel() {
    const carousel = document.querySelector('.hero-carousel');
    if (!carousel) return;

    const track = carousel.querySelector('.carousel-track');
    const slides = Array.from(track?.children || []);
    const nextButton = carousel.querySelector('.carousel-nav.next');
    const prevButton = carousel.querySelector('.carousel-nav.prev');
    const indicatorsContainer = carousel.querySelector('.carousel-indicators');

    if (!track || slides.length === 0 || !indicatorsContainer) {
        console.warn('[Hero Carousel] Elements not found');
        return;
    }

    let currentIndex = slides.findIndex(slide => slide.classList.contains('active'));
    if (currentIndex < 0) currentIndex = 0;
    const totalSlides = slides.length;

    indicatorsContainer.innerHTML = '';
    const indicators = slides.map((_, index) => {
        const indicator = document.createElement('button');
        indicator.classList.add('indicator', 'pagination-dot');
        indicator.setAttribute('aria-label', `Go to slide ${index + 1}`);
        setButtonCurrent(indicator, index === currentIndex);
        indicator.addEventListener('click', () => goToSlide(index));
        indicatorsContainer.appendChild(indicator);
        return indicator;
    });

    function updateCarousel() {
        slides.forEach((slide, i) => {
            const isActive = i === currentIndex;
            slide.classList.toggle('active', isActive);
            // `inert` covers focus exclusion, click suppression, and aria-hidden in one
            // attribute (Chrome 102+ / Firefox 112+ / Safari 15.5+).
            slide.inert = !isActive;
        });
        indicators.forEach((ind, i) => {
            setButtonCurrent(ind, i === currentIndex);
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

    const autoplay = CarouselUtils.createAutoplay(nextSlide, 5000);
    const userNav = (action) => () => { action(); autoplay.reset(); };

    nextButton?.addEventListener('click', userNav(nextSlide));
    prevButton?.addEventListener('click', userNav(prevSlide));

    carousel.addEventListener('mouseenter', () => autoplay.stop());
    carousel.addEventListener('mouseleave', () => autoplay.start());

    CarouselUtils.setupTouchHandlers(
        track,
        userNav(nextSlide),
        userNav(prevSlide),
        () => autoplay.stop(),
        () => autoplay.reset()
    );

    updateCarousel();
    autoplay.start();

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) autoplay.stop();
        else autoplay.resume();
    });
    window.addEventListener('pagehide', () => autoplay.disable(), { once: true });
}

// ===== Event Banner Carousel =====

/**
 * IIFE module managing the live event banner carousel.
 * Banners come from public/data/activity_banner.json (built by the WSL lua2json
 * pipeline) and are cached in localStorage for 30 minutes. Filtered by current
 * date and sorted by type then ID.
 */
const EventCarousel = (function () {
    // Local data source — the upstream AzurLaneTools/AzurLaneData KR feed went
    // stale (last refresh 2026-05-08); the WSL pipeline now ships this file from
    // the lua2json conversion of KR/sharecfg/activity_banner.lua.
    const API_URL = `${getBasePath()}/data/activity_banner.json`;
    const IMAGE_BASE_URL = `${DATA_FOR_TOY_BASE}/activitybanner/`;
    // Bumped (v2) when the source moved from upstream GitHub to the local file —
    // forces a fresh fetch for users still holding the 30-min stale-cache entry.
    const CACHE_KEY = 'eventBannersCacheV2';
    const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

    let currentIndex = 0;
    let banners = [];
    let autoplay = null;
    let indicators = [];
    let initializedControls = false;
    let visibilityHandlerBound = false;

    // Maps banner.type integers to Korean display labels
    const typeNames = {
        1: '이벤트',
        2: '상점',
        3: '공지',
        4: '시스템',
        9: '기타'
    };

    // Transparent fallback — the parent `.event-banner img` already has a themed
    // dark-gradient background, so omitting the rect lets the gradient show
    // through in both light and dark modes instead of painting hardcoded #141414.
    const FALLBACK_SVG = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 200"%3E%3Ctext x="400" y="100" font-family="Arial" font-size="20" fill="%23bbb" text-anchor="middle" dy=".3em"%3E%EC%9D%B4%EB%AF%B8%EC%A7%80%EB%A5%BC%20%EB%B6%88%EB%9F%AC%EC%98%AC%20%EC%88%98%20%EC%97%86%EC%8A%B5%EB%8B%88%EB%8B%A4%3C/text%3E%3C/svg%3E';

    // Date helpers — banner.time is stored as [[year,month,day],[hour,min,sec]]
    function parseDate(dateArray) {
        if (!Array.isArray(dateArray) || dateArray.length < 2) return null;
        const [date, time] = dateArray;
        return new Date(date[0], date[1] - 1, date[2], time[0] || 0, time[1] || 0, time[2] || 0);
    }

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

    function formatDate(dateArray) {
        const date = parseDate(dateArray);
        if (!date) return '';
        return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
    }

    function createBannerElement(banner) {
        const bannerDiv = document.createElement('div');
        bannerDiv.className = 'event-banner';

        const pic = encodeURIComponent(String(banner.pic || '').trim());
        const img = createImgElement(`${IMAGE_BASE_URL}${pic}.webp`, `Event Banner ${banner.id || ''}`, {
            fallback: FALLBACK_SVG
        });
        img.width = 800;
        img.height = 200;
        img.decoding = 'async';

        const overlay = document.createElement('div');
        overlay.className = 'event-banner-overlay';

        const typeSpan = document.createElement('span');
        typeSpan.className = 'badge event-banner-type';
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

    function createIndicator(index) {
        const indicator = document.createElement('button');
        indicator.className = 'event-indicator pagination-dot';
        indicator.setAttribute('aria-label', `Go to event ${index + 1}`);
        setButtonCurrent(indicator, index === 0);
        indicator.addEventListener('click', () => goToSlide(index));
        return indicator;
    }

    function updateCarousel() {
        const track = document.querySelector('.event-carousel-track');
        if (!track || banners.length === 0) return;
        track.style.transform = `translateX(${-100 * currentIndex}%)`;

        indicators.forEach((indicator, index) => {
            setButtonCurrent(indicator, index === currentIndex);
        });
    }

    function goToSlide(index) {
        currentIndex = index;
        updateCarousel();
        autoplay?.reset();
    }

    function nextSlide() {
        currentIndex = (currentIndex + 1) % banners.length;
        updateCarousel();
    }

    function prevSlide() {
        currentIndex = (currentIndex - 1 + banners.length) % banners.length;
        updateCarousel();
    }

    // Wraps a slide change so user-triggered navigation also resets the autoplay timer.
    function userNav(action) {
        return () => { action(); autoplay?.reset(); };
    }

    function handleVisibilityChange() {
        if (document.hidden) autoplay?.stop();
        else autoplay?.resume();
    }

    function showEmptyState() {
        const track = document.querySelector('.event-carousel-track');
        const prevButton = document.querySelector('.event-carousel-nav.prev');
        const nextButton = document.querySelector('.event-carousel-nav.next');
        const indicatorsContainer = document.querySelector('.event-carousel-indicators');

        if (track) {
            renderStatus(track, '진행중인 이벤트가 없습니다', 'empty', { icon: 'event_busy' });
            track.style.transform = '';
        }

        if (prevButton) prevButton.style.display = 'none';
        if (nextButton) nextButton.style.display = 'none';
        if (indicatorsContainer) indicatorsContainer.style.display = 'none';
    }

    // localStorage cache helpers (separate from IndexedDB — 30-minute short TTL for live data)
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

        // Defensive cleanup if loadBanners is ever called more than once:
        // stop any prior interval so it can't keep firing without a reference.
        if (autoplay) {
            autoplay.stop();
            autoplay = null;
        }

        try {
            let data = getCachedData();

            if (!data) {
                const response = await fetch(API_URL);
                if (!response.ok) throw new Error('Failed to fetch banners');
                data = await response.json();
                setCachedData(data);
            }

            banners = Object.values(data || {})
                .filter(banner => banner && banner.pic)
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

            track.replaceChildren();
            indicatorsContainer.replaceChildren();

            indicators = banners.map((banner, index) => {
                track.appendChild(createBannerElement(banner));
                const indicator = createIndicator(index);
                indicatorsContainer.appendChild(indicator);
                return indicator;
            });

            currentIndex = 0;

            const hasMultiple = banners.length > 1;
            if (prevButton) prevButton.style.display = hasMultiple ? 'flex' : 'none';
            if (nextButton) nextButton.style.display = hasMultiple ? 'flex' : 'none';
            indicatorsContainer.style.display = hasMultiple ? '' : 'none';

            if (!hasMultiple) {
                updateCarousel();
                return;
            }

            if (!initializedControls) {
                prevButton?.addEventListener('click', userNav(prevSlide));
                nextButton?.addEventListener('click', userNav(nextSlide));

                const carousel = document.querySelector('.event-carousel');
                if (carousel) {
                    carousel.addEventListener('mouseenter', () => autoplay?.stop());
                    carousel.addEventListener('mouseleave', () => autoplay?.start());
                }

                CarouselUtils.setupTouchHandlers(
                    track,
                    userNav(nextSlide),
                    userNav(prevSlide),
                    () => autoplay?.stop(),
                    () => autoplay?.reset()
                );

                initializedControls = true;
            }

            autoplay = CarouselUtils.createAutoplay(nextSlide, 5000);
            if (!visibilityHandlerBound) {
                document.addEventListener('visibilitychange', handleVisibilityChange);
                visibilityHandlerBound = true;
            }
            updateCarousel();
            autoplay.start();

        } catch (error) {
            console.error('[Event Carousel] Error loading banners:', error);
            // Repurpose the header loading slot into a compact error status
            // (renderStatus replaces the spinner markup, keeping it canonical).
            renderStatus(loadingIndicator, '이벤트 배너를 불러올 수 없습니다', 'error', { compact: true });
            showEmptyState();
        }
    }

    function cleanup() {
        if (autoplay) autoplay.disable();
        if (visibilityHandlerBound) {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            visibilityHandlerBound = false;
        }
    }

    return {
        init: loadBanners,
        cleanup
    };
})();

// ===== Birthday Section =====

/**
 * IIFE module for the homepage birthday widget.
 * Shows today's birthdays if any exist; falls back to the next 5 upcoming birthdays.
 * Data is cached for 24 hours via fetchJSONWithCache.
 */
const BirthdaySection = (function () {
    const birthdayList = document.getElementById('birthdayList');
    if (!birthdayList) return { init() {} };

    const titleText = document.querySelector('.birthday-title-text');
    const moreLink = document.querySelector('.birthday-more-link');
    const dateEl = document.getElementById('birthdayDate');

    function getBirthdayDate(item) {
        const month = Number.parseInt(item?.['월'], 10);
        const day = Number.parseInt(item?.['일'], 10);
        if (!Number.isInteger(month) || !Number.isInteger(day)) return null;
        if (month < 1 || month > 12 || day < 1 || day > 31) return null;
        // Reject impossible combos (Feb 30, Apr 31, ...). Use a leap year so Feb 29 is accepted.
        const probe = new Date(2024, month - 1, day);
        if (probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;
        return { month, day };
    }

    function getTodayBirthdays(data) {
        const now = new Date();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        return data.filter(item => {
            const date = getBirthdayDate(item);
            return date && date.month === month && date.day === day;
        });
    }

    function getUpcomingBirthdays(data, limit = 5) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const year = now.getFullYear();

        return data
            .map(item => {
                const date = getBirthdayDate(item);
                if (!date) return null;
                let nextDate = new Date(year, date.month - 1, date.day);
                if (nextDate < now) nextDate = new Date(year + 1, date.month - 1, date.day);
                return { ...item, nextDate };
            })
            .filter(Boolean)
            .sort((a, b) => a.nextDate - b.nextDate)
            .slice(0, limit);
    }

    function renderBirthdayItem(item, showDate) {
        const base = getBasePath();
        const name = item['룽섭 이름'] || item.name || 'Unknown';
        const rarity = item['레어도'];
        const icon = item.icon || '';
        const date = getBirthdayDate(item);

        const a = document.createElement('a');
        a.className = 'birthday-item';
        a.href = `${base}/shipgirl/shipgirl-info/?ship=${encodeURIComponent(name)}${item.group_id != null ? `&gid=${encodeURIComponent(item.group_id)}` : ''}`;

        const img = document.createElement('img');
        img.className = 'birthday-item-icon';
        img.src = icon;
        img.alt = name;
        img.width = 36;
        img.height = 36;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.onerror = function () {
            this.onerror = null;
            this.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"%3E%3Crect width="36" height="36" fill="%23ddd" rx="18"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="10" fill="%23999"%3E?%3C/text%3E%3C/svg%3E';
        };

        const nameSpan = document.createElement('span');
        nameSpan.className = 'birthday-item-name';
        nameSpan.textContent = showDate && date
            ? `${name} (${date.month}/${date.day})`
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

    function renderBirthdayEmpty(messageText, type = 'empty', icon) {
        renderStatus(birthdayList, messageText, type, icon ? { icon, compact: true } : { compact: true });
    }

    async function init() {
        const now = new Date();
        const base = getBasePath();

        if (dateEl) {
            dateEl.textContent = `${now.getMonth() + 1}월 ${now.getDate()}일`;
        }

        if (moreLink) {
            moreLink.href = `${base}/shipgirl/shipgirl-birthday/?view=day&year=${now.getFullYear()}&month=${now.getMonth() + 1}&day=${now.getDate()}`;
        }

        try {
            const data = await fetchJSONWithCache('data/shipgirl/shipgirl_birthday_data.json', { maxAge: 86400000 });
            if (!Array.isArray(data)) throw new Error('Birthday data was not an array');

            const todayBirthdays = getTodayBirthdays(data);

            birthdayList.replaceChildren();

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
                    renderBirthdayEmpty('생일 데이터를 찾을 수 없습니다', 'empty', 'sentiment_dissatisfied');
                }
            }
        } catch (err) {
            console.error('[Birthday] Error loading data:', err);
            renderBirthdayEmpty('생일 데이터를 불러올 수 없습니다', 'error');
        }
    }

    return { init };
})();

// ===== Card Animations =====

/**
 * Set --card-index CSS custom property on each bento card for staggered entrance animations.
 * External cards continue the index sequence after main cards so delays remain consistent.
 */
function initCardAnimations() {
    const mainCards = document.querySelectorAll('.bento-grid > .bento-card');
    const externalCards = document.querySelectorAll('.external-links-section .bento-card');

    mainCards.forEach((card, index) => {
        card.style.setProperty('--card-index', index + 1);
    });

    externalCards.forEach((card, index) => {
        card.style.setProperty('--card-index', mainCards.length + index + 1);
    });
}

// ===== Initialization =====

document.addEventListener('DOMContentLoaded', function () {
    initHeroCarousel();
    EventCarousel.init();
    BirthdaySection.init();
    initCardAnimations();

    window.addEventListener('pagehide', EventCarousel.cleanup, { once: true });
});
