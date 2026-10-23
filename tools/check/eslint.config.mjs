// Catches the "white screen" class of mistakes before a push: a name used but never imported/defined (JS or JSX).
import react from 'eslint-plugin-react'
import globals from 'globals'

export default [{
  files: ['**/*.{js,jsx}'],
  linterOptions: { reportUnusedDisableDirectives: 'off' },
  // the source has `eslint-disable react-hooks/...` comments: the rule only has to EXIST for eslint to accept them
  plugins: { react, 'react-hooks': { rules: { 'exhaustive-deps': { create: () => ({}) } } } },
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } }, globals: { ...globals.browser, ...globals.es2021 } },
  rules: { 'no-undef': 'error', 'react/jsx-no-undef': 'error', 'react/jsx-uses-vars': 'error' },
}]
