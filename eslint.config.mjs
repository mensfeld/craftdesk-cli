import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import jsdoc from 'eslint-plugin-jsdoc';

export default [
  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript files configuration
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      jsdoc: jsdoc,
    },
    rules: {
      // TypeScript rules
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // Disable base rule in favor of TypeScript version
      'no-unused-vars': 'off',

      // ============================================================
      // JSDoc Rules - Documentation Linting (like YARD for Ruby)
      // ============================================================

      // Require JSDoc for exported functions, classes, and methods
      'jsdoc/require-jsdoc': ['warn', {
        publicOnly: true,
        require: {
          FunctionDeclaration: true,
          MethodDefinition: true,
          ClassDeclaration: true,
          ArrowFunctionExpression: false,
          FunctionExpression: false,
        },
        contexts: [
          'ExportNamedDeclaration > FunctionDeclaration',
          'ExportDefaultDeclaration > FunctionDeclaration',
          'ExportNamedDeclaration > ClassDeclaration',
          'TSInterfaceDeclaration',
          'TSTypeAliasDeclaration',
        ],
        checkConstructors: false,
        checkGetters: false,
        checkSetters: false,
      }],

      // Require description in JSDoc
      'jsdoc/require-description': ['warn', {
        contexts: ['FunctionDeclaration', 'MethodDefinition', 'ClassDeclaration'],
        checkConstructors: false,
      }],

      // Require @param tags for all parameters
      'jsdoc/require-param': 'warn',
      'jsdoc/require-param-description': 'warn',
      'jsdoc/require-param-name': 'error',
      'jsdoc/require-param-type': 'off', // TypeScript provides types

      // Require @returns tag when function returns a value
      'jsdoc/require-returns': 'warn',
      'jsdoc/require-returns-description': 'warn',
      'jsdoc/require-returns-type': 'off', // TypeScript provides types

      // Require @throws tag for thrown exceptions
      'jsdoc/require-throws': 'warn',

      // Validate JSDoc syntax
      'jsdoc/check-alignment': 'error',
      'jsdoc/check-indentation': 'warn',
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-tag-names': 'error',
      'jsdoc/check-types': 'off', // TypeScript handles types

      // Require @example for public APIs
      'jsdoc/require-example': ['off', { // Enable later when docs are complete
        contexts: ['FunctionDeclaration', 'MethodDefinition'],
      }],

      // Empty tags are not allowed
      'jsdoc/empty-tags': 'error',

      // Enforce consistent tag style
      'jsdoc/tag-lines': ['warn', 'any', { startLines: 1 }],

      // No undefined types (TypeScript handles this)
      'jsdoc/no-undefined-types': 'off',

      // Valid types (TypeScript handles this)
      'jsdoc/valid-types': 'off',
    },
    settings: {
      jsdoc: {
        mode: 'typescript',
        tagNamePreference: {
          returns: 'returns',
          augments: 'extends',
        },
      },
    },
  },

  // Test files - less strict JSDoc requirements
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-unused-vars': 'off',
      // No JSDoc required for tests
    },
  },

  // Ignore patterns
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '*.js',
      '*.mjs',
    ],
  },
];
