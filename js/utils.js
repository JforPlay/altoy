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
 * Fetch a JSON resource with error handling
 * @param {string} url - The URL to fetch
 * @returns {Promise<any>} - The parsed JSON data
 */
async function fetchJSON(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Format time from deciseconds to "Xh Ym Zs"
 * @param {number} deciseconds - Time in 1/10th of a second
 * @returns {string} - Formatted time string
 */
function formatTime(deciseconds) {
    if (!deciseconds) return '0s';

    const totalSeconds = deciseconds / 10;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

    return parts.join(' ');
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

/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {string} type - 'info', 'success', 'error' (default: 'info')
 * @param {number} duration - Duration in ms (default: 3000)
 */
function showToast(message, type = 'info', duration = 3000) {
    let toastContainer = document.getElementById('global-toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'global-toast-container';
        toastContainer.className = 'global-toast-container';
        document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.className = `global-toast toast-${type}`;
    toast.textContent = message;
    
    // Add icon based on type
    const icon = document.createElement('i');
    icon.className = 'fas';
    if (type === 'success') icon.classList.add('fa-check-circle');
    else if (type === 'error') icon.classList.add('fa-exclamation-circle');
    else icon.classList.add('fa-info-circle');
    
    toast.prepend(icon);

    toastContainer.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => {
            toast.remove();
        });
    }, duration);
}