/**
 * Modern Skin Detail Viewer
 * Features: Lightbox, Side Drawer, Loading States, Accessibility
 */

document.addEventListener('DOMContentLoaded', () => {
    // ===== DOM Elements =====
    const characterSearchInput = document.getElementById('character-search-input');
    const characterDropdownContent = document.getElementById('character-dropdown-content');
    const skinSearchInput = document.getElementById('skin-search-input');
    const skinDropdownContent = document.getElementById('skin-dropdown-content');
    const skinInfoBox = document.getElementById('skin-info-box');
    const imageGallery = document.getElementById('image-gallery');
    const textContentArea = document.getElementById('text-content-area');
    const oathTableArea = document.getElementById('oath-table-area');
    const loadingSkeleton = document.getElementById('loading-skeleton');

    // Info popup is handled globally by global.script.js

    const clearFiltersBtn = document.getElementById('clear-filters-btn');

    // Lightbox elements
    const lightboxModal = document.getElementById('lightbox-modal');
    const lightboxImage = document.getElementById('lightbox-image');
    const lightboxClose = lightboxModal.querySelector('.lightbox-close');
    const lightboxPrev = lightboxModal.querySelector('.lightbox-prev');
    const lightboxNext = lightboxModal.querySelector('.lightbox-next');
    const lightboxCaption = lightboxModal.querySelector('.lightbox-caption');
    const lightboxCounter = lightboxModal.querySelector('.lightbox-counter');

    // Scroll to top button - handled globally by global.script.js

    // ===== State Management =====
    let skinData = [];
    let allCharacterNames = [];
    let currentCharacterSkins = [];
    let currentLightboxImages = [];
    let currentLightboxIndex = 0;

    const audioState = {
        currentAudio: null,
        currentPlayButton: null,
        globalVolume: 0.3
    };

    let textContentPlayHandler = null;
    let oathTablePlayHandler = null;
    let volumeChangeHandlers = [];

    let characterFuse;
    const fuseOptions = {
        includeScore: true,
        includeMatches: true,
        threshold: 0.4,
        keys: ['name']
    };

    // ===== Utility Functions =====
    const getCategory = (str) => {
        if (!str) return 4;
        if (/^[가-힣]/.test(str)) return 1;
        if (/^[a-zA-Z]/.test(str)) return 2;
        if (/^[0-9]/.test(str)) return 3;
        return 4;
    };

    const customSort = (a, b) => {
        const categoryA = getCategory(a);
        const categoryB = getCategory(b);
        if (categoryA !== categoryB) return categoryA - categoryB;
        return a.localeCompare(b, 'ko');
    };

    const showLoadingSkeleton = () => {
        loadingSkeleton.classList.remove('hidden');
    };

    const hideLoadingSkeleton = () => {
        loadingSkeleton.classList.add('hidden');
    };

    // Info popup and scroll-to-top are handled globally by global.script.js

    // ===== Lightbox Functions =====
    const openLightbox = (images, startIndex = 0) => {
        currentLightboxImages = images;
        currentLightboxIndex = startIndex;
        showLightboxImage();
        lightboxModal.classList.add('active');
        lightboxModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('no-scroll');
    };

    const closeLightbox = () => {
        lightboxModal.classList.remove('active');
        lightboxModal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('no-scroll');
        currentLightboxImages = [];
        currentLightboxIndex = 0;
    };

    const showLightboxImage = () => {
        if (currentLightboxImages.length === 0) return;

        const currentImg = currentLightboxImages[currentLightboxIndex];
        lightboxImage.src = currentImg.src;
        lightboxImage.alt = currentImg.alt;
        lightboxCaption.textContent = currentImg.caption || '';
        lightboxCounter.textContent = `${currentLightboxIndex + 1} / ${currentLightboxImages.length}`;
    };

    // Trigger a directional slide for the current image
    const animateSlide = (direction) => {
        // reset any previous run
        lightboxImage.classList.remove('animating', 'slide-from-left', 'slide-from-right');

        // force reflow so the next class change is animated
        void lightboxImage.offsetWidth;

        // set the starting offset (left/right), then animate back to center
        lightboxImage.classList.add(`slide-from-${direction}`);
        requestAnimationFrame(() => {
            lightboxImage.classList.add('animating');
            lightboxImage.classList.remove(`slide-from-${direction}`);
        });
    };

    const showPrevImage = () => {
        if (currentLightboxImages.length === 0) return;
        currentLightboxIndex = (currentLightboxIndex - 1 + currentLightboxImages.length) % currentLightboxImages.length;
        showLightboxImage();          // updates src/caption/counter
        animateSlide('left');         // slide in from the left
    };

    const showNextImage = () => {
        if (currentLightboxImages.length === 0) return;
        currentLightboxIndex = (currentLightboxIndex + 1) % currentLightboxImages.length;
        showLightboxImage();
        animateSlide('right');        // slide in from the right
    };

    lightboxClose.addEventListener('click', closeLightbox);
    lightboxPrev.addEventListener('click', showPrevImage);
    lightboxNext.addEventListener('click', showNextImage);

    // Click outside to close
    lightboxModal.addEventListener('click', (e) => {
        if (e.target === lightboxModal) closeLightbox();
    });

    // Keyboard navigation for lightbox
    document.addEventListener('keydown', (e) => {
        if (!lightboxModal.classList.contains('active')) return;

        switch (e.key) {
            case 'Escape':
                closeLightbox();
                break;
            case 'ArrowLeft':
                showPrevImage();
                break;
            case 'ArrowRight':
                showNextImage();
                break;
        }
    });

    // ===== Dropdown Functions =====
    const populateDropdown = (dropdownEl, results, onSelectCallback) => {
        dropdownEl.innerHTML = '';
        if (results.length === 0) {
            dropdownEl.innerHTML = `<div class="no-results">검색 결과가 없습니다</div>`;
            return;
        }

        results.forEach((result, index) => {
            const item = result.item;
            const matches = result.matches;
            const a = document.createElement('a');
            a.setAttribute('role', 'option');
            a.setAttribute('tabindex', '0');

            if (matches && matches.length > 0 && matches[0].indices) {
                let highlightedName = '';
                let lastIndex = 0;
                matches[0].indices.forEach(([start, end]) => {
                    highlightedName += item.name.substring(lastIndex, start);
                    highlightedName += `<mark>${item.name.substring(start, end + 1)}</mark>`;
                    lastIndex = end + 1;
                });
                highlightedName += item.name.substring(lastIndex);
                a.innerHTML = highlightedName;
            } else {
                a.textContent = item.name;
            }

            a.addEventListener('click', () => onSelectCallback(item.name));
            a.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') onSelectCallback(item.name);
            });
            dropdownEl.appendChild(a);
        });
    };

    const populateSkinDropdown = (dropdownEl, skinNames, onSelectCallback) => {
        dropdownEl.innerHTML = '';
        if (skinNames.length === 0) {
            dropdownEl.innerHTML = `<div class="no-results">스킨이 없습니다</div>`;
            return;
        }

        skinNames.forEach(skinName => {
            const a = document.createElement('a');
            a.textContent = skinName;
            a.setAttribute('role', 'option');
            a.setAttribute('tabindex', '0');
            a.addEventListener('click', () => onSelectCallback(skinName));
            a.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') onSelectCallback(skinName);
            });
            dropdownEl.appendChild(a);
        });
    };

    const setupDropdown = (inputEl, dropdownEl, getFuseInstance, onSelectCallback) => {
        const handleFilter = () => {
            const fuse = getFuseInstance();
            if (!fuse) return;

            const searchTerm = inputEl.value;
            if (searchTerm.trim() === '') {
                const allItems = fuse.getIndex().docs.map(doc => ({ item: doc, matches: [] }));
                populateDropdown(dropdownEl, allItems, onSelectCallback);
            } else {
                const results = fuse.search(searchTerm);
                populateDropdown(dropdownEl, results, onSelectCallback);
            }
        };

        inputEl.addEventListener('keyup', debounce(handleFilter, 200));
        inputEl.addEventListener('focus', () => {
            handleFilter();
            dropdownEl.style.display = 'block';
        });
        inputEl.addEventListener('blur', () => {
            setTimeout(() => { dropdownEl.style.display = 'none'; }, 200);
        });
    };

    const setupSkinDropdown = (inputEl, dropdownEl, onSelectCallback) => {
        const showAllSkins = () => {
            if (currentCharacterSkins.length === 0) {
                dropdownEl.innerHTML = `<div class="no-results">함순이를 먼저 선택해주세요</div>`;
                return;
            }
            populateSkinDropdown(dropdownEl, currentCharacterSkins, onSelectCallback);
        };

        inputEl.addEventListener('focus', () => {
            showAllSkins();
            dropdownEl.style.display = 'block';
        });
        inputEl.addEventListener('blur', () => {
            setTimeout(() => { dropdownEl.style.display = 'none'; }, 200);
        });
    };

    // ===== URL State Management =====
    const updateURLWithFilters = () => {
        const params = new URLSearchParams();
        if (characterSearchInput.value) params.set('character', characterSearchInput.value);
        if (skinSearchInput.value) params.set('skin', skinSearchInput.value);
        const newUrl = `${window.location.pathname}?${params.toString()}`;
        history.replaceState({ path: newUrl }, '', newUrl);
    };

    const applyFiltersFromURL = () => {
        const params = new URLSearchParams(window.location.search);
        const character = params.get('character');
        const skin = params.get('skin');

        if (character && allCharacterNames.includes(character)) {
            handleCharacterSelect(character, false);
            if (skin && currentCharacterSkins.includes(skin)) {
                handleSkinSelect(skin);
            }
        }
    };

    // ===== Audio Functions =====
    const stopCurrentAudio = () => {
        if (audioState.currentAudio) {
            audioState.currentAudio.pause();
            audioState.currentAudio.currentTime = 0;
            audioState.currentAudio = null;
        }
        if (audioState.currentPlayButton) {
            audioState.currentPlayButton.innerHTML = '<i class="fas fa-play"></i>';
            audioState.currentPlayButton.classList.remove('playing');
            audioState.currentPlayButton = null;
        }
    };

    const handlePlayClick = (event) => {
        const button = event.target.closest('.play-voice-btn');
        if (!button) return;

        const src = button.getAttribute('data-src');
        if (!src) return;

        if (button === audioState.currentPlayButton) {
            stopCurrentAudio();
        } else {
            stopCurrentAudio();
            audioState.currentPlayButton = button;
            audioState.currentAudio = new Audio(src);
            audioState.currentAudio.volume = audioState.globalVolume;
            audioState.currentAudio.play().catch(e => console.error("Error playing audio:", e));
            button.innerHTML = '<i class="fas fa-stop"></i>';
            button.classList.add('playing');
            audioState.currentAudio.addEventListener('ended', stopCurrentAudio);
        }
    };

    const handleVolumeChange = (event) => {
        audioState.globalVolume = event.target.value / 100;

        if (audioState.currentAudio) {
            audioState.currentAudio.volume = audioState.globalVolume;
        }

        const allVolumeSliders = document.querySelectorAll('.volume-slider');
        const allVolumePercentages = document.querySelectorAll('.volume-percentage');

        allVolumeSliders.forEach(slider => {
            slider.value = Math.round(audioState.globalVolume * 100);
        });

        allVolumePercentages.forEach(percentage => {
            percentage.textContent = `${Math.round(audioState.globalVolume * 100)}%`;
        });

        // Update volume icon
        updateVolumeIcon();
    };

    const updateVolumeIcon = () => {
        const volumeIcons = document.querySelectorAll('.volume-icon');
        const volume = audioState.globalVolume;

        volumeIcons.forEach(icon => {
            icon.className = '';
            if (volume === 0) {
                icon.className = 'fas fa-volume-mute volume-icon';
            } else if (volume < 0.5) {
                icon.className = 'fas fa-volume-down volume-icon';
            } else {
                icon.className = 'fas fa-volume-up volume-icon';
            }
        });
    };

    const createVolumeControl = () => {
        const volumePercentage = Math.round(audioState.globalVolume * 100);
        return `
            <div class="volume-control-container">
                <i class="fas fa-volume-up volume-icon"></i>
                <input type="range" class="volume-slider" min="0" max="100" value="${volumePercentage}" aria-label="볼륨 조절">
                <span class="volume-percentage">${volumePercentage}%</span>
            </div>
        `;
    };

    // ===== Event Listener Management =====
    function removeEventListeners() {
        if (textContentPlayHandler) {
            textContentArea.removeEventListener('click', textContentPlayHandler);
            textContentPlayHandler = null;
        }
        if (oathTablePlayHandler) {
            oathTableArea.removeEventListener('click', oathTablePlayHandler);
            oathTablePlayHandler = null;
        }
        volumeChangeHandlers.forEach(({ slider, handler }) => {
            slider.removeEventListener('input', handler);
        });
        volumeChangeHandlers = [];
    }

    function addImageErrorHandlers(container) {
        const images = container.querySelectorAll('img');
        images.forEach(img => {
            img.addEventListener('error', function () {
                if (!this.classList.contains('gem-icon')) {
                    const parent = this.parentElement;
                    const errorBox = document.createElement('div');
                    errorBox.className = 'dummy-image-box';
                    errorBox.textContent = '이미지를 불러올 수 없습니다';
                    errorBox.style.minHeight = '150px';

                    if (this.classList.contains('gallery-top-banner')) {
                        errorBox.style.aspectRatio = '22 / 14';
                    } else if (this.classList.contains('tall-thumbnail')) {
                        errorBox.style.aspectRatio = '3 / 4';
                    }

                    parent.replaceChild(errorBox, this);
                }
            }, { once: true });
        });
    }

    // ===== Rendering Functions =====
    function renderSkinInfo(skin) {
        let infoHtml = '';
        const gemIconHtml = `<img src="assets/icon/60px-Ruby.png" class="gem-icon" alt="Gem">`;

        if (skin['재화']) {
            infoHtml += `<div class="info-item">${gemIconHtml}<span class="info-value">${skin['재화']}</span></div>`;
        }
        if (skin['기간']) {
            infoHtml += `<div class="info-item"><strong class="info-label">상시여부:</strong><span class="info-value">${skin['기간']}</span></div>`;
        }
        if (skin['스킨 타입 - 한글']) {
            infoHtml += `<div class="info-item"><strong class="info-label">스킨타입:</strong><span class="info-value">${skin['스킨 타입 - 한글']}</span></div>`;
        }
        if (skin['스킨 태그']) {
            infoHtml += `<div class="info-item"><strong class="info-label">스킨태그:</strong><span class="info-value">${skin['스킨 태그']}</span></div>`;
        }

        skinInfoBox.innerHTML = infoHtml;

        if (infoHtml) {
            skinInfoBox.classList.remove('hidden');
            addImageErrorHandlers(skinInfoBox);
        } else {
            skinInfoBox.classList.add('hidden');
        }
    }

    function renderImageGallery(skin) {
        let galleryHtml = '';
        const galleryImages = [];

        if (skin['전체 일러']) {
            galleryHtml += `<img class="gallery-top-banner" src="${skin['전체 일러']}" alt="전체 일러스트" loading="lazy" data-caption="전체 일러스트">`;
            galleryImages.push({ src: skin['전체 일러'], alt: '전체 일러스트', caption: '전체 일러스트' });
        }

        let bottomPanelHtml = '';
        let bottomLeftHtml = '<div class="bottom-left-panel">';

        if (skin['확대 일러']) {
            bottomLeftHtml += `<img src="${skin['확대 일러']}" alt="확대 일러스트" loading="lazy" data-caption="확대 일러스트">`;
            galleryImages.push({ src: skin['확대 일러'], alt: '확대 일러스트', caption: '확대 일러스트' });
        } else {
            bottomLeftHtml += `<div class="dummy-image-box">이 스킨은 확대 일러가 없어요 지휘관님</div>`;
        }
        bottomLeftHtml += '</div>';

        let bottomRightHtml = '<div class="bottom-right-panel">';
        const tallSources = [
            { src: skin['깔끔한 일러'], caption: '깔끔한 일러스트' },
            { src: skin['sd 일러'], caption: 'SD 일러스트' }
        ].filter(item => item.src);

        if (tallSources.length > 0) {
            bottomRightHtml += '<div class="thumbnail-group tall-group">';
            tallSources.forEach(item => {
                bottomRightHtml += `<img src="${item.src}" class="tall-thumbnail" alt="${item.caption}" loading="lazy" data-caption="${item.caption}">`;
                galleryImages.push(item);
            });
            bottomRightHtml += '</div>';
        }

        const smallSources = [
            { src: skin['아이콘 일러'], caption: '아이콘' },
            { src: skin['쥬스타 아이콘 일러'], caption: '쥬스타 아이콘' }
        ].filter(item => item.src);

        if (smallSources.length > 0) {
            bottomRightHtml += '<div class="thumbnail-group small-group">';
            smallSources.forEach(item => {
                bottomRightHtml += `<img src="${item.src}" alt="${item.caption}" loading="lazy" data-caption="${item.caption}">`;
                galleryImages.push(item);
            });
            bottomRightHtml += '</div>';
        }
        bottomRightHtml += '</div>';

        if (skin['확대 일러'] || tallSources.length > 0 || smallSources.length > 0) {
            bottomPanelHtml = `<div class="gallery-bottom-panel">${bottomLeftHtml}${bottomRightHtml}</div>`;
        }

        imageGallery.innerHTML = galleryHtml + bottomPanelHtml;

        if (galleryHtml + bottomPanelHtml) {
            imageGallery.classList.remove('hidden');
            addImageErrorHandlers(imageGallery);

            // Add click handlers for lightbox
            const clickableImages = imageGallery.querySelectorAll('img:not(.gem-icon)');
            clickableImages.forEach((img, index) => {
                img.style.cursor = 'pointer';
                img.addEventListener('click', () => {
                    openLightbox(galleryImages, index);
                });
            });
        } else {
            imageGallery.classList.add('hidden');
        }
    }

    function renderDescriptions(skin) {
        let descriptionsHtml = '';

        if (skin['설명'] || (skin['드랍 설명'] && skin['드랍 설명'].voiceline)) {
            descriptionsHtml += `<div class="description-group">`;

            if (skin['설명']) {
                descriptionsHtml += `<div class="description-item"><h2>설명</h2><p>${skin['설명']}</p></div>`;
            }
            if (skin['드랍 설명'] && skin['드랍 설명'].voiceline) {
                descriptionsHtml += `<div class="description-item"><h2>드랍 설명</h2><p>${skin['드랍 설명'].voiceline}</p></div>`;
            }

            descriptionsHtml += `</div>`;
        }

        if (skin['자기소개'] && skin['자기소개'].voiceline) {
            const intro = skin['자기소개'];
            const playButton = intro.voicelink ? `<button class="play-voice-btn" data-src="${intro.voicelink}" aria-label="자기소개 재생"><i class="fas fa-play"></i></button>` : '';
            descriptionsHtml += `<div class="description-item self-intro"><h2>자기소개</h2><p>${intro.voiceline}${playButton}</p></div>`;
        }

        return descriptionsHtml ? `<div class="descriptions-panel">${descriptionsHtml}</div>` : '';
    }

    function createVoiceLineRows(skin) {
        const nonVoiceKeys = new Set(['함순이 이름', '한글 함순이 + 스킨 이름', '영문 함순이 + 스킨 이름', '스킨 타입', '전체 일러', '확대 일러', 'sd 일러', '아이콘 일러', '쥬스타 아이콘 일러', '깔끔한 일러', '설명', '자기소개', '클뜯 id', '클뜯 함순이 id', '드랍 설명', '스킨 타입 - 한글', '상점 id', '상점 카테고리 id', '스킨 태그', '입수 영상', '재화', '기간', '진영', '레어도', 'ex_chat_status']);

        let normalTableBodyHtml = '';
        let oathTableBodyHtml = '';

        if (skin['함대 특수대사'] && Array.isArray(skin['함대 특수대사'])) {
            skin['함대 특수대사'].forEach(line => {
                if (line && line.voiceline) {
                    const playButton = line.voicelink
                        ? `<button class="play-voice-btn" data-src="${line.voicelink}" aria-label="함대 특수대사 재생"><i class="fas fa-play"></i></button>`
                        : `<button class="play-voice-btn" disabled aria-label="음성 없음"><i class="fas fa-play"></i></button>`;
                    normalTableBodyHtml += `<tr><td>함대 특수대사</td><td><div>${line.voiceline}${playButton}</div></td></tr>`;
                }
            });
        }

        const priorityOrder = ["입수시", "상세확인", "실망", "낯섦", "호감", "기쁨", "사랑", "서약"];
        const lastItem = "hp 경고";
        const normalVoiceKeys = [];
        const oathVoiceKeys = [];

        for (const key of Object.keys(skin)) {
            const value = skin[key];
            if (!value || nonVoiceKeys.has(key) || key === '함대 특수대사' || typeof value !== 'object' || !value.hasOwnProperty('voiceline')) continue;

            if (key.endsWith('_ex')) {
                oathVoiceKeys.push(key);
            } else {
                normalVoiceKeys.push(key);
            }
        }

        oathVoiceKeys.sort();
        const priorityKeysInOrder = priorityOrder.filter(key => normalVoiceKeys.includes(key));
        const restKeysSorted = normalVoiceKeys
            .filter(key => !priorityOrder.includes(key) && key !== lastItem)
            .sort();

        let finalNormalKeys = [...priorityKeysInOrder, ...restKeysSorted];
        if (normalVoiceKeys.includes(lastItem)) {
            finalNormalKeys.push(lastItem);
        }

        const createRow = (key, displayName) => {
            const value = skin[key];
            const playButton = value.voicelink
                ? `<button class="play-voice-btn" data-src="${value.voicelink}" aria-label="${displayName} 재생"><i class="fas fa-play"></i></button>`
                : `<button class="play-voice-btn" disabled aria-label="음성 없음"><i class="fas fa-play"></i></button>`;
            return `<tr><td>${displayName}</td><td><div>${value.voiceline}${playButton}</div></td></tr>`;
        };

        finalNormalKeys.forEach(key => normalTableBodyHtml += createRow(key, key));
        oathVoiceKeys.forEach(key => oathTableBodyHtml += createRow(key, key.replace('_ex', ' EX')));

        return { normalTableBodyHtml, oathTableBodyHtml };
    }

    function renderVoiceLineTables(skin) {
        const { normalTableBodyHtml, oathTableBodyHtml } = createVoiceLineRows(skin);
        let textContentHtml = renderDescriptions(skin);

        if (normalTableBodyHtml) {
            const tableHeaderHtml = `
                <div class="table-header-with-volume">
                    <span>선택한 함순이의 대사 모음</span>
                    ${createVolumeControl()}
                </div>
            `;
            textContentHtml += `<table class="voice-line-table"><thead><tr><th colspan="2">${tableHeaderHtml}</th></tr></thead><tbody>${normalTableBodyHtml}</tbody></table>`;
        }

        textContentArea.innerHTML = textContentHtml;
        textContentHtml ? textContentArea.classList.remove('hidden') : textContentArea.classList.add('hidden');

        if (oathTableBodyHtml && skin['ex_chat_status'] === 1) {
            const oathTableHeaderHtml = `
                <div class="table-header-with-volume">
                    <span>선택한 함순이의 서약대사 모음</span>
                    ${createVolumeControl()}
                </div>
            `;
            const fullOathTableHtml = `<table class="voice-line-table"><thead><tr><th colspan="2">${oathTableHeaderHtml}</th></tr></thead><tbody>${oathTableBodyHtml}</tbody></table>`;
            oathTableArea.innerHTML = fullOathTableHtml;
            oathTableArea.classList.remove('hidden');
        } else {
            oathTableArea.classList.add('hidden');
        }
    }

    function attachEventListeners() {
        removeEventListeners();

        textContentPlayHandler = handlePlayClick;
        oathTablePlayHandler = handlePlayClick;

        textContentArea.addEventListener('click', textContentPlayHandler);
        oathTableArea.addEventListener('click', oathTablePlayHandler);

        const volumeSliders = document.querySelectorAll('.volume-slider');
        volumeSliders.forEach(slider => {
            const handler = handleVolumeChange;
            slider.addEventListener('input', handler);
            volumeChangeHandlers.push({ slider, handler });
        });
    }

    function clearSkinDetails() {
        removeEventListeners();
        skinInfoBox.classList.add('hidden');
        imageGallery.classList.add('hidden');
        textContentArea.classList.add('hidden');
        oathTableArea.classList.add('hidden');
        stopCurrentAudio();
    }

    const displaySkinDetails = () => {
        const selectedSkinName = skinSearchInput.value;
        if (!selectedSkinName) {
            clearSkinDetails();
            return;
        }

        const skin = skinData.find(row => row['한글 함순이 + 스킨 이름'] === selectedSkinName);
        if (!skin) return;

        showLoadingSkeleton();

        // Use requestAnimationFrame for smooth rendering without artificial delay
        requestAnimationFrame(() => {
            renderSkinInfo(skin);
            renderImageGallery(skin);
            renderVoiceLineTables(skin);
            attachEventListeners();
            hideLoadingSkeleton();
        });
    };

    // ===== Character/Skin Selection Handlers =====
    function handleCharacterSelect(characterName, clearSkin = true) {
        characterSearchInput.value = characterName;
        characterDropdownContent.style.display = 'none';

        if (clearSkin) {
            skinSearchInput.value = '';
        }
        skinSearchInput.disabled = false;
        skinSearchInput.placeholder = '스킨을 검색/선택해주세요';

        currentCharacterSkins = skinData
            .filter(row => row['함순이 이름'] === characterName)
            .map(skin => skin['한글 함순이 + 스킨 이름']);

        if (clearSkin) {
            clearSkinDetails();
        }
        updateURLWithFilters();
    }

    function handleSkinSelect(skinName) {
        skinSearchInput.value = skinName;
        skinDropdownContent.style.display = 'none';
        displaySkinDetails();
        updateURLWithFilters();
    }

    // ===== Data Loading =====
    // TODO: optimization - This file is ~20MB. Consider splitting or lazy loading by character.
    fetchJSON('data/skin/skin_voiceline_data.json')
        .then(jsonData => {
            if (!jsonData || Object.keys(jsonData).length === 0) {
                throw new Error('JSON data is empty or invalid.');
            }
            skinData = Object.values(jsonData);

            allCharacterNames = [...new Set(skinData.map(row => row['함순이 이름']))].filter(name => name).sort(customSort);

            const characterDataForFuse = allCharacterNames.map(name => ({ name }));
            characterFuse = new Fuse(characterDataForFuse, fuseOptions);

            setupDropdown(characterSearchInput, characterDropdownContent, () => characterFuse, handleCharacterSelect);
            setupSkinDropdown(skinSearchInput, skinDropdownContent, handleSkinSelect);

            applyFiltersFromURL();
        })
        .catch(error => {
            console.error('Error loading or parsing JSON:', error);
            characterSearchInput.placeholder = 'Error: Could not load data.';
            hideLoadingSkeleton();
        });

    // ===== Clear Button =====
    clearFiltersBtn.addEventListener('click', () => {
        characterSearchInput.value = '';
        skinSearchInput.value = '';
        skinSearchInput.placeholder = '함순이를 먼저 선택해주세요...';
        skinSearchInput.disabled = true;
        clearSkinDetails();
        updateURLWithFilters();
    });

    // ===== Popstate Handler =====
    window.addEventListener('popstate', applyFiltersFromURL);

    // Initialize volume icon
    updateVolumeIcon();
});
