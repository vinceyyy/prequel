import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'
import prettierPlugin from 'eslint-plugin-prettier'

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      'prettier/prettier': 'error',
    },
  },
  {
    ignores: ['.next/**', 'out/**', 'build/**', 'coverage/**'],
  },
]

export default eslintConfig
