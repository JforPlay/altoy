/**
 * dorm3d.js
 * Page init for the Dorm3D chat viewer. Passes Dorm3D-specific config to
 * ChatViewerEngine, including a custom type-4 handler that shakes the last bubble.
 */
import { ChatViewerEngine } from './chat-viewer.engine.js';

document.addEventListener('DOMContentLoaded', () => {
    new ChatViewerEngine({
        dataUrl: 'data/chat-viewer/dorm3d_data.json',
        defaultDelay: 1300,
        initialDelay: 100,

        customHandlers: {
            /**
             * Type 4 scripts in Dorm3D are special events (not stickers).
             * Apply a brief shake animation to the last bubble as a substitute.
             */
            handleType4: function(script) {
                const lastBubble = this.storyContainer.lastElementChild;
                if (lastBubble) {
                    // Add temporary shake animation
                    lastBubble.classList.add('shake-effect');
                    this.setTrackedTimeout(() => lastBubble.classList.remove('shake-effect'), 700);
                }
            }
        }
    });
});
