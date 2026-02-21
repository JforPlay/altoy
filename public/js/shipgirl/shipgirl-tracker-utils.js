/**
 * Utility functions for shipgirl-tracker
 * Helper functions that are called infrequently or for initialization
 */

const ShipgirlTrackerUtils = {
    /**
     * Utility function to parse integer from dataset.
     * @param {string} value - Value to parse.
     * @param {number} defaultValue - Default value if parsing fails.
     * @returns {number} Parsed integer or default.
     */
    parseDatasetInt(value, defaultValue = 0) {
        const parsed = parseInt(value, 10);
        return isNaN(parsed) ? defaultValue : parsed;
    },

    /**
     * Utility function to get checked filter values.
     * @param {string} selector - CSS selector for the checkboxes.
     * @returns {Array} Array of checked values.
     */
    getCheckedFilterValues(selector) {
        return Array.from(document.querySelectorAll(selector))
            .map(cb => cb.value);
    },

    /**
     * Filters the search dropdown based on user input.
     * @param {HTMLInputElement} input - The search input element.
     * @param {HTMLElement} dropdown - The dropdown element.
     */
    filterSearchDropdown(input, dropdown) {
        const filter = input.value.toUpperCase();
        const items = dropdown.getElementsByTagName('a');
        for (let i = 0; i < items.length; i++) {
            const txtValue = items[i].textContent || items[i].innerText;
            items[i].style.display = txtValue.toUpperCase().indexOf(filter) > -1 ? "" : "none";
        }
    },

    /**
     * Sets up the show/hide behavior for the search dropdown.
     * @param {HTMLInputElement} input - The search input element.
     * @param {HTMLElement} dropdown - The dropdown element.
     */
    setupDropdownToggle(input, dropdown) {
        input.addEventListener('focus', () => dropdown.style.display = 'block');
        input.addEventListener('blur', () => {
            // Delay hiding to allow click events on dropdown items.
            setTimeout(() => {
                dropdown.style.display = 'none';
            }, 150);
        });
    },

    /**
     * Creates a tracker item for ship cards.
     * @param {string} labelText - Label text for the tracker item.
     * @param {number} points - Points value.
     * @param {string} type - Type of tracker ('get', 'level', 'upgrade').
     * @param {number} uniqueIdLength - Length of unique ID.
     * @returns {HTMLElement} Tracker item element.
     */
    createTrackerItem(labelText, points, type, uniqueIdLength = 9) {
        const item = document.createElement('div');
        item.className = 'tracker-item';
        const uniqueId = `${type}-${Math.random().toString(36).substr(2, uniqueIdLength)}`;
        const label = document.createElement('label');
        label.htmlFor = uniqueId;
        label.textContent = `${labelText} (+${points})`;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = uniqueId;
        checkbox.className = 'tracker-checkbox';
        checkbox.dataset.type = type;
        item.appendChild(label);
        item.appendChild(checkbox);
        return item;
    }
};

export { ShipgirlTrackerUtils };
