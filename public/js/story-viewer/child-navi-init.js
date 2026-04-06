/**
 * child-navi-init.js
 * Page init for the Navi child story viewer.
 * Passes Navi-specific data paths, image URLs, and categories to
 * window.createTabStoryViewer (defined in child-story.js).
 */
import { resolveUrl } from '../utils.js';

document.addEventListener('DOMContentLoaded', () => {
    const naviConfig = {
        type: 'navi',

        dataPaths: {
            memories: 'data/story-viewer/navi_memory.json',
            endings: 'data/story-viewer/navi_ending.json',
            polaroids: 'data/story-viewer/navi_polaroid.json',
            stories: 'data/story-viewer/navi_story_data.json',
            shipgirls: 'data/story-viewer/shipgirl_data.json',
            iconMapping: 'data/story-viewer/tb_navi_memory.json'
        },

        imageUrls: {
            base: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/neweducateicon/',
            icon: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/memoryicon/',
            photo: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/neweducateicon/'
        },

        placeholderImage: resolveUrl('assets/img/navi_placeholder.webp'),

        categories: [
            {
                id: 'visits',
                name: '네비의 현실방문',
                storyKeyPrefix: 'lingyangzhelaifangjishi',
                defaultTitlePrefix: '현실방문',
                badgePrefix: '방문'
            },
            {
                id: 'daily',
                name: '네비의 일상',
                storyKeyPrefix: 'lingyangzhexinzhixuyu',
                defaultTitlePrefix: '일상',
                badgePrefix: '일상'
            }
        ],

        photoList: null // Will use default plan_square_1 to plan_square_15
    };

    const viewer = window.createTabStoryViewer(naviConfig);
    viewer.init();
});
