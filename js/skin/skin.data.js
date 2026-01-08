/**
 * Skin Data Module
 * Handles loading of skin data and expression manifests, and provides search functionality.
 */
window.SkinData = (function () {
    const state = {
        skinData: [],
        expressionManifest: {},
        characterFuse: null,
        allCharacterNames: []
    };

    const fuseOptions = {
        includeScore: true,
        includeMatches: true,
        threshold: 0.4,
        keys: ['name']
    };

    async function init() {
        try {
            // Parallel load
            const [skinDataMap, manifest] = await Promise.all([
                fetchJSON('data/skin/skin_voiceline_data.json'),
                fetchJSON('data/skin/expression_manifest.json').catch(e => {
                    console.warn('Expression manifest missing', e);
                    return {};
                })
            ]);

            state.skinData = Object.values(skinDataMap);
            state.expressionManifest = manifest || {};

            // Prepare Fuse - normalize all character names
            state.allCharacterNames = [...new Set(state.skinData.map(row => normalizeRomanNumerals(row['함순이 이름'])))]
                .filter(Boolean)
                .sort(customSort);
            
            const fuseList = state.allCharacterNames.map(name => ({ name }));
            state.characterFuse = new Fuse(fuseList, fuseOptions);

            return true;
        } catch (e) {
            console.error('SkinData init failed', e);
            return false;
        }
    }

    function getCategory(str) {
        if (!str) return 4;
        if (/^[가-힣]/.test(str)) return 1;
        if (/^[a-zA-Z]/.test(str)) return 2;
        if (/^[0-9]/.test(str)) return 3;
        return 4;
    }

    function customSort(a, b) {
        const catA = getCategory(a);
        const catB = getCategory(b);
        if (catA !== catB) return catA - catB;
        return a.localeCompare(b, 'ko');
    }

    function searchCharacters(query) {
        if (!state.characterFuse) return [];
        if (!query.trim()) {
            return state.characterFuse.getIndex().docs.map(doc => ({ item: doc, matches: [] }));
        }
        return state.characterFuse.search(query);
    }

    // Normalize to Roman numerals to handle data inconsistencies
    // Order matters: longer patterns must be replaced first to avoid partial matches
    function normalizeRomanNumerals(str) {
        if (!str) return str;
        return str
            .replace(/VIII/g, 'Ⅷ')  // ASCII VIII → Roman numeral 8
            .replace(/VII/g, 'Ⅶ')   // ASCII VII → Roman numeral 7
            .replace(/VI/g, 'Ⅵ')    // ASCII VI → Roman numeral 6
            .replace(/III/g, 'Ⅲ')   // ASCII III → Roman numeral 3
            .replace(/II/g, 'Ⅱ')    // ASCII II → Roman numeral 2
            .replace(/IV/g, 'Ⅳ')    // ASCII IV → Roman numeral 4
            .replace(/IX/g, 'Ⅸ')    // ASCII IX → Roman numeral 9
            .replace(/X/g, 'Ⅹ')     // ASCII X → Roman numeral 10
            .replace(/V/g, 'Ⅴ')     // ASCII V → Roman numeral 5
            .trim();
    }

    function getSkinsForCharacter(charName) {
        const normalized = normalizeRomanNumerals(charName);
        return state.skinData
            .filter(row => normalizeRomanNumerals(row['함순이 이름']) === normalized)
            .map(skin => skin['한글 함순이 + 스킨 이름']);
    }

    function getSkinByName(skinName) {
        return state.skinData.find(row => row['한글 함순이 + 스킨 이름'] === skinName);
    }

    function getManifest() {
        return state.expressionManifest;
    }

    function getAllCharacterNames() {
        return state.allCharacterNames;
    }

    return {
        init,
        searchCharacters,
        getSkinsForCharacter,
        getSkinByName,
        getManifest,
        getAllCharacterNames
    };
})();
