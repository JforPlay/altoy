import { defineConfig } from 'eslint/config';
import globals from 'globals';

const INFRASTRUCTURE_PILOT_FILES = [
    'scripts/check-structure.mjs',
    'scripts/report-route-boot.mjs',
    'scripts/route-boot-targets.mjs',
    'tests/infra/route-boot-report.test.mjs',
    'tests/infra/structure-check.test.mjs',
];

export default defineConfig([
    {
        name: 'altoy/infrastructure-pilot',
        files: INFRASTRUCTURE_PILOT_FILES,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.nodeBuiltin,
        },
        linterOptions: {
            reportUnusedDisableDirectives: 'error',
        },
        rules: {
            'no-duplicate-imports': 'error',
            'no-global-assign': 'error',
            'no-undef': 'error',
            'no-unused-vars': ['error', {
                args: 'after-used',
                caughtErrors: 'none',
                ignoreRestSiblings: true,
            }],
        },
    },
    {
        name: 'altoy/route-boot-browser-callbacks',
        files: ['scripts/report-route-boot.mjs'],
        languageOptions: {
            globals: globals.browser,
        },
    },
]);
