document.addEventListener('DOMContentLoaded', function () {
    // Mobile menu functionality is handled globally by nav.script.js
    // No duplicate handlers needed here

    // ===== CAROUSEL FUNCTIONALITY =====
    const carousel = document.querySelector('.hero-carousel');
    if (carousel) {
        const track = carousel.querySelector('.carousel-track');
        const slides = Array.from(track?.children || []);
        const nextButton = carousel.querySelector('.carousel-nav.next');
        const prevButton = carousel.querySelector('.carousel-nav.prev');
        const indicatorsContainer = carousel.querySelector('.carousel-indicators');

        if (!track || slides.length === 0) {
            console.warn('Carousel elements not found');
        } else {
            let currentIndex = 0;
            const totalSlides = slides.length;
            let autoplay;

            // Clear existing indicators and create new ones
            indicatorsContainer.innerHTML = '';
            slides.forEach((_, index) => {
                const indicator = document.createElement('button');
                indicator.classList.add('indicator');
                indicator.setAttribute('aria-label', `Go to slide ${index + 1}`);
                if (index === 0) indicator.classList.add('active');
                indicator.addEventListener('click', () => goToSlide(index));
                indicatorsContainer.appendChild(indicator);
            });

            const indicators = Array.from(indicatorsContainer.children);

            // Set initial state
            slides[0].classList.add('active');

            function updateCarousel() {
                slides.forEach(slide => slide.classList.remove('active'));
                indicators.forEach(ind => ind.classList.remove('active'));
                slides[currentIndex].classList.add('active');
                indicators[currentIndex].classList.add('active');
                track.style.transform = `translateX(${-100 * currentIndex}%)`;
            }

            function resetAutoplay() {
                clearInterval(autoplay);
                autoplay = setInterval(nextSlide, 5000);
            }

            function goToSlide(index) {
                currentIndex = index;
                updateCarousel();
                resetAutoplay();
            }

            function nextSlide() {
                currentIndex = (currentIndex + 1) % totalSlides;
                updateCarousel();
            }

            function prevSlide() {
                currentIndex = (currentIndex - 1 + totalSlides) % totalSlides;
                updateCarousel();
            }

            if (nextButton) {
                nextButton.addEventListener('click', () => {
                    nextSlide();
                    resetAutoplay();
                });
            }
            if (prevButton) {
                prevButton.addEventListener('click', () => {
                    prevSlide();
                    resetAutoplay();
                });
            }

            carousel.addEventListener('mouseenter', () => clearInterval(autoplay));
            carousel.addEventListener('mouseleave', resetAutoplay);

            let touchStartX = 0;
            let touchStartY = 0;

            track.addEventListener('touchstart', (e) => {
                // Ignore touches on navbar or its children
                if (e.target.closest('.navbar')) {
                    return;
                }

                touchStartX = e.changedTouches[0].screenX;
                touchStartY = e.changedTouches[0].screenY;
                clearInterval(autoplay);
            });

            track.addEventListener('touchend', (e) => {
                // Ignore touches on navbar or its children
                if (e.target.closest('.navbar')) {
                    return;
                }

                const touchEndX = e.changedTouches[0].screenX;
                const touchEndY = e.changedTouches[0].screenY;

                // Calculate horizontal and vertical distances
                const deltaX = touchEndX - touchStartX;
                const deltaY = touchEndY - touchStartY;

                // Only trigger carousel swipe if horizontal swipe is dominant
                // and vertical scroll is minimal (prevents interfering with scroll)
                if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
                    if (deltaX < 0) {
                        nextSlide();
                    } else {
                        prevSlide();
                    }
                }
                resetAutoplay();
            });

            resetAutoplay(); // Initial start
        }
    }


    // ===== CARD ANIMATION STAGGER =====
    const mainCards = document.querySelectorAll('.bento-grid > .bento-card');
    const externalCards = document.querySelectorAll('.external-links-section .bento-card');

    // Assign indices to main cards
    mainCards.forEach((card, index) => {
        card.style.setProperty('--card-index', index + 1);
    });

    // Continue indexing for external cards
    externalCards.forEach((card, index) => {
        card.style.setProperty('--card-index', mainCards.length + index + 1);
    });
});