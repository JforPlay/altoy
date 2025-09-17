document.addEventListener('DOMContentLoaded', () => {
    // --- URLs for external data ---
    const STORY_URL = 'test.json';
    const NAMES_URL = 'https://raw.githubusercontent.com/AzurLaneTools/AzurLaneData/refs/heads/main/KR/sharecfgdata/ship_skin_words.json';
    const SKINS_URL = 'https://raw.githubusercontent.com/Fernando2603/AzurLane/refs/heads/main/skin_list.json';

    // --- Get HTML elements ---
    const storyContainer = document.getElementById('story-container');
    const optionsContainer = document.getElementById('options-container');
    const storyHeader = document.getElementById('story-header');
    const restartButton = document.getElementById('restart-button');
    const vfxOverlay = document.getElementById('vfx-overlay');
    const flashOverlay = document.getElementById('flash-overlay');

    // --- Story state and data maps ---
    let allScripts = [];
    let currentScriptIndex = 0;
    let actorIdToNameMap = {};
    let skinData = [];

    const initializeStory = () => {
        storyHeader.innerHTML = '';
        storyContainer.innerHTML = '';
        optionsContainer.innerHTML = '';
        vfxOverlay.className = '';
        flashOverlay.style.opacity = 0;
        currentScriptIndex = 0;
        processHeader();
        currentScriptIndex = 1;
        showNextLine();
    };

    const showNextLine = () => {
        if (currentScriptIndex >= allScripts.length) return;
        const script = allScripts[currentScriptIndex];

        const continueAfterEffect = () => {
            if (script.effects) processEffects(script.effects);

            if (script.options) {
                displayBubble(script, () => displayOptions(script.options));
            } else if (script.say) {
                // The callback now schedules the next line
                displayBubble(script, () => {
                    currentScriptIndex++;
                    setTimeout(showNextLine, 400);
                });
            } else {
                currentScriptIndex++;
                showNextLine();
            }
        };

        const flashData = script.flashin || script.flashout;
        if (flashData) {
            handleFlash(flashData, continueAfterEffect);
        } else {
            continueAfterEffect();
        }
    };

    // --- MOD
