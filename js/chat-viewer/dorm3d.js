/**
 * Dorm3D Chat Viewer Configuration
 * Initializes the chat viewer for 3D Dorm conversations
 */
document.addEventListener('DOMContentLoaded', () => {
    new ChatViewerEngine({
        // Data source for Dorm3D conversations
        dataUrl: 'data/chat-viewer/dorm3d_data.json',

        // Timing configuration (ms)
        defaultDelay: 1300,   // Delay between regular messages
        initialDelay: 100,    // Initial delay before first message

        // Custom event handlers specific to Dorm3D
        customHandlers: {
            /**
             * Handle Type 4 scripts (special events in Dorm3D)
             * Applies shake effect to last message bubble
             */
            handleType4: function(script) {
                console.log(`[Dorm3D] Special Event: Type ${script.type}, Param: ${script.param}`);

                const lastBubble = this.storyContainer.lastElementChild;
                if (lastBubble) {
                    // Add temporary shake animation
                    lastBubble.classList.add('shake-effect');
                    setTimeout(() => lastBubble.classList.remove('shake-effect'), 700);
                }
            }
        }
    });
});