// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/.vite/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node build/dev scripts (apps/web/scripts/*.mjs) — not part of the
    // browser bundle, so they run under Node's global scope, not the DOM's.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly' },
    },
  },
  {
    files: ['packages/loot-model/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/**'],
              message: 'loot-model may not import from apps/* (see CLAUDE.md conventions).',
            },
          ],
        },
      ],
    },
  }
)
