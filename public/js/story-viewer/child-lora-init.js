import { resolveUrl } from '../utils.js';
/**
 * lora-story-init.js
 * ------------------
 * Configuration and initialization for Lora (Scavenger) Story Viewer
 */

document.addEventListener('DOMContentLoaded', () => {
    const loraConfig = {
        type: 'lora',

        dataPaths: {
            memories: 'data/story-viewer/lora_memory.json',
            endings: 'data/story-viewer/lora_ending.json',
            polaroids: 'data/story-viewer/lora_polaroid.json',
            stories: 'data/story-viewer/lora_story_data.json',
            shipgirls: 'data/story-viewer/shipgirl_data.json',
            iconMapping: 'data/story-viewer/tb_navi_memory.json'
        },

        imageUrls: {
            base: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/neweducateicon/',
            icon: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/memoryicon/',
            photo: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/neweducateicon/'
        },

        placeholderImage: resolveUrl('assets/img/lora_placeholder.webp'),

        categories: [
            {
                id: 'visits',
                name: '로라의 동료방문',
                storyKeyPrefix: 'tansuozhelaifangjishi',
                defaultTitlePrefix: '동료방문',
                badgePrefix: '방문'
            },
            {
                id: 'daily',
                name: '로라의 일상',
                storyKeyPrefix: 'tansuozhexinzhixuyu',
                defaultTitlePrefix: '일상',
                badgePrefix: '일상'
            }
        ],

        photoList: Array.from({ length: 15 }, (_, i) => `plan_explorer_square_${i + 1}`)
    };

    const viewer = window.createTabStoryViewer(loraConfig);
    viewer.init();
});
