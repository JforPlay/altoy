document.addEventListener('DOMContentLoaded', () => {
    new ChatViewerEngine({
        dataUrl: 'data/processed_dorm3d_data.json',
        defaultDelay: 1300,
        initialDelay: 100,
        customHandlers: {
            handleType4: function(script) {
                // Special Event handler for Dorm3D
                console.log(`Special Event Triggered: Type ${script.type}, Param: ${script.param}`);
                const lastBubble = this.storyContainer.lastElementChild;
                if (lastBubble) {
                    lastBubble.classList.add('shake-effect');
                    setTimeout(() => lastBubble.classList.remove('shake-effect'), 700);
                }
            }
        }
    });
});