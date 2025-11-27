// ============================================
// SHARED UTILITY FUNCTIONS
// ============================================

/**
 * Debounce function to limit the rate at which a function can fire.
 * Useful for search inputs, resize events, etc.
 * @param {Function} func - The function to debounce
 * @param {number} wait - The delay in milliseconds
 * @returns {Function} - The debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function to limit the execution of a function to once every X milliseconds.
 * Useful for scroll events, resize events, etc.
 * @param {Function} func - The function to throttle
 * @param {number} delay - The delay in milliseconds
 * @returns {Function} - The throttled function
 */
function throttle(func, delay) {
    let timeout = null;
    return function(...args) {
        if (timeout) return;
        timeout = setTimeout(() => {
            func.apply(this, args);
            timeout = null;
        }, delay);
    };
}

/**
 * Setup scroll-to-top button functionality
 * Shows button when user scrolls down 300px, hides when at top
 * Applies to pages that have #scroll-to-top element in HTML
 * @param {string} buttonId - The ID of the scroll-to-top button (default: 'scroll-to-top')
 */
function setupScrollToTop(buttonId = 'scroll-to-top') {
    const scrollToTopBtn = document.getElementById(buttonId);
    if (!scrollToTopBtn) return; // Exit gracefully if button doesn't exist

    // Show/hide button based on scroll position
    const toggleButton = () => {
        if (window.scrollY > 300) {
            scrollToTopBtn.classList.remove('hidden');
            scrollToTopBtn.classList.add('visible'); // Ensure visible class is added for compatibility
        } else {
            scrollToTopBtn.classList.add('hidden');
            scrollToTopBtn.classList.remove('visible');
        }
    };

    // Scroll to top with smooth animation
    const scrollToTop = () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    };

    // Throttled scroll handler for better performance
    // Ensure throttle exists, otherwise fallback
    const handler = (typeof throttle === 'function') 
        ? throttle(toggleButton, 100) 
        : toggleButton;
        
    window.addEventListener('scroll', handler);

    // Click handler
    scrollToTopBtn.addEventListener('click', scrollToTop);

    // Initial visibility check
    toggleButton();
}