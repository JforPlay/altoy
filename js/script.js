document.addEventListener('DOMContentLoaded', function() {
    // ===== CAROUSEL FUNCTIONALITY =====
    const track = document.querySelector('.carousel-track');
    const slides = Array.from(track.children);
    const nextButton = document.querySelector('.carousel-nav.next');
    const prevButton = document.querySelector('.carousel-nav.prev');
    const indicatorsContainer = document.querySelector('.carousel-indicators');
    
    if (!track || slides.length === 0) {
        console.warn('Carousel elements not found');
        return;
    }

    let currentIndex = 0;
    const totalSlides = slides.length;
    
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
        // Remove active class from all
        slides.forEach(slide => slide.classList.remove('active'));
        indicators.forEach(ind => ind.classList.remove('active'));
        
        // Add active to current
        slides[currentIndex].classList.add('active');
        indicators[currentIndex].classList.add('active');
        
        // Move track
        const offset = -100 * currentIndex;
        track.style.transform = `translateX(${offset}%)`;
    }

    function goToSlide(index) {
        currentIndex = index;
        updateCarousel();
    }

    function nextSlide() {
        currentIndex = (currentIndex + 1) % totalSlides;
        updateCarousel();
    }

    function prevSlide() {
        currentIndex = (currentIndex - 1 + totalSlides) % totalSlides;
        updateCarousel();
    }

    // Event listeners
    if (nextButton) nextButton.addEventListener('click', nextSlide);
    if (prevButton) prevButton.addEventListener('click', prevSlide);

    // Auto-play
    let autoplay = setInterval(nextSlide, 5000);

    // Pause on hover
    track.addEventListener('mouseenter', () => clearInterval(autoplay));
    track.addEventListener('mouseleave', () => {
        autoplay = setInterval(nextSlide, 5000);
    });

    // Swipe support for mobile
    let touchStartX = 0;
    let touchEndX = 0;

    track.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    });

    track.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    });

    function handleSwipe() {
        if (touchEndX < touchStartX - 50) {
            nextSlide(); // Swipe left
        }
        if (touchEndX > touchStartX + 50) {
            prevSlide(); // Swipe right
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