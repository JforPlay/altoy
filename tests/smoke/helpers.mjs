/**
 * Shared helpers for the Playwright smoke specs. Named without `.test`/`.spec`
 * so neither `node --test` nor the Playwright collector picks it up directly.
 */

/**
 * Stub the Fuse.js CDN global before page scripts run, so `ensureFuse()` skips
 * the network. The callback is serialized into the page by addInitScript and
 * must stay self-contained (no outer-scope references).
 */
export function seedFuse(page) {
    return page.addInitScript(() => {
        globalThis.Fuse = class {
            constructor(data) {
                this.data = data;
            }

            getIndex() {
                return { docs: this.data };
            }

            // Matches `name` plus any array-valued `alias` entries (equip 별명),
            // so nickname search is exercisable without the real Fuse.
            search(query) {
                const normalized = String(query).toLowerCase();
                return this.data
                    .filter((item) => [item?.name, ...(Array.isArray(item?.alias) ? item.alias : [])]
                        .some(value => String(value ?? '').toLowerCase().includes(normalized)))
                    .map(item => ({ item, matches: [], score: 0 }));
            }
        };
    });
}
