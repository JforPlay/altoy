/**
 * shipgirl-tracker-utils.js
 * Utility helpers for shipgirl-tracker.js: checkbox parsing, search dropdown,
 * and tracker item DOM creation. Exported as a single namespace object.
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
     * Validate and normalize a tracker progress payload (from localStorage or a storage event).
     * Defines the cross-tab sync contract shared by shipgirl-tracker and research-tracker:
     * a plain object whose values are integers in the 3-bit checkbox-mask range [0, 7].
     * Any malformed entry is silently dropped so a bad write in one tab can't poison the other.
     * @param {string|null} rawValue - Raw JSON string (e.g. localStorage value or storage event newValue).
     * @returns {Object<string, number>} Cleaned shipId → state map.
     */
    parseProgress(rawValue) {
        const parsed = rawValue ? JSON.parse(rawValue) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

        const cleaned = {};
        for (const [shipId, state] of Object.entries(parsed)) {
            const numericState = Number(state);
            if (Number.isInteger(numericState) && numericState >= 0 && numericState <= 7) {
                cleaned[shipId] = numericState;
            }
        }
        return cleaned;
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
        let hideTimeout;
        input.addEventListener('focus', () => dropdown.style.display = 'block');
        input.addEventListener('blur', () => {
            // Delay hiding to allow click events on dropdown items.
            clearTimeout(hideTimeout);
            hideTimeout = setTimeout(() => {
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
