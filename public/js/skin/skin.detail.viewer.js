/**
 * skin.detail.viewer.js
 * Page controller for the skin detail console (/skin/skin-detail-viewer/).
 *
 * Owns the data wiring of the three-pane console: the 함순이 combobox + skin rail
 * (left), the stage header (middle), and the voice drawer + player bar (right).
 * The art itself belongs to skin.detail.stage.js and the merged 찾아보기/랜덤 modal
 * to skin.detail.search.js; both are imported from here because the page keeps
 * exactly ONE page-level module tag (structure-check baseline).
 *
 * Part of the skin module group.
 */
import {
    getUrlParam,
    setUrlParams,
    showElement,
    hideElement,
    toggleElement,
    normalizeRomanNumerals,
    createIcon,
    createGemIconImg,
    setupDropdown,
    loadPageData,
    renderStatus,
    requireElements,
    getStorageItem,
    setStorageItem,
} from '../utils.js';
import {
    init as initSkinData,
    searchCharacters,
    getSkinsForCharacter,
    getSkinByName,
    getAllCharacterNames,
    getCharacterNameByGid,
    getReleaseDate,
    getSkinFilterData,
} from './skin.data.js';
import { ensureExpressionManifest } from '../expression-manifest.js';
import {
    init as initSkinAudio,
    stopCurrentAudio,
    handlePlayClick,
    subscribePlayback,
    seekTo,
    createVolumeControlElement,
    attachVolumeListeners,
} from './skin.audio.js';
import { initStage, renderStage, clearStage } from './skin.detail.stage.js';
import { initSearchModal } from './skin.detail.search.js';
import {
    VOICE_MODE_DEFAULT,
    VOICE_MODE_ALT,
    voiceToggleLabels,
    effectiveVoiceMode,
    resolveVoiceSrc,
} from './skin.voice-alt.js';

// UI-only preference (drawer open/closed), so plain storage rather than syncedStorage.
const VOICE_OPEN_KEY = 'skinDetailVoiceOpen';

// Voice drawer tabs, in render order. A tab with no lines is never rendered.
const TAB_ORDER = ['normal', 'oath', 'asmr'];
const TAB_LABELS = { normal: '대사', oath: '서약', asmr: 'ASMR' };

const EMPTY_STAGE_MESSAGE = '함순이와 스킨을 고르면 일러스트가 나옵니다.';
const PLAYER_IDLE_LABEL = '재생 중인 대사가 없습니다';

/**
 * 기믹 tag → [hue slug, short label]. The slug is what
 * `.sdv-skin-tag[data-gm]` hangs its colour on (skin.detail.viewer.console.css);
 * slugs rather than the Korean strings so a selector cannot break on an upstream
 * rename or on the parentheses in 「특수배경 (움짤)」.
 *
 * The short label is display-only, and only the long tags have one: a rail row is
 * ONE line, so 「특수배경 (움짤)」 beside 「L2D」 left 「어두침침 …」 of a skin name. The
 * full tag stays as the chip's title and is what the 기믹 filter matches on.
 * An unlisted tag renders in full, in the neutral chip.
 */
const GIMMICKS = {
    '배경': ['bg'],
    '특수배경 (움짤)': ['anim', '움짤'],
    'L2D': ['l2d'],
    'L2D+': ['l2d'],
    '쁘띠모션': ['petit', '쁘띠'],
    '브금': ['bgm'],
    '듀얼': ['dual'],
    '중파 일러': ['dmg', '중파'],
    '입막음': ['dmg'],
    'ASMR': ['asmr'],
};

document.addEventListener('DOMContentLoaded', async () => {

    // ===== Elements =====

    // Required: the DOM contract ids this controller reads or writes. A miss here
    // is a markup regression, so bail loudly rather than half-render the console.
    const elements = {
        charInput: document.getElementById('character-search-input'),
        charDropdown: document.getElementById('character-dropdown-content'),
        skinRail: document.getElementById('skin-rail'),
        skinTitle: document.getElementById('skin-title'),
        skinType: document.getElementById('skin-type'),
        skinMeta: document.getElementById('skin-meta'),
        stage: document.getElementById('skin-stage'),
        voiceTabs: document.getElementById('voice-tabs'),
        voiceList: document.getElementById('voice-list'),
    };
    if (!requireElements(elements, 'Skin detail')) return;

    // Optional: decorative or collapsible chrome. Each is null-guarded so a
    // markup rename degrades that one affordance instead of the whole page.
    const consoleEl = document.querySelector('.sdv-console');
    const charClear = document.getElementById('character-search-clear');
    const railCount = document.getElementById('skin-rail-count');
    const voiceDesc = document.getElementById('voice-desc');
    const voiceBank = document.getElementById('voice-bank');
    const voiceToggle = document.getElementById('voice-toggle');
    const voicePeek = document.getElementById('voice-peek');
    const playerBar = document.getElementById('player-bar');
    const skeleton = document.getElementById('loading-skeleton');
    const browseBtn = document.getElementById('skin-browse-btn');

    // ===== State =====

    let skinRenderToken = 0;
    let isApplyingURLState = false;
    // Alternate voice bank (JP/CN or 기본/대체 CV) — sticky across skins,
    // clamped per-skin via effectiveVoiceMode.
    let voiceMode = VOICE_MODE_DEFAULT;
    let currentVoiceSkin = null;
    let currentCharName = '';
    let currentSkinName = '';
    let activeTab = 'normal';
    let voiceOpen = true;
    // True while the player bar's seek thumb is held, so playback updates stop
    // fighting the drag for the slider's value.
    let seeking = false;
    // charName -> (skinName -> 기믹 tags), built once from the index on first rail render.
    let skinTagsByChar = null;

    // ===== Boot =====

    initSkinAudio();
    initStage();

    // Loading / empty / error states live in a node of THIS controller's own,
    // parked inside the stage column. `renderStatus` replaces its container's
    // children, and `initStage` has already filled #skin-stage with the art frame
    // it keeps a live reference to — writing a status straight into #skin-stage
    // would detach that frame for good.
    const statusHost = document.createElement('div');
    statusHost.className = 'sdv-stage-status';
    elements.stage.appendChild(statusHost);

    const player = buildPlayerBar();
    subscribePlayback(onPlaybackChange);

    if (browseBtn) browseBtn.disabled = true;

    // initSkinData reports failure by returning false; loadPageData wants a throw
    // so it can render the standard error + 다시 시도 and retry in place.
    const dataLoaded = await loadPageData(
        async () => {
            if (!await initSkinData()) throw new Error('스킨 데이터를 불러오지 못했습니다.');
            return true;
        },
        statusHost,
        {
            contextLabel: 'Skin detail',
            // The combobox is only wired below, after a successful load — leave it
            // enabled and typing is a silent no-op next to the 다시 시도 button.
            onError: () => {
                elements.charInput.placeholder = '데이터 로딩 실패';
                elements.charInput.disabled = true;
                if (browseBtn) browseBtn.disabled = true;
            },
        },
    );
    if (!dataLoaded) return;
    elements.charInput.placeholder = '함순이를 검색/선택해주세요...';
    elements.charInput.disabled = false;
    if (browseBtn) browseBtn.disabled = false;

    setupCharacterDropdown();
    initSearchModal({
        onPick: (charName, skinName) => {
            selectCharacter(charName, false);
            selectSkin(skinName);
        },
    });

    elements.skinRail.addEventListener('click', onRailClick);
    elements.voiceTabs.addEventListener('click', onTabClick);
    elements.voiceList.addEventListener('click', handlePlayClick);
    if (voiceDesc) voiceDesc.addEventListener('click', handlePlayClick);

    // The markup declares role="tablist" on #voice-tabs; the panel it drives is
    // filled here, so its role is set here.
    elements.voiceList.setAttribute('role', 'tabpanel');

    setupVoiceCollapse();

    window.addEventListener('popstate', applyFiltersFromURL);

    // Apply initial URL state after listeners are wired so deep-linked skins
    // render against fully-attached delegated handlers.
    applyFiltersFromURL();

    // ===== Character + skin selection =====

    /**
     * The 함순이 combobox is utils.js `setupDropdown` (keyboard nav + ARIA) with the
     * page's Fuse/roman-numeral matcher via `filterItems`. There is no second
     * combobox any more: skins are a rail, which is what removed the stale-filter
     * bug where the new character's skins were filtered by the old skin's name.
     */
    function setupCharacterDropdown() {
        setupDropdown({
            input: elements.charInput,
            dropdown: elements.charDropdown,
            items: getAllCharacterNames(),
            getLabel: (name) => name,
            filterItems: (query) => searchCharacters(query).map(res => res.item.name),
            onSelect: (name) => selectCharacter(name),
            onInputChange: syncCharClear,
            emptyMessage: '검색 결과가 없습니다',
        });

        // stopPropagation is what makes the refocus stick. setupDropdown closes on
        // any document click outside the input and the panel, and this button is
        // neither — so without it the open() that focus() triggers is undone by
        // that listener on the same click, leaving an empty focused field with a
        // shut list that a second click cannot reopen either (no focus event
        // fires on an already-focused input). Stopping here lets the clear end
        // where select-all-and-delete used to: caret in the box, full list under
        // it.
        charClear?.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.charInput.value = '';
            syncCharClear();
            elements.charInput.focus();
        });
    }

    /**
     * Show the X only when there is something to clear. Typing is covered by the
     * helper's `onInputChange`; every place the VALUE is set in code has to call
     * this too, because assigning `.value` fires no input event.
     */
    function syncCharClear() {
        if (charClear) charClear.hidden = !elements.charInput.value;
    }

    /**
     * Pick a 함순이: restock the rail and (unless a skin pick follows immediately,
     * as on a deep link or a modal pick) drop whatever skin was on the stage.
     */
    function selectCharacter(name, clearSkin = true) {
        currentCharName = name;
        elements.charInput.value = name;
        syncCharClear();
        if (clearSkin) {
            currentSkinName = '';
            clearSkinDetails();
        }
        renderSkinRail(name);
        updateURLWithFilters();
    }

    function selectSkin(skinName) {
        if (!skinName) return;
        currentSkinName = skinName;
        markActiveRow();
        displaySkinDetails(skinName);
        updateURLWithFilters();
    }

    function onRailClick(event) {
        const row = event.target.closest('.sdv-skin-row');
        if (!row || !elements.skinRail.contains(row)) return;
        selectSkin(row.dataset.skin);
    }

    // ===== Skin rail =====

    /**
     * 기믹 badges per skin, indexed by character on first use.
     * `getSkinFilterData()` already applies the index's tag rule (comma-separated,
     * with `X` and bare digits excluded), so this reuses it instead of re-deriving
     * the rule beside it. Keys are roman-normalized because the index keys are raw
     * while every lookup here comes from the normalized name list.
     */
    function skinTagsFor(charName) {
        if (!skinTagsByChar) {
            skinTagsByChar = new Map();
            getSkinFilterData().pool.forEach((row) => {
                const key = normalizeRomanNumerals(row.charName);
                let bucket = skinTagsByChar.get(key);
                if (!bucket) {
                    bucket = new Map();
                    skinTagsByChar.set(key, bucket);
                }
                bucket.set(row.skinName, row.tagList);
            });
        }
        return skinTagsByChar.get(normalizeRomanNumerals(charName)) || new Map();
    }

    function renderSkinRail(charName) {
        const names = getSkinsForCharacter(charName);
        const tags = skinTagsFor(charName);

        elements.skinRail.replaceChildren();
        names.forEach(name => elements.skinRail.appendChild(createSkinRow(name, tags.get(name) || [])));
        renderRailCount(names.length);
        markActiveRow();
    }

    /**
     * The skin list's section header. The figure goes in its own <strong> so the
     * stylesheet can give it the full ink while 스킨 / 개 stay quiet — the line is
     * the only thing separating the navigation block above from the rows below,
     * and as one flat muted string it read as just another row. Emptied rather
     * than blanked so the sheet's `:empty { display: none }` still fires.
     */
    function renderRailCount(count) {
        if (!railCount) return;
        railCount.replaceChildren();
        if (count <= 0) return;
        const figure = document.createElement('strong');
        figure.textContent = String(count);
        railCount.append('스킨 ', figure, '개');
    }

    /** One rail entry: a truncating name plus its 기믹 badges, on a single line. */
    function createSkinRow(skinName, tagList) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'sdv-skin-row';
        row.dataset.skin = skinName;
        row.title = skinName;

        const name = document.createElement('span');
        name.className = 'sdv-skin-name';
        name.textContent = skinName;
        row.appendChild(name);

        if (tagList.length > 0) {
            const tags = document.createElement('span');
            tags.className = 'sdv-skin-tags';
            tagList.forEach((tag) => {
                const [slug, short] = GIMMICKS[tag] || [];
                const badge = document.createElement('span');
                // `.badge` supplies the shape; the slug picks the hue.
                badge.className = 'badge sdv-skin-tag';
                if (slug) badge.dataset.gm = slug;
                if (short) badge.title = tag;
                badge.textContent = short || tag;
                tags.appendChild(badge);
            });
            row.appendChild(tags);
        }
        return row;
    }

    function markActiveRow() {
        elements.skinRail.querySelectorAll('.sdv-skin-row').forEach((row) => {
            if (row.dataset.skin === currentSkinName) row.setAttribute('aria-current', 'true');
            else row.removeAttribute('aria-current');
        });
    }

    // ===== Stage =====

    /**
     * Fetch the full skin record plus the expression manifest, then hand the art to
     * the stage module and rebuild the header and voice drawer.
     *
     * The manifest fetch belongs HERE and nowhere earlier: the R13 loading boundary
     * says the search shell must not request expression metadata, so the first skin
     * pick is what starts it (tests/smoke/skin-detail-expression-loading.spec.mjs).
     * The render token drops a response whose selection has already been replaced.
     */
    async function displaySkinDetails(skinName) {
        const renderToken = ++skinRenderToken;
        showElement(skeleton);

        let skin = null;
        let manifest = null;
        try {
            [skin, manifest] = await Promise.all([
                getSkinByName(skinName),
                ensureExpressionManifest(),
            ]);
        } catch (error) {
            console.error('Failed to load skin details', error);
        }
        if (renderToken !== skinRenderToken) return;
        if (!skin) {
            hideElement(skeleton);
            clearStage();
            clearStageHeader();
            renderStatus(statusHost, '스킨 정보를 불러올 수 없습니다.', 'error');
            return;
        }

        requestAnimationFrame(() => {
            if (renderToken !== skinRenderToken) return;
            renderStatus(statusHost, '');
            renderStageHeader(skin, skinName);
            renderStage(skin, manifest, skinName);
            renderVoicePanel(skin);
            hideElement(skeleton);
        });
    }

    /**
     * Title, 스킨 타입 chip, and the single metadata line above the art.
     *
     * 레어도 is deliberately absent: the rail row the visitor just clicked already
     * carries its badge, and on the caption it only competed with the name.
     * 기간 and the release date are ONE run (「상시 · 2022-08-04」) because they are
     * one fact — when the skin could be bought — and splitting them across the
     * separators made the line read as four unrelated labels.
     */
    function renderStageHeader(skin, skinName) {
        elements.skinTitle.textContent = skinName;

        const type = skin['스킨 타입 - 한글'] || '';
        elements.skinType.textContent = type;
        toggleElement(elements.skinType, Boolean(type));

        // 출시 stays on the date: beside 한정 a bare date reads as the END of the
        // limited run rather than the start of it.
        const parts = [];
        const release = getReleaseDate(skin['클뜯 id']);
        const sale = [skin['기간'], release && `출시 ${release}`].filter(Boolean).join(' · ');
        if (sale) parts.push(sale);
        elements.skinMeta.replaceChildren();
        if (parts.length) elements.skinMeta.append(parts.join(' · '));
        // 재화 reads as the gem it is: the same Ruby icon every other skin page
        // prices with (utils.js owns the asset), so the word can go.
        if (skin['재화']) {
            if (parts.length) elements.skinMeta.append(' · ');
            elements.skinMeta.append(
                createGemIconImg(),
                ` ${Number(skin['재화']).toLocaleString()}`
            );
        }
        toggleElement(elements.skinMeta, Boolean(elements.skinMeta.firstChild));
    }

    function clearStageHeader() {
        elements.skinTitle.textContent = '';
        elements.skinType.textContent = '';
        hideElement(elements.skinType);
        elements.skinMeta.replaceChildren();
        hideElement(elements.skinMeta);
    }

    /** Drop everything skin-scoped and return the stage to its empty state. */
    function clearSkinDetails() {
        skinRenderToken += 1;
        currentVoiceSkin = null;
        stopCurrentAudio();
        clearStage();
        clearStageHeader();
        elements.voiceTabs.replaceChildren();
        elements.voiceList.replaceChildren();
        voiceBank?.replaceChildren();
        // `.sdv-voice-desc:empty` collapses the block, so emptying it is enough.
        voiceDesc?.replaceChildren();
        hideElement(skeleton);
        renderStatus(statusHost, EMPTY_STAGE_MESSAGE, 'empty');
    }

    // ===== Voice drawer =====

    /**
     * Rebuild tabs, descriptions and the active line list.
     * Called both on a new skin and on a bank-toggle flip, so it takes the skin
     * from `currentVoiceSkin` when re-rendering in place.
     */
    function renderVoicePanel(skin = currentVoiceSkin) {
        if (!skin) return;
        currentVoiceSkin = skin;

        const altKind = skin['voice_alt_kind'] || '';
        const mode = effectiveVoiceMode(altKind, voiceMode);
        const groups = collectVoiceGroups(skin);
        const available = TAB_ORDER.filter(key => groups[key].length > 0);
        // Keep the reader's tab across skins when the new skin still has it.
        if (!available.includes(activeTab)) activeTab = available[0] || 'normal';

        renderVoiceTabs(available, groups);
        renderVoiceBank(altKind);
        renderVoiceDesc(skin, mode);
        // The ASMR bank has no alternate recordings, so it always plays the
        // default one instead of rendering every row disabled under 대체 CV.
        renderVoiceList(groups[activeTab] || [], activeTab === 'asmr' ? VOICE_MODE_DEFAULT : mode, skin);
    }

    function renderVoiceTabs(available, groups) {
        elements.voiceTabs.replaceChildren();
        available.forEach((key) => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'sdv-tab';
            tab.dataset.tab = key;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(key === activeTab));
            tab.textContent = `${TAB_LABELS[key]} ${groups[key].length}`;
            elements.voiceTabs.appendChild(tab);
        });
    }

    function onTabClick(event) {
        const tab = event.target.closest('.sdv-tab');
        if (!tab || tab.dataset.tab === activeTab) return;
        activeTab = tab.dataset.tab;
        renderVoicePanel();
    }

    /**
     * Segmented control switching between the default and alternate voice bank,
     * in its own `#voice-bank` slot beside the tabs. Empty for the skins that have
     * no alternate bank, which is most of them.
     */
    function renderVoiceBank(kind) {
        if (!voiceBank) return;
        voiceBank.replaceChildren();
        if (!kind) return;

        const labels = voiceToggleLabels(kind);
        voiceBank.setAttribute('role', 'group');
        voiceBank.setAttribute('aria-label', '음성 선택');

        [[VOICE_MODE_DEFAULT, labels.default], [VOICE_MODE_ALT, labels.alt]].forEach(([mode, label]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'sdv-bank-btn';
            button.setAttribute('aria-selected', String(voiceMode === mode));
            button.textContent = label;
            button.addEventListener('click', () => {
                if (voiceMode === mode) return;
                voiceMode = mode;
                stopCurrentAudio();
                renderVoicePanel();
            });
            voiceBank.appendChild(button);
        });
    }

    function renderVoiceList(lines, mode, skin) {
        elements.voiceList.replaceChildren();
        if (activeTab === 'asmr') {
            const illustration = createAsmrIllustration(skin);
            if (illustration) elements.voiceList.append(...illustration);
        }
        lines.forEach(line => elements.voiceList.appendChild(createVoiceRow(line, mode)));
    }

    /** One drawer row: label, full text, play button. */
    function createVoiceRow(line, mode) {
        const row = document.createElement('div');
        row.className = 'sdv-line';

        const label = document.createElement('span');
        label.className = 'sdv-line-label';
        label.textContent = line.label;

        // A div, not a p: `.sdv-line-text` carries no margin reset, so a
        // paragraph's UA margins would inflate every row.
        const text = document.createElement('div');
        text.className = 'sdv-line-text';
        text.textContent = line.text;

        const src = resolveVoiceSrc(line, mode);
        // Partial alt packs: a line the alt bank never recorded stays visible
        // but disabled — never silently plays the other bank.
        const missingAlt = mode === VOICE_MODE_ALT && !src && !!line.src;
        row.append(
            label,
            text,
            createPlayButton(src, line.label, missingAlt ? '대체 음성이 없는 대사입니다' : ''),
        );
        return row;
    }

    /**
     * `data-src` keeps skin.audio.js `handlePlayClick` working untouched;
     * `data-label` is what the player bar names the running track with.
     */
    function createPlayButton(src, label = '', missingTitle = '') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-icon play-voice-btn';
        button.setAttribute('aria-label', src ? '대사 재생' : (missingTitle || '대사 음성 없음'));
        if (src) {
            button.dataset.src = src;
            button.dataset.label = label;
        } else {
            button.disabled = true;
            if (missingTitle) button.title = missingTitle;
        }
        button.appendChild(createIcon('fas fa-play'));
        return button;
    }

    function renderVoiceDesc(skin, mode) {
        if (!voiceDesc) return;
        voiceDesc.replaceChildren();

        const items = [];
        if (skin['설명']) items.push(createDescriptionItem('설명', skin['설명']));
        const intro = skin['자기소개'];
        if (intro && intro.voiceline) {
            const src = intro.voicelink
                ? resolveVoiceSrc({ src: intro.voicelink, altSrc: intro.voicelink_alt || '' }, mode)
                : '';
            const item = createDescriptionItem('자기소개', intro.voiceline, src);
            item.classList.add('sdv-desc-intro');
            items.push(item);
        }

        // The block collapses itself via `.sdv-voice-desc:empty`, so there is no
        // visibility class to keep in sync here.
        voiceDesc.append(...items);
    }

    /**
     * One description entry. Plain block elements with no UA margins of their own,
     * so the pair inherits `.sdv-voice-desc`'s typography instead of needing a
     * heading scale the drawer has no room for.
     */
    function createDescriptionItem(titleText, bodyText, voiceSrc = '') {
        const item = document.createElement('div');
        item.className = 'sdv-desc-item';

        const title = document.createElement('strong');
        title.className = 'sdv-desc-title';
        title.textContent = titleText;

        const body = document.createElement('span');
        body.className = 'sdv-desc-text';
        body.textContent = bodyText;

        item.append(title, body);
        if (voiceSrc) item.appendChild(createPlayButton(voiceSrc, titleText));
        return item;
    }

    /**
     * ASMR illustration toggle, rendered at the head of the ASMR tab so it sits in
     * the same scroll region as the lines it belongs to.
     * @returns {HTMLElement[]|null} [button, container] or null when the skin has none
     */
    function createAsmrIllustration(skin) {
        const asmrPainting = skin['ASMR 일러'];
        if (!asmrPainting) return null;

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'btn btn-secondary btn-sm sdv-asmr-toggle';
        toggleBtn.setAttribute('aria-expanded', 'false');

        const toggleLabel = document.createElement('span');
        toggleLabel.textContent = 'ASMR 일러스트 보기';
        toggleBtn.append(createIcon('fas fa-image'), toggleLabel);

        const container = document.createElement('div');
        container.className = 'sdv-asmr-illust hidden';
        const img = document.createElement('img');
        img.src = asmrPainting;
        img.alt = 'ASMR 일러스트';
        img.loading = 'lazy';
        // Sized inline because this pair has no page stylesheet of its own and a
        // full-size ASMR painting would otherwise blow out the drawer's width.
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        container.appendChild(img);

        toggleBtn.addEventListener('click', () => {
            const isVisible = !container.classList.contains('hidden');
            toggleElement(container, !isVisible);
            toggleBtn.setAttribute('aria-expanded', String(!isVisible));
            toggleLabel.textContent = isVisible ? 'ASMR 일러스트 보기' : 'ASMR 일러스트 숨기기';
        });

        return [toggleBtn, container];
    }

    // ===== Voice line collection =====

    /** The three tab collections. ASMR rows are index-numbered and default-bank only. */
    function collectVoiceGroups(skin) {
        const { normal, oath } = collectVoiceLines(skin);
        const asmrVoices = Array.isArray(skin['ASMR 음성']) ? skin['ASMR 음성'] : [];
        return {
            normal,
            // 서약 lines exist in the data for skins that cannot show them in game.
            oath: skin['ex_chat_status'] === 1 ? oath : [],
            asmr: asmrVoices.map((line, i) => ({
                label: `ASMR ${String(i + 1).padStart(2, '0')}`,
                text: line.voiceline || '',
                src: line.voicelink || '',
                altSrc: '',
            })),
        };
    }

    /**
     * Split a skin record's voice fields into the normal and 서약 banks.
     * Priority keys (입수시, 상세확인, …) lead; `_ex` keys are 서약; 설명/자기소개 are
     * pulled out for the description block above the list.
     */
    function collectVoiceLines(skin) {
        const normal = [];
        const oath = [];

        const addLine = (target, key, label) => {
            const val = skin[key];
            if (!val || !val.voiceline) return;
            target.push({ label, text: val.voiceline, src: val.voicelink || '', altSrc: val.voicelink_alt || '' });
        };

        // Priority keys
        const priority = ["입수시", "상세확인", "실망", "낯섦", "호감", "기쁨", "사랑", "서약"];
        priority.forEach(k => addLine(normal, k, k));

        // Gift voice lines: audio-only (game ships voice, no transcript).
        const giftKeys = ['선호 선물', '비선호 선물'];
        giftKeys.forEach(k => {
            const val = skin[k];
            if (!val) return;
            if (val.voicelink || val.voiceline) {
                normal.push({ label: k, text: val.voiceline || '', src: val.voicelink || '', altSrc: val.voicelink_alt || '' });
            }
        });

        const skipFromAuto = new Set(['설명', '자기소개', '드랍 설명', '함대 특수대사', ...giftKeys]);
        // Other keys
        Object.keys(skin).forEach(k => {
            if (priority.includes(k)) return;
            if (k.endsWith('_ex')) {
                addLine(oath, k, k.replace('_ex', ' EX'));
            } else if (skin[k] && skin[k].voiceline && !skipFromAuto.has(k)) {
                addLine(normal, k, k);
            }
        });

        // Special handling for fleet lines
        if (skin['함대 특수대사']) {
            skin['함대 특수대사'].forEach(l => {
                if (l.voiceline) {
                    normal.push({ label: '함대 특수대사', text: l.voiceline, src: l.voicelink || '', altSrc: l.voicelink_alt || '' });
                }
            });
        }

        return { normal, oath };
    }

    // ===== Drawer collapse =====

    /**
     * `#voice-toggle` closes the drawer (a class on the console, which is what the
     * grid reads) and reveals the floating `#voice-peek` pill that reopens it.
     * Visibility goes through toggleElement so nothing on these nodes mixes the
     * `.hidden` class with an inline display.
     */
    function setupVoiceCollapse() {
        setVoiceOpen(getStorageItem(VOICE_OPEN_KEY, '1') !== '0');
        voiceToggle?.addEventListener('click', () => setVoiceOpen(!voiceOpen));
        voicePeek?.addEventListener('click', () => setVoiceOpen(true));
    }

    function setVoiceOpen(open) {
        voiceOpen = open;
        consoleEl?.classList.toggle('voice-closed', !open);
        toggleElement(voicePeek, !open);
        voiceToggle?.setAttribute('aria-expanded', String(open));
        voiceToggle?.setAttribute('aria-label', open ? '대사 패널 접기' : '대사 패널 펼치기');
        setStorageItem(VOICE_OPEN_KEY, open ? '1' : '0');
    }

    // ===== Player bar =====

    /**
     * Build the bar once at boot and hide it: rebuilding it per skin would
     * re-create the volume slider under `attachVolumeListeners`, and the bar has to
     * survive the drawer re-renders it reports on. Returns the nodes the playback
     * subscription writes into, or null when the page has no bar.
     */
    function buildPlayerBar() {
        if (!playerBar) return null;

        // A four-bar level meter, not a stop button. The red stop disc was a
        // permanent alarm-coloured control that did nothing 95% of the time and
        // duplicated the row button (which already toggles to stop). The meter
        // answers the question the bar is actually asked — is something playing —
        // by moving, and stays a <button> only so stopping is still reachable once
        // the row that started it has scrolled away.
        const wave = document.createElement('button');
        wave.type = 'button';
        wave.className = 'sdv-player-wave';
        wave.setAttribute('aria-label', '재생 중지');
        wave.title = '재생 중지';
        for (let i = 0; i < 4; i++) wave.appendChild(document.createElement('span'));
        wave.addEventListener('click', () => stopCurrentAudio());

        const label = document.createElement('span');
        label.className = 'sdv-player-label';
        label.textContent = PLAYER_IDLE_LABEL;

        const time = document.createElement('span');
        time.className = 'sdv-player-time';
        time.textContent = '0:00';

        // The shared widget initializes both parts from the current global volume
        // and carries the classes skin.audio.js binds — `.volume-slider` for
        // attachVolumeListeners, `.volume-icon` for updateVolumeIcon — so take
        // them from it rather than hand-rolling either. Only the percentage label
        // stays behind; the bar has no room for it and the slider says the same
        // thing. The icon keeps NO extra class on purpose: updateVolumeIcon
        // rewrites className wholesale on every change, so the stylesheet reaches
        // it through `.sdv-player .volume-icon` instead.
        const widget = createVolumeControlElement();
        // Taken from the widget rather than built: createVolumeControlElement
        // already makes the icon updateVolumeIcon keeps in sync, and the bar had
        // been discarding it.
        const volumeIcon = widget.querySelector('.volume-icon');
        const volume = widget.querySelector('.volume-slider') || widget;
        volume.classList.add('sdv-player-volume');

        const row = document.createElement('div');
        row.className = 'sdv-player-row';
        row.append(wave, label, time, volumeIcon, volume);

        // Seek bar. A native range rather than the read-only progress div this
        // replaced: click, drag, touch and arrow keys all come with it, which is
        // the whole request. `max` is the clip's duration in seconds so the value
        // IS the seek target and no rescaling is needed.
        const seek = document.createElement('input');
        seek.type = 'range';
        seek.className = 'sdv-player-seek';
        seek.min = '0';
        seek.max = '0';
        // 0.25, not 0.01: arrow keys move by `step`, and at a hundredth of a second
        // crossing a 3-second voice line takes ~300 presses. A quarter-second is
        // still finer than one pixel of this bar, so dragging loses nothing.
        seek.step = '0.25';
        seek.value = '0';
        seek.disabled = true;
        seek.setAttribute('aria-label', '재생 위치');

        // `input` fires all through a drag, so the audio follows the thumb live.
        // The flag only suppresses the SUBSCRIPTION's writes meanwhile: playback
        // continues during a drag, so an incoming timeupdate would push the thumb
        // a few hundredths past where the pointer is holding it. Pointer-ended
        // rather than change-ended alone because a keyboard step fires `input`
        // with no pointer sequence at all, and must still seek.
        seek.addEventListener('input', () => seekTo(Number(seek.value)));
        seek.addEventListener('pointerdown', () => { seeking = true; });
        ['pointerup', 'pointercancel', 'change'].forEach(evt =>
            seek.addEventListener(evt, () => { seeking = false; }));

        playerBar.replaceChildren(row, seek);
        attachVolumeListeners();

        // The global scroll-to-top button is fixed to the same bottom-right corner
        // this bar occupies, and clears it by this height (see the `:has` rule in
        // skin.detail.viewer.console.css). Measured rather than written down: the
        // row never wraps, so the height is constant at any one width — but it is
        // built out of --spacing tokens that change at the responsive breakpoints,
        // so a literal would need a media duplicate per breakpoint to stay true
        // (which is what the same rule in bgm-misc.css carries). One observer
        // instead, and the two additions above cost the CSS nothing.
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(() => {
                document.documentElement.style.setProperty('--sdv-player-h', `${playerBar.offsetHeight}px`);
            }).observe(playerBar);
        }

        return { label, seek, time, wave };
    }

    /**
     * Follow the shared audio element, whichever row started it.
     * The bar is permanently visible (it ships without `.hidden` and nothing here
     * hides it): it used to appear on the first playback, which meant the drawer's
     * bottom edge jumped under the reader and the volume slider was unreachable
     * until something was already playing.
     */
    function onPlaybackChange({ playing, label, currentTime, duration }) {
        if (!player) return;
        // `playing` is passed by the audio module rather than read off the element
        // (play() resolves async, so audio.paused is still true on this tick).
        player.wave.classList.toggle('is-playing', !!playing);
        player.label.textContent = label || PLAYER_IDLE_LABEL;

        // Nothing to seek through until the duration is known: the bar is
        // permanently visible, so most of the time there is no clip at all.
        player.seek.disabled = !(duration > 0);
        player.seek.max = String(duration > 0 ? duration : 0);
        if (!seeking) player.seek.value = String(duration > 0 ? Math.min(currentTime, duration) : 0);

        // The total is what makes a seek target meaningful — 0:10 means nothing
        // without knowing whether the line runs 0:12 or 1:30.
        const clock = duration > 0
            ? `${formatClock(currentTime)} / ${formatClock(duration)}`
            : formatClock(currentTime);
        player.time.textContent = clock;
        // Without this a screen reader reads the raw range value — 「10.25」 — since
        // the seconds are the slider's own units. Same string the sighted readout
        // beside it shows.
        player.seek.setAttribute('aria-valuetext', clock);
    }

    /** mm:ss for the elapsed readout (utils' formatTime is the "1m 23s" report form). */
    function formatClock(seconds) {
        const total = Math.max(0, Math.floor(seconds || 0));
        return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    }

    // ===== URL state =====

    function updateURLWithFilters() {
        if (isApplyingURLState) return;
        setUrlParams({
            character: currentCharName || null,
            skin: currentSkinName || null,
        }, { clear: true });
    }

    function applyFiltersFromURL() {
        isApplyingURLState = true;
        try {
            const char = getUrlParam('character');
            const gid = getUrlParam('gid');
            const skin = getUrlParam('skin');

            // Stable ship-group id wins: it's immune to the name spelling drift
            // across data sources (e.g. canonical 아드미랄 히퍼 vs the skin index's
            // upstream-typo 아드미럴 히퍼) that made name matching fuzzy-fall-through
            // to the wrong same-prefix ·META/variant entry.
            let matchedName = gid ? getCharacterNameByGid(gid) : '';

            if (!matchedName && !char) {
                currentCharName = '';
                currentSkinName = '';
                elements.charInput.value = '';
                syncCharClear();
                elements.skinRail.replaceChildren();
                renderRailCount(0);
                clearSkinDetails();
                return;
            }

            // Fall back to name: exact match, then fuzzy.
            if (!matchedName) {
                const normalizedChar = char.trim();
                const allNames = getAllCharacterNames();
                matchedName = allNames.includes(normalizedChar) ? normalizedChar : '';

                if (!matchedName) {
                    const results = searchCharacters(normalizedChar);
                    if (results.length > 0 && (results[0].score ?? 1) < 0.3) {
                        matchedName = results[0].item.name;
                    }
                }
            }

            if (!matchedName) {
                clearSkinDetails();
                return;
            }

            // A popstate onto a DIFFERENT 함순이 must drop the old stage even if the
            // new URL names no skin; the same character keeps its rendered skin.
            selectCharacter(matchedName, matchedName !== currentCharName);

            if (!skin) return;
            const skins = getSkinsForCharacter(matchedName);
            const normalizedSkin = normalizeRomanNumerals(skin);
            const matchedSkin = skins.includes(skin)
                ? skin
                : skins.find(skinName => normalizeRomanNumerals(skinName) === normalizedSkin);

            if (matchedSkin) {
                selectSkin(matchedSkin);
            } else if (skins.length > 0) {
                selectSkin(skins[0]);
            }
        } finally {
            isApplyingURLState = false;
        }
    }
});
