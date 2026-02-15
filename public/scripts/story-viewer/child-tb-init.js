import { resolveUrl } from '../utils.js';
/**
 * tb-story-init.js
 * ----------------
 * Configuration and initialization for TB Story Viewer
 */

document.addEventListener('DOMContentLoaded', () => {
    const tbConfig = {
        type: 'tb',

        dataPaths: {
            memories: 'data/story-viewer/tb_memory.json',
            endings: 'data/story-viewer/tb_ending.json',
            polaroids: 'data/story-viewer/tb_polaroid.json',
            stories: 'data/story-viewer/tb_story_data.json',
            shipgirls: 'data/story-viewer/shipgirl_data.json',
            iconMapping: 'data/story-viewer/tb_navi_memory.json'
        },

        imageUrls: {
            base: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/educatepolaroid/',
            icon: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/memoryicon/',
            photo: 'https://raw.githubusercontent.com/JforPlay/data_for_toy/main/educateavatar/'
        },

        placeholderImage: resolveUrl('assets/img/tb_placeholder.png'),

        categories: [
            {
                id: 'affection',
                name: 'TB의 호감도 스토리',
                storyKeyPrefix: 'linghangyuanhaogandu',
                defaultTitlePrefix: '호감도',
                badgePrefix: '호감도'
            },
            {
                id: 'daily',
                name: 'TB의 일상',
                storyKeyPrefix: 'linghangyuantanxin',
                defaultTitlePrefix: '일상',
                badgePrefix: '일상'
            }
        ],

        photoList: [
            'linghangyuan1_1', 'linghangyuan1_2', 'linghangyuan1_3', 'linghangyuan1_4', 'linghangyuan1_5', 'linghangyuan1_6',
            'linghangyuan2_1', 'linghangyuan2_2', 'linghangyuan2_3', 'linghangyuan2_4', 'linghangyuan2_5',
            'linghangyuan31_1', 'linghangyuan31_2',
            'linghangyuan32_1', 'linghangyuan32_2',
            'linghangyuan33_1', 'linghangyuan33_2'
        ]
    };

    const viewer = window.createTabStoryViewer(tbConfig);
    viewer.init();
});
