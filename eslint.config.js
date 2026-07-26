import { defineConfig } from 'eslint/config';
import globals from 'globals';

// `npm run lint` is `eslint .`, so this list is the pilot's entire scope.
// Keep it here: a path added to the npm script alone matches no config object
// and is silently skipped with exit 0.
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
            'no-unused-vars': 'error',
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
