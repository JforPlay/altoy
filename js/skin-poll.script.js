document.addEventListener('DOMContentLoaded', () => {
    // --- Firebase Setup ---
    const firebaseConfig = {
        apiKey: "AIzaSyCmtsfkzlISZDd0totgv3MIrpT9kvLvKLk",
        authDomain: "azurlane-skin-vote.firebaseapp.com",
        projectId: "azurlane-skin-vote",
        storageBucket: "azurlane-skin-vote.firebasestorage.app",
        messagingSenderId: "282702723033",
        appId: "1:282702723033:web:a97b60cb7138bdbbbacbc8"
    };
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    const db = firebase.firestore();

    // --- Get HTML elements ---
    const pollContainer = document.getElementById('poll-container');
    const characterNameSearch = document.getElementById('character-name-search');
    const characterNameSelect = document.getElementById('character-name-select');
    const skinNameSearch = document.getElementById('skin-name-search');
    const skinNameSelect = document.getElementById('skin-name-select');
    const skinTypeSelect = document.getElementById('skin-type-select');
    const rarityCheckboxes = document.getElementById('rarity-checkboxes');
    const factionSelect = document.getElementById('faction-select');

    // --- State Variables ---
    let allSkins = [];
    let allCharacterNamesData = [];
    let allSkinNamesData = [];

    // --- Helper Functions ---
    const debounce = (func, delay) => { let timeoutId; return (...args) => { clearTimeout(timeoutId); timeoutId = setTimeout(() => { func.apply(this, args); }, delay); }; };

    // --- Data Loading ---
    fetch('data/subset_skin_data.json')
        .then(response => response.json())
        .then(jsonData => {
            allSkins = Object.keys(jsonData).map(key => ({ id: key, ...jsonData[key] }))
                .filter(skin => skin['깔끔한 일러']); // Load all skins with an image
            
            populateInitialFilters();
            applyFilters();
        }).catch(error => {
             console.error("Failed to load or process data:", error);
             pollContainer.innerHTML = `<p style="color: #f04747; text-align: center;">Error loading data. Please check console.</p>`;
        });

    // --- Filter Population and Logic ---
    const populateInitialFilters = () => {
        const characterNames = [...new Set(allSkins.map(s => s['함순이 이름']))].sort();
        allCharacterNamesData = characterNames.map(name => ({ value: name, text: name }));

        allSkinNamesData = allSkins.map(s => ({ 
            charName: s['함순이 이름'], 
            skinName: s['한글 함순이 + 스킨 이름'] 
        })).sort((a, b) => a.skinName.localeCompare(b.skinName));

        rebuildDropdown(characterNameSelect, allCharacterNamesData);
        rebuildDropdown(skinNameSelect, allSkinNamesData.map(s => ({ value: s.skinName, text: s.skinName })));

        const rarities = [...new Set(allSkins.map(s => s['레어도']))].filter(r => r).sort();
        rarityCheckboxes.innerHTML = '';
        rarities.forEach(rarity => {
            const label = document.createElement('label');
            label.innerHTML = `<input type="checkbox" value="${rarity}" checked> ${rarity}`;
            rarityCheckboxes.appendChild(label);
            label.querySelector('input').addEventListener('change', applyFilters);
        });
    };
    
    const rebuildDropdown = (selectElement, optionsData) => {
        const currentVal = selectElement.value;
        selectElement.innerHTML = '<option value="all">전체</option>';
        optionsData.forEach(data => {
            const option = document.createElement('option');
            option.value = data.value;
            option.textContent = data.text;
            selectElement.appendChild(option);
        });
        if (optionsData.some(d => d.value === currentVal)) {
            selectElement.value = currentVal;
        }
    };
    
    const renderPollList = (skinsToRender) => { /* This function is unchanged */ };
    const applyFilters = () => { /* This function is unchanged */ };
    const submitVote = (skinId, rating, skinName, characterName) => { /* This function is unchanged */ };
    const fetchAndDisplayResults = (skinId) => { /* This function is unchanged */ };
    
    // --- Event Listeners ---
    characterNameSearch.addEventListener('input', debounce(() => {
        const searchTerm = characterNameSearch.value.toLowerCase();
        const filteredData = allCharacterNamesData.filter(char => char.text.toLowerCase().includes(searchTerm));
        rebuildDropdown(characterNameSelect, filteredData);
    }, 250));

    skinNameSearch.addEventListener('input', debounce(() => {
        const searchTerm = skinNameSearch.value.toLowerCase();
        const selectedChar = characterNameSelect.value;
        let filteredData = allSkinNamesData;
        if (selectedChar !== 'all') {
            filteredData = filteredData.filter(skin => skin.charName === selectedChar);
        }
        filteredData = filteredData.filter(skin => skin.skinName.toLowerCase().includes(searchTerm));
        rebuildDropdown(skinNameSelect, filteredData.map(s => ({ value: s.skinName, text: s.skinName })));
    }, 250));

    characterNameSelect.addEventListener('change', () => {
        skinNameSearch.value = ''; // Clear search
        const selectedChar = characterNameSelect.value;
        let filteredSkins = allSkinNamesData;
        if (selectedChar !== 'all') {
            filteredSkins = allSkinNamesData.filter(skin => skin.charName === selectedChar);
        }
        rebuildDropdown(skinNameSelect, filteredSkins.map(s => ({ value: s.skinName, text: s.skinName })));
        applyFilters();
    });
    
    [skinNameSelect, skinTypeSelect, factionSelect].forEach(el => el.addEventListener('change', applyFilters));
});