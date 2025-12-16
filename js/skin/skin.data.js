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

            // Prepare Fuse
            state.allCharacterNames = [...new Set(state.skinData.map(row => row['함순이 이름']))]
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

    function getSkinsForCharacter(charName) {
        return state.skinData
            .filter(row => row['함순이 이름'] === charName)
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
