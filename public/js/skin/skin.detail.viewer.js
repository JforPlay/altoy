/**
 * skin.detail.viewer.js
 * Page controller for the skin detail viewer — character + skin selection, voice lines, gallery.
 * Orchestrates three sub-modules: skin.data.js (data), skin.audio.js (audio), skin.expression.js (gallery).
 * Part of the skin module group.
 */
import { debounce, getUrlParam, setUrlParams, hideElement, showElement, toggleElement, resolveUrl, normalizeRomanNumerals, createIcon, createGemIconImg } from '../utils.js';
import { init as initSkinData, searchCharacters, getSkinsForCharacter, getSkinByName, getManifest, getAllCharacterNames, getReleaseDate, getSkinFilterData } from './skin.data.js';
import { init as initSkinAudio, stopCurrentAudio, handlePlayClick, createVolumeControlElement, attachVolumeListeners } from './skin.audio.js';
import { init as initSkinExpression, setManifest, renderImageGallery } from './skin.expression.js';

document.addEventListener('DOMContentLoaded', async () => {

    // DOM Elements
    const elements = {
        charInput: document.getElementById('character-search-input'),
        charDropdown: document.getElementById('character-dropdown-content'),
        skinInput: document.getElementById('skin-search-input'),
        skinDropdown: document.getElementById('skin-dropdown-content'),
        skinInfoBox: document.getElementById('skin-info-box'),
        imageGallery: document.getElementById('image-gallery'),
        textContent: document.getElementById('text-content-area'),
        oathTable: document.getElementById('oath-table-area'),
        asmrTable: document.getElementById('asmr-table-area'),
        skeleton: document.getElementById('loading-skeleton'),
        clearBtn: document.getElementById('clear-filters-btn')
    };
    let skinRenderToken = 0;
    let isApplyingURLState = false;

    // Initialize Modules
    initSkinAudio();
    initSkinExpression();
    const dataLoaded = await initSkinData();
    
    if (!dataLoaded) {
        elements.charInput.placeholder = '데이터 로딩 실패';
        elements.charInput.disabled = true;
        elements.skinInput.disabled = true;
        elements.clearBtn.disabled = true;
        renderLoadError();
        return;
    }

    setManifest(getManifest());

    // Event Listeners
    setupDropdowns();
    [elements.textContent, elements.oathTable, elements.asmrTable].forEach(container => {
        container.addEventListener('click', handlePlayClick);
    });

    elements.clearBtn.addEventListener('click', () => {
        elements.charInput.value = '';
        elements.skinInput.value = '';
        elements.skinInput.placeholder = '함순이를 먼저 선택해주세요...';
        elements.skinInput.disabled = true;
        clearSkinDetails();
        elements.charDropdown.style.display = 'none';
        elements.skinDropdown.style.display = 'none';
        updateURLWithFilters();
    });

    // Random Skin Feature
    setupRandomSkin();

    window.addEventListener('popstate', applyFiltersFromURL);

    // Apply initial URL state after listeners are wired so deep-linked skins
    // render against fully-attached delegated handlers.
    applyFiltersFromURL();

    // ===== Search & Selection =====

    function setupDropdowns() {
        // Character Search
        const handleCharFilter = () => {
            const results = searchCharacters(elements.charInput.value);
            renderDropdown(elements.charDropdown, results, (name) => {
                handleCharacterSelect(name);
            });
        };

        elements.charInput.addEventListener('keyup', debounce(handleCharFilter, 200));
        elements.charInput.addEventListener('focus', () => {
            handleCharFilter();
            elements.charDropdown.style.display = 'block';
        });
        elements.charInput.addEventListener('blur', () => {
            setTimeout(() => elements.charDropdown.style.display = 'none', 200);
        });

        // Skin Search
        elements.skinInput.addEventListener('focus', () => {
            const charName = elements.charInput.value;
            const skins = getSkinsForCharacter(charName);
            if (!charName || skins.length === 0) {
                renderNoResults(elements.skinDropdown, '함순이를 먼저 선택해주세요');
            } else {
                renderSimpleDropdown(elements.skinDropdown, skins, handleSkinSelect);
            }
            elements.skinDropdown.style.display = 'block';
        });
        elements.skinInput.addEventListener('blur', () => {
            setTimeout(() => elements.skinDropdown.style.display = 'none', 200);
        });
    }

    function renderDropdown(el, results, onSelect) {
        el.innerHTML = '';
        if (results.length === 0) {
            renderNoResults(el, '검색 결과가 없습니다');
            return;
        }
        results.forEach(res => {
            const item = res.item;
            const a = document.createElement('a');
            a.href = '#';
            a.role = 'option';
            a.textContent = item.name; // Simplified highlighting for brevity
            a.addEventListener('click', (event) => {
                event.preventDefault();
                onSelect(item.name);
            });
            el.appendChild(a);
        });
    }

    function renderSimpleDropdown(el, items, onSelect) {
        el.innerHTML = '';
        items.forEach(item => {
            const a = document.createElement('a');
            a.href = '#';
            a.role = 'option';
            a.textContent = item;
            a.addEventListener('click', (event) => {
                event.preventDefault();
                onSelect(item);
            });
            el.appendChild(a);
        });
    }

    function renderNoResults(el, message) {
        el.replaceChildren();
        const div = document.createElement('div');
        div.className = 'no-results';
        div.textContent = message;
        el.appendChild(div);
    }

    function handleCharacterSelect(name, clearSkin = true) {
        elements.charInput.value = name;
        if (clearSkin) {
            elements.skinInput.value = '';
            clearSkinDetails();
        }
        elements.skinInput.disabled = false;
        elements.skinInput.placeholder = '스킨을 검색/선택해주세요';
        updateURLWithFilters();
    }

    function handleSkinSelect(skinName) {
        elements.skinInput.value = skinName;
        displaySkinDetails(skinName);
        updateURLWithFilters();
    }

    /**
     * Fetch full skin data by name, then render info box, image gallery, and voice lines.
     * Shows a skeleton loader while data is in flight.
     */
    async function displaySkinDetails(skinName) {
        const renderToken = ++skinRenderToken;
        showElement(elements.skeleton);

        let skin = null;
        try {
            skin = await getSkinByName(skinName);
        } catch (error) {
            console.error('Failed to load skin details', error);
        }
        if (renderToken !== skinRenderToken) return;
        if (!skin) {
            hideElement(elements.skeleton);
            renderSkinError('스킨 정보를 불러올 수 없습니다.');
            return;
        }

        requestAnimationFrame(() => {
            if (renderToken !== skinRenderToken) return;
            // Render Info
            renderSkinInfoBox(skin);
            // Render Gallery
            renderImageGallery(skin, elements.imageGallery);
            // Render Voice Lines
            renderVoiceLines(skin);

            hideElement(elements.skeleton);
        });
    }

    function clearSkinDetails() {
        skinRenderToken += 1;
        hideElement(elements.skinInfoBox);
        hideElement(elements.imageGallery);
        hideElement(elements.textContent);
        hideElement(elements.oathTable);
        hideElement(elements.asmrTable);
        hideElement(elements.skeleton);
        elements.skinInfoBox.replaceChildren();
        elements.imageGallery.replaceChildren();
        elements.textContent.replaceChildren();
        elements.oathTable.replaceChildren();
        elements.asmrTable.replaceChildren();
        stopCurrentAudio();
    }

    function renderSkinInfoBox(skin) {
        elements.skinInfoBox.replaceChildren();
        if (skin['재화']) {
            const item = document.createElement('div');
            item.className = 'info-item';

            const value = document.createElement('span');
            value.className = 'info-value';
            value.textContent = Number(skin['재화']).toLocaleString();

            item.append(createGemIconImg(), value);
            elements.skinInfoBox.appendChild(item);
        }
        if (skin['기간']) elements.skinInfoBox.appendChild(createInfoItem('상시:', skin['기간']));
        if (skin['스킨 타입 - 한글']) elements.skinInfoBox.appendChild(createInfoItem('타입:', skin['스킨 타입 - 한글']));
        if (skin['스킨 태그']) elements.skinInfoBox.appendChild(createInfoItem('태그:', skin['스킨 태그']));

        const releaseDate = getReleaseDate(skin['클뜯 id']);
        if (releaseDate) elements.skinInfoBox.appendChild(createInfoItem('출시:', releaseDate));

        toggleElement(elements.skinInfoBox, elements.skinInfoBox.childElementCount > 0);
    }

    function createInfoItem(labelText, valueText) {
        const item = document.createElement('div');
        item.className = 'info-item';

        const label = document.createElement('strong');
        label.className = 'info-label';
        label.textContent = labelText;

        const value = document.createElement('span');
        value.className = 'info-value';
        value.textContent = valueText;

        item.append(label, value);
        return item;
    }

    function renderLoadError() {
        renderSkinError('데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    }

    function renderSkinError(message) {
        elements.skinInfoBox.replaceChildren();
        const error = document.createElement('div');
        error.className = 'skin-detail-error';
        error.textContent = message;
        elements.skinInfoBox.appendChild(error);
        showElement(elements.skinInfoBox);
    }

    /**
     * Render the voice line tables (normal, oath, ASMR) for a skin.
     * Attaches delegated play-click and volume listeners via skin.audio.js exports.
     */
    function renderVoiceLines(skin) {
        const { normal, oath } = collectVoiceLines(skin);

        // Render Normal
        elements.textContent.replaceChildren();
        const descriptions = renderDescriptions(skin);
        if (descriptions) elements.textContent.appendChild(descriptions);
        if (normal.length > 0) {
            elements.textContent.appendChild(createVoiceTable('대사 모음', normal));
        }
        if (elements.textContent.childElementCount > 0) {
            showElement(elements.textContent);
        } else {
            hideElement(elements.textContent);
        }

        // Render Oath
        elements.oathTable.replaceChildren();
        if (oath.length > 0 && skin['ex_chat_status'] === 1) {
            elements.oathTable.appendChild(createVoiceTable('서약 대사', oath));
            showElement(elements.oathTable);
        } else {
            hideElement(elements.oathTable);
        }

        // Render ASMR
        renderAsmrSection(skin);

        attachVolumeListeners();
    }

    function renderDescriptions(skin) {
        const items = [];
        if (skin['설명']) {
            items.push(createDescriptionItem('설명', skin['설명']));
        }
        if (skin['자기소개'] && skin['자기소개'].voiceline) {
            const selfIntro = createDescriptionItem('자기소개', skin['자기소개'].voiceline, skin['자기소개'].voicelink);
            selfIntro.classList.add('self-intro');
            items.push(selfIntro);
        }
        if (items.length === 0) return null;

        const panel = document.createElement('div');
        panel.className = 'descriptions-panel';
        panel.append(...items);
        return panel;
    }

    /**
     * Build DOM-safe description and voice-line nodes.
     * Priority keys (입수시, 상세확인, etc.) render first; _ex keys go to oath section.
     */
    function createDescriptionItem(titleText, bodyText, voiceSrc = '') {
        const item = document.createElement('div');
        item.className = 'description-item';

        const title = document.createElement('h2');
        title.textContent = titleText;

        const body = document.createElement('p');
        const span = document.createElement('span');
        span.textContent = bodyText;
        body.appendChild(span);
        if (voiceSrc) body.appendChild(createPlayButton(voiceSrc));

        item.append(title, body);
        return item;
    }

    function collectVoiceLines(skin) {
        const normal = [];
        const oath = [];
        
        const addLine = (target, key, label) => {
            const val = skin[key];
            if (!val || !val.voiceline) return;
            target.push({ label, text: val.voiceline, src: val.voicelink || '' });
        };

        // Priority keys
        const priority = ["입수시", "상세확인", "실망", "낯섦", "호감", "기쁨", "사랑", "서약"];
        priority.forEach(k => addLine(normal, k, k));
        
        // Other keys
        Object.keys(skin).forEach(k => {
            if (priority.includes(k)) return;
            if (k.endsWith('_ex')) {
                addLine(oath, k, k.replace('_ex', ' EX'));
            } else if (skin[k] && skin[k].voiceline && !['설명', '자기소개', '드랍 설명', '함대 특수대사'].includes(k)) {
                addLine(normal, k, k);
            }
        });

        // Special handling for fleet lines
        if (skin['함대 특수대사']) {
            skin['함대 특수대사'].forEach(l => {
                if (l.voiceline) {
                    normal.push({ label: '함대 특수대사', text: l.voiceline, src: l.voicelink || '' });
                }
            });
        }

        return { normal, oath };
    }

    function createVoiceTable(titleText, lines) {
        const table = document.createElement('table');
        table.className = 'voice-line-table';

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const headerCell = document.createElement('th');
        headerCell.colSpan = 2;
        headerCell.appendChild(createTableHeader(titleText));
        headerRow.appendChild(headerCell);
        thead.appendChild(headerRow);

        const tbody = document.createElement('tbody');
        lines.forEach(line => tbody.appendChild(createVoiceRow(line)));

        table.append(thead, tbody);
        return table;
    }

    function createTableHeader(titleText) {
        const header = document.createElement('div');
        header.className = 'table-header-with-volume';

        const title = document.createElement('span');
        title.textContent = titleText;
        header.append(title, createVolumeControlElement());
        return header;
    }

    function createVoiceRow({ label, text, src }) {
        const row = document.createElement('tr');

        const labelCell = document.createElement('td');
        labelCell.textContent = label;

        const textCell = document.createElement('td');
        const wrapper = document.createElement('div');
        const lineText = document.createElement('span');
        lineText.textContent = text;
        wrapper.appendChild(lineText);
        wrapper.appendChild(createPlayButton(src));
        textCell.appendChild(wrapper);

        row.append(labelCell, textCell);
        return row;
    }

    function createPlayButton(src) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'play-voice-btn';
        button.setAttribute('aria-label', src ? '대사 재생' : '대사 음성 없음');
        if (src) {
            button.dataset.src = src;
        } else {
            button.disabled = true;
        }

        button.appendChild(createIcon('fas fa-play'));
        return button;
    }

    function renderAsmrSection(skin) {
        const asmrVoices = skin['ASMR 음성'];
        if (!Array.isArray(asmrVoices) || asmrVoices.length === 0) {
            hideElement(elements.asmrTable);
            return;
        }

        elements.asmrTable.replaceChildren();
        const rows = [];
        asmrVoices.forEach((line, i) => {
            const label = `ASMR ${String(i + 1).padStart(2, '0')}`;
            const text = line.voiceline || '';
            rows.push({ label, text, src: line.voicelink || '' });
        });

        // ASMR illustration toggle
        const asmrPainting = skin['ASMR 일러'];
        if (asmrPainting) {
            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'asmr-illust-toggle';
            toggleBtn.setAttribute('aria-expanded', 'false');

            const toggleLabel = document.createElement('span');
            toggleLabel.textContent = 'ASMR 일러스트 보기';
            toggleBtn.append(createIcon('fas fa-image'), toggleLabel);

            const container = document.createElement('div');
            container.className = 'asmr-illust-container hidden';
            const img = document.createElement('img');
            img.src = asmrPainting;
            img.alt = 'ASMR 일러스트';
            img.loading = 'lazy';
            container.appendChild(img);

            toggleBtn.addEventListener('click', () => {
                const isVisible = !container.classList.contains('hidden');
                toggleElement(container, !isVisible);
                toggleBtn.setAttribute('aria-expanded', String(!isVisible));
                toggleLabel.textContent = isVisible ? 'ASMR 일러스트 보기' : 'ASMR 일러스트 숨기기';
            });

            elements.asmrTable.append(toggleBtn, container);
        }

        elements.asmrTable.appendChild(createVoiceTable('ASMR 대사', rows));
        showElement(elements.asmrTable);
    }

    function updateURLWithFilters() {
        if (isApplyingURLState) return;
        setUrlParams({
            character: elements.charInput.value || null,
            skin: elements.skinInput.value || null
        }, { clear: true });
    }

    // ===== Random Skin Feature =====
    /**
     * Wire the random skin modal: filter dropdowns (rarity/type/tag/nation),
     * count display, and the "go" button that picks and navigates to a random skin.
     */
    function setupRandomSkin() {
        const randomBtn = document.getElementById('random-skin-btn');
        const modal = document.getElementById('random-skin-modal');
        const backdrop = modal.querySelector('.random-skin-modal-backdrop');
        const closeBtn = document.getElementById('random-skin-close');
        const goBtn = document.getElementById('random-skin-go');
        const countEl = document.getElementById('random-skin-count');

        const raritySelect = document.getElementById('random-rarity-filter');
        const typeSelect = document.getElementById('random-type-filter');
        const tagSelect = document.getElementById('random-tag-filter');
        const nationSelect = document.getElementById('random-nation-filter');

        let skinPool = [];
        let filterData = null;

        function initFilterData() {
            if (filterData) return;
            filterData = getSkinFilterData();
            skinPool = filterData.pool;

            // Populate dropdowns
            filterData.filters.rarities.forEach(v => raritySelect.add(new Option(v, v)));
            filterData.filters.types.forEach(v => typeSelect.add(new Option(v, v)));
            filterData.filters.tags.forEach(v => tagSelect.add(new Option(v, v)));
            filterData.filters.nations.forEach(v => nationSelect.add(new Option(v, v)));
        }

        function getFilteredPool() {
            const rarity = raritySelect.value;
            const type = typeSelect.value;
            const tag = tagSelect.value;
            const nation = nationSelect.value;

            return skinPool.filter(s => {
                if (rarity && s.rarity !== rarity) return false;
                if (type && s.type !== type) return false;
                if (tag && !s.tagList.includes(tag)) return false;
                if (nation && s.nation !== nation) return false;
                return true;
            });
        }

        function updateCount() {
            const filtered = getFilteredPool();
            countEl.textContent = `${filtered.length}개의 스킨`;
            goBtn.disabled = filtered.length === 0;
        }

        function openModal() {
            initFilterData();
            updateCount();
            modal.style.display = 'flex';
            modal.setAttribute('aria-hidden', 'false');
            randomBtn.setAttribute('aria-expanded', 'true');
            document.body.classList.add('no-scroll');
            goBtn.focus();
        }

        function closeModal() {
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            randomBtn.setAttribute('aria-expanded', 'false');
            document.body.classList.remove('no-scroll');
            randomBtn.focus();
        }

        randomBtn.addEventListener('click', openModal);
        closeBtn.addEventListener('click', closeModal);
        backdrop.addEventListener('click', closeModal);

        // Update count on filter change
        [raritySelect, typeSelect, tagSelect, nationSelect].forEach(sel => {
            sel.addEventListener('change', updateCount);
        });

        // Close on ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.style.display !== 'none') closeModal();
        });

        // Go button - pick random and navigate
        goBtn.addEventListener('click', () => {
            const filtered = getFilteredPool();
            if (filtered.length === 0) return;

            const pick = filtered[Math.floor(Math.random() * filtered.length)];
            closeModal();

            // Navigate to the picked skin
            handleCharacterSelect(pick.charName, false);
            handleSkinSelect(pick.skinName);
        });
    }

    function applyFiltersFromURL() {
        isApplyingURLState = true;
        try {
            const char = getUrlParam('character');
            const skin = getUrlParam('skin');

            if (!char) {
                elements.charInput.value = '';
                elements.skinInput.value = '';
                elements.skinInput.placeholder = '함순이를 먼저 선택해주세요...';
                elements.skinInput.disabled = true;
                clearSkinDetails();
                return;
            }

            // Normalize and find exact or fuzzy match
            const normalizedChar = char.trim();
            const allNames = getAllCharacterNames();
            let matchedName = allNames.includes(normalizedChar) ? normalizedChar : '';

            if (!matchedName) {
                const results = searchCharacters(normalizedChar);
                if (results.length > 0 && (results[0].score ?? 1) < 0.3) {
                    matchedName = results[0].item.name;
                }
            }

            if (!matchedName) {
                clearSkinDetails();
                return;
            }

            handleCharacterSelect(matchedName, false);

            if (!skin) return;
            const skins = getSkinsForCharacter(matchedName);
            const normalizedSkin = normalizeRomanNumerals(skin);
            const matchedSkin = skins.includes(skin)
                ? skin
                : skins.find(skinName => normalizeRomanNumerals(skinName) === normalizedSkin);

            if (matchedSkin) {
                handleSkinSelect(matchedSkin);
            } else if (skins.length > 0) {
                handleSkinSelect(skins[0]);
            }
        } finally {
            isApplyingURLState = false;
        }
    }
});
