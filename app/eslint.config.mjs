// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const INFRASTRUCTURE_LIBRARIES = [
  'aws-lambda',
  'nodemailer',
  'nodemailer/*',
  'pino',
  'pino/*',
  '@opentelemetry/*',
];

const SERVERLESS_TYPES = ['aws-lambda'];

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist/**', 'coverage/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-console': 'warn',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.int-spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/only-throw-error': 'off',
    },
  },
  {
    files: ['src/infrastructure/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    files: ['scripts/**/*.ts', 'test/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/infrastructure/serverless/**', 'src/handler.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: SERVERLESS_TYPES,
              message:
                'Somente src/infrastructure/serverless/ conhece o formato de evento e resposta da plataforma serverless.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...INFRASTRUCTURE_LIBRARIES, '@infrastructure/*', '@interface-adapters/*'],
              message:
                'Camada interna (domain/application) deve ser livre de infraestrutura: não importe aws-lambda, nodemailer, pino, OpenTelemetry nem módulos de @infrastructure/@interface-adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/interface-adapters/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...INFRASTRUCTURE_LIBRARIES, '@infrastructure/*'],
              message:
                'interface-adapters/ é o anel de adaptadores livre de framework: não importe aws-lambda, nodemailer, pino, OpenTelemetry nem módulos de @infrastructure.',
            },
          ],
        },
      ],
    },
  },
);
