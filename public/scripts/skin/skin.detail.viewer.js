import { debounce, getUrlParam, hideElement, showElement, toggleElement, resolveUrl } from '../utils.js';
import { init as initSkinData, searchCharacters, getSkinsForCharacter, getSkinByName, getManifest, getAllCharacterNames } from './skin.data.js';
import { init as initSkinAudio, stopCurrentAudio, handlePlayClick, createVolumeControlHtml, attachVolumeListeners } from './skin.audio.js';
import { init as initSkinExpression, setManifest, renderImageGallery } from './skin.expression.js';

/**
 * Modern Skin Detail Viewer (Controller)
 * Orchestrates SkinData, SkinAudio, and SkinExpression modules.
 */
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
        skeleton: document.getElementById('loading-skeleton'),
        clearBtn: document.getElementById('clear-filters-btn')
    };

    // Initialize Modules
    initSkinAudio();
    initSkinExpression();
    const dataLoaded = await initSkinData();
    
    if (!dataLoaded) {
        elements.charInput.placeholder = '데이터 로딩 실패';
        return;
    }

    setManifest(getManifest());
    applyFiltersFromURL();

    // Event Listeners
    setupDropdowns();
    
    elements.clearBtn.addEventListener('click', () => {
        elements.charInput.value = '';
        elements.skinInput.value = '';
        elements.skinInput.placeholder = '함순이를 먼저 선택해주세요...';
        elements.skinInput.disabled = true;
        clearSkinDetails();
        updateURLWithFilters();
    });

    window.addEventListener('popstate', applyFiltersFromURL);

    // ============================================
    // Logic
    // ============================================

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
                elements.skinDropdown.innerHTML = `<div class="no-results">함순이를 먼저 선택해주세요</div>`;
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
            el.innerHTML = `<div class="no-results">검색 결과가 없습니다</div>`;
            return;
        }
        results.forEach(res => {
            const item = res.item;
            const a = document.createElement('a');
            a.textContent = item.name; // Simplified highlighting for brevity
            a.addEventListener('click', () => onSelect(item.name));
            el.appendChild(a);
        });
    }

    function renderSimpleDropdown(el, items, onSelect) {
        el.innerHTML = '';
        items.forEach(item => {
            const a = document.createElement('a');
            a.textContent = item;
            a.addEventListener('click', () => onSelect(item));
            el.appendChild(a);
        });
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

    async function displaySkinDetails(skinName) {
        showElement(elements.skeleton);

        const skin = await getSkinByName(skinName);
        if (!skin) {
            hideElement(elements.skeleton);
            return;
        }

        requestAnimationFrame(() => {
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
        hideElement(elements.skinInfoBox);
        hideElement(elements.imageGallery);
        hideElement(elements.textContent);
        hideElement(elements.oathTable);
        stopCurrentAudio();
    }

    function renderSkinInfoBox(skin) {
        let html = '';
        if (skin['재화']) html += `<div class="info-item"><img src="${resolveUrl('assets/icon/60px-Ruby.png')}" class="gem-icon"><span class="info-value">${skin['재화']}</span></div>`;
        if (skin['기간']) html += `<div class="info-item"><strong class="info-label">상시:</strong><span class="info-value">${skin['기간']}</span></div>`;
        if (skin['스킨 타입 - 한글']) html += `<div class="info-item"><strong class="info-label">타입:</strong><span class="info-value">${skin['스킨 타입 - 한글']}</span></div>`;
        if (skin['스킨 태그']) html += `<div class="info-item"><strong class="info-label">태그:</strong><span class="info-value">${skin['스킨 태그']}</span></div>`;

        elements.skinInfoBox.innerHTML = html;
        toggleElement(elements.skinInfoBox, !!html);
    }

    function renderVoiceLines(skin) {
        // Logic similar to original but using SkinAudio for controls
        // Simplified for brevity, keeping core logic
        const { normal, oath } = generateVoiceTableHtml(skin);
        
        // Render Normal
        if (normal) {
            const header = `<div class="table-header-with-volume"><span>대사 모음</span>${createVolumeControlHtml()}</div>`;
            elements.textContent.innerHTML = renderDescriptions(skin) + `<table class="voice-line-table"><thead><tr><th colspan="2">${header}</th></tr></thead><tbody>${normal}</tbody></table>`;
            showElement(elements.textContent);
        } else {
            hideElement(elements.textContent);
        }

        // Render Oath
        if (oath && skin['ex_chat_status'] === 1) {
            const header = `<div class="table-header-with-volume"><span>서약 대사</span>${createVolumeControlHtml()}</div>`;
            elements.oathTable.innerHTML = `<table class="voice-line-table"><thead><tr><th colspan="2">${header}</th></tr></thead><tbody>${oath}</tbody></table>`;
            showElement(elements.oathTable);
        } else {
            hideElement(elements.oathTable);
        }

        // Attach listeners
        elements.textContent.addEventListener('click', handlePlayClick);
        elements.oathTable.addEventListener('click', handlePlayClick);
        attachVolumeListeners();
    }

    function renderDescriptions(skin) {
        // Re-implement description rendering
        let html = '';
        if (skin['설명']) html += `<div class="description-item"><h2>설명</h2><p>${skin['설명']}</p></div>`;
        if (skin['자기소개'] && skin['자기소개'].voiceline) {
            const btn = skin['자기소개'].voicelink ? `<button class="play-voice-btn" data-src="${skin['자기소개'].voicelink}"><i class="fas fa-play"></i></button>` : '';
            html += `<div class="description-item self-intro"><h2>자기소개</h2><p>${skin['자기소개'].voiceline}${btn}</p></div>`;
        }
        return html ? `<div class="descriptions-panel">${html}</div>` : '';
    }

    function generateVoiceTableHtml(skin) {
        let normal = '';
        let oath = '';
        
        const createRow = (key, label) => {
            const val = skin[key];
            if (!val || !val.voiceline) return '';
            const btn = val.voicelink ? `<button class="play-voice-btn" data-src="${val.voicelink}"><i class="fas fa-play"></i></button>` : `<button class="play-voice-btn" disabled><i class="fas fa-play"></i></button>`;
            return `<tr><td>${label}</td><td><div>${val.voiceline}${btn}</div></td></tr>`;
        };

        // Priority keys
        const priority = ["입수시", "상세확인", "실망", "낯섦", "호감", "기쁨", "사랑", "서약"];
        priority.forEach(k => normal += createRow(k, k));
        
        // Other keys
        Object.keys(skin).forEach(k => {
            if (priority.includes(k)) return;
            if (k.endsWith('_ex')) {
                oath += createRow(k, k.replace('_ex', ' EX'));
            } else if (skin[k] && skin[k].voiceline && !['설명', '자기소개', '드랍 설명', '함대 특수대사'].includes(k)) {
                normal += createRow(k, k);
            }
        });

        // Special handling for fleet lines
        if (skin['함대 특수대사']) {
            skin['함대 특수대사'].forEach(l => {
                 const btn = l.voicelink ? `<button class="play-voice-btn" data-src="${l.voicelink}"><i class="fas fa-play"></i></button>` : '';
                 normal += `<tr><td>함대 특수대사</td><td><div>${l.voiceline}${btn}</div></td></tr>`;
            });
        }

        return { normal, oath };
    }

    function updateURLWithFilters() {
        const params = new URLSearchParams();
        if (elements.charInput.value) params.set('character', elements.charInput.value);
        if (elements.skinInput.value) params.set('skin', elements.skinInput.value);
        const newUrl = `${window.location.pathname}?${params.toString()}`;
        history.replaceState(null, '', newUrl);
    }

    function applyFiltersFromURL() {
        const char = getUrlParam('character');
        const skin = getUrlParam('skin');

        console.log('URL params - character:', char, 'skin:', skin);

        if (char) {
            // Normalize and find exact or fuzzy match
            const normalizedChar = char.trim();
            const allNames = getAllCharacterNames();

            console.log('Looking for character:', normalizedChar);
            console.log('Exact match exists:', allNames.includes(normalizedChar));

            // Try exact match first (case-sensitive)
            if (allNames.includes(normalizedChar)) {
                console.log('Exact match found, selecting character');
                handleCharacterSelect(normalizedChar, false);

                // If skin parameter exists, try to select it
                if (skin) {
                    const skins = getSkinsForCharacter(normalizedChar);
                    console.log('Available skins:', skins);

                    // Try exact match first
                    if (skins.includes(skin)) {
                        handleSkinSelect(skin);
                    } else {
                        // If no exact match, select the first skin (usually the default skin)
                        if (skins.length > 0) {
                            console.log('Skin not found, selecting first skin:', skins[0]);
                            handleSkinSelect(skins[0]);
                        }
                    }
                }
            } else {
                // Try fuzzy search as fallback
                console.log('No exact match, trying fuzzy search');
                const results = searchCharacters(normalizedChar);
                console.log('Fuzzy search results:', results);

                if (results.length > 0 && results[0].score < 0.3) {
                    // If we have a good match (low score = good match)
                    const matchedName = results[0].item.name;
                    console.log('Fuzzy match found:', matchedName, 'score:', results[0].score);
                    handleCharacterSelect(matchedName, false);

                    if (skin) {
                        const skins = getSkinsForCharacter(matchedName);
                        if (skins.length > 0) {
                            handleSkinSelect(skins[0]);
                        }
                    }
                }
            }
        }
    }
});