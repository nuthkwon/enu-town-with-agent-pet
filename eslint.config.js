// @ts-check
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Pet text must come only from each employee's own Claude: no LLM SDKs anywhere in this repo. */
const LLM_SDK_BAN = {
  patterns: [
    {
      group: [
        '@anthropic-ai/*',
        'openai',
        'openai/*',
        '@ai-sdk/*',
        'ai',
        '@google/genai',
        '@google/generative-ai',
        'langchain',
        '@langchain/*',
      ],
      message: 'ENU Den never calls an LLM server-side (see docs/adr/0002-pet-text-source.md).',
    },
  ],
};

const EFFECT_MESSAGE =
  'Effects are functions of t and the seeded Rng (o.seed): no clocks or Math.random (ADR 0008, den-fx skill).';

const CLOCK_MESSAGE =
  'Pure town rules never read the clock or randomness: take `now` (and `nowMs`) as arguments ' +
  '(docs/design/town-visualization-spec.md §6.8).';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/public/assets/**',
      '**/migrations/**',
      'apps/web/next-env.d.ts',
      '**/playwright-report/**',
      '**/test-results/**',
      'claude/plugins/*/server/**',
      'packages/fx/vendor/**',
      'records/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-restricted-imports': ['error', LLM_SDK_BAN],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, '@next/next': nextPlugin },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // Browser game/UI code must not reach server-only modules.
    files: [
      'apps/web/src/game/**/*.{ts,tsx}',
      'apps/web/src/components/**/*.{ts,tsx}',
      'apps/web/src/realtime/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...LLM_SDK_BAN.patterns,
            {
              group: ['@enu/db', '@enu/db/*', '@enu/auth', '@enu/mcp-tools', 'pg'],
              message: 'server-only module in client code',
            },
          ],
        },
      ],
    },
  },
  {
    // The web app talks to realtime only through @enu/protocol.
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/game/**', 'apps/web/src/components/**', 'apps/web/src/realtime/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...LLM_SDK_BAN.patterns,
            { group: ['@enu/realtime', '@enu/realtime/*'], message: 'use @enu/protocol' },
          ],
        },
      ],
    },
  },
  {
    // Sound is made only in apps/web/src/sound (one engine, the gate table, the user's settings; ADR 0008).
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/sound/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['AudioContext', 'webkitAudioContext', 'OfflineAudioContext', 'Audio'].map((name) => ({
          name,
          message:
            'Play sounds through @/sound (soundEngine / playMine): the gate table decides who hears what.',
        })),
      ],
      'no-restricted-properties': [
        'error',
        ...['AudioContext', 'webkitAudioContext', 'OfflineAudioContext', 'Audio'].map((property) => ({
          object: 'window',
          property,
          message:
            'Play sounds through @/sound (soundEngine / playMine): the gate table decides who hears what.',
        })),
      ],
    },
  },
  {
    // The messenger draws effects as CSS strips (FxSprite); the town has its one Phaser canvas.
    files: ['apps/web/src/components/**/*.tsx', 'apps/web/src/app/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name='canvas']",
          message: 'No <canvas> in the messenger: play effects with FxSprite / useFxLayer (ADR 0008).',
        },
      ],
    },
  },
  {
    // Business rules and the town director are pure functions of (inputs, now): the caller passes the clock.
    files: ['packages/domain/src/**/*.ts', 'apps/realtime/src/director/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: CLOCK_MESSAGE },
        { object: 'Date', property: 'now', message: CLOCK_MESSAGE },
        { object: 'performance', property: 'now', message: CLOCK_MESSAGE },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: CLOCK_MESSAGE },
      ],
    },
  },
  {
    // Effects as code (pixelfx contract): deterministic, and no words drawn inside an effect.
    files: ['packages/fx/effects/**/*.js'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: EFFECT_MESSAGE },
        { object: 'Date', property: 'now', message: EFFECT_MESSAGE },
        { object: 'performance', property: 'now', message: EFFECT_MESSAGE },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: EFFECT_MESSAGE },
        {
          selector: "CallExpression[callee.property.name='text']",
          message:
            'No text inside effects: words live in apps/web/src/i18n/ko.ts and are drawn outside (ADR 0008).',
        },
      ],
    },
  },
  {
    // Helpers copied from the pixelfx library by `pnpm fx:new --from` (import paths rewritten, otherwise as
    // upstream wrote them): keep their terse comma-expression style.
    files: ['packages/fx/effects/_lib/**/*.js'],
    rules: { '@typescript-eslint/no-unused-expressions': 'off', 'no-useless-assignment': 'off' },
  },
  {
    files: ['**/test/**', '**/*.test.ts', 'apps/e2e/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
