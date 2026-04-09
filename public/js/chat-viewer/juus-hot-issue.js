/**
 * juus-hot-issue.js
 * Renders 쥬쥬 핫 이슈 (Official Account) cards from juus_hot_issue_data.json.
 */

import { fetchJSON, resolveUrl, createImgElement, IMG_FALLBACKS } from '../utils.js';

const grid = document.getElementById('hot-issue-grid');

async function init() {
    try {
        const data = await fetchJSON(resolveUrl('data/chat-viewer/juus_hot_issue_data.json'));

        if (!data || data.length === 0) {
            grid.innerHTML = '<p class="hot-issue-empty">등록된 핫 이슈가 없습니다.</p>';
            return;
        }

        const fragment = document.createDocumentFragment();

        for (const item of data) {
            const card = document.createElement('div');
            card.className = 'hot-issue-card';

            // Image or placeholder
            if (item.picture) {
                const img = createImgElement(item.picture, item.title, {
                    className: 'hot-issue-card-image',
                    fallback: IMG_FALLBACKS.CARD,
                });
                card.appendChild(img);
            } else {
                const placeholder = document.createElement('div');
                placeholder.className = 'hot-issue-card-image-placeholder';
                placeholder.textContent = '이미지 없음';
                card.appendChild(placeholder);
            }

            // Card body
            const body = document.createElement('div');
            body.className = 'hot-issue-card-body';

            const idBadge = document.createElement('span');
            idBadge.className = 'hot-issue-card-id';
            idBadge.textContent = `#${item.id}`;
            body.appendChild(idBadge);

            const title = document.createElement('p');
            title.className = 'hot-issue-card-title';
            title.textContent = item.title;
            body.appendChild(title);

            card.appendChild(body);
            fragment.appendChild(card);
        }

        grid.innerHTML = '';
        grid.appendChild(fragment);
    } catch (err) {
        console.error('Failed to load hot issue data:', err);
        grid.innerHTML = '<p class="hot-issue-empty">데이터를 불러오지 못했습니다.</p>';
    }
}

init();
