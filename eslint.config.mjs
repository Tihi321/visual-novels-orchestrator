import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // tmp-diag-utilproc: a scratch utilProcess probe committed by mistake, not app code (CommonJS require)
  { ignores: ['node_modules', 'out', 'dist', '.claude', 'seed', 'tmp-diag-utilproc'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  }
)
