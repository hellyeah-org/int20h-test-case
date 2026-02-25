//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'
import prettierConfig from 'eslint-config-prettier'
import * as drizzlePlugin from 'eslint-plugin-drizzle'
import prettierPlugin from 'eslint-plugin-prettier'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'

export default [
  ...tanstackConfig,
  {
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      'no-debugger': 'warn',
      'no-console': ['warn', { allow: ['error', 'warn'] }],
      'no-alert': 'warn',
      'no-constant-condition': ['error', { checkLoops: false }],

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],

      ...reactPlugin.configs?.recommended?.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/jsx-curly-brace-presence': [
        'warn',
        { props: 'never', children: 'never' },
      ],
      'react/jsx-sort-props': [
        'error',
        { callbacksLast: true, shorthandFirst: true, reservedFirst: true },
      ],

      ...reactHooksPlugin.configs?.['recommended-latest']?.rules,
    },
  },
  {
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      'prettier/prettier': 'warn',
    },
  },
  prettierConfig,
  {
    plugins: {
      drizzle: drizzlePlugin,
    },
    rules: {
      'drizzle/enforce-delete-with-where': 'error',
      'drizzle/enforce-update-with-where': 'error',
    },
  },
  {
    ignores: ['eslint.config.js', 'prettier.config.js'],
  },
]
