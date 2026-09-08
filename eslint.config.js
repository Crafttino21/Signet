import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig(
	{
		// Build output and dependencies are never linted.
		ignores: ['main.js', 'node_modules/**', 'coverage/**'],
	},

	// Obsidian's own review rules. Running these locally means the community
	// review does not surprise us later.
	...obsidianmd.configs.recommended,

	{
		// Type-aware rules need this on every linted TypeScript file, including
		// vitest.config.ts — not just the ones under src/.
		files: ['**/*.ts'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
			'@typescript-eslint/consistent-type-imports': 'error',
		},
	},

	{
		// Build and test configuration runs in Node, never inside Obsidian, so the
		// mobile-compatibility rules do not apply to it.
		files: ['*.config.js', '*.config.mjs', '*.config.ts', '*.config.mts'],
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},

	{
		// The settings tab deliberately stays on the pre-1.13 `display()` API so that
		// minAppVersion can remain 1.7.2. See the comment at the top of the file.
		files: ['src/core/settings-tab.ts'],
		rules: {
			'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
			'@typescript-eslint/no-deprecated': 'off',
		},
	},

	{
		// Crypto lives on `globalThis` rather than `window` on purpose: this code
		// also runs under Node in the tests, where `window` does not exist. The rule
		// guards against per-popout-window state, which the crypto namespace is not.
		files: ['src/modules/plugin-ring/code.ts', 'src/modules/plugin-ring/crypto.ts'],
		rules: {
			'obsidianmd/no-global-this': 'off',
		},
	},

	{
		// The double-sync check has to look at folders above the vault, which needs
		// Node. It uses exactly the guarded `require` the rule's own message asks
		// for — the call sites sit behind Platform.isDesktopApp and an adapter check.
		files: ['src/modules/sync-health/double-sync.ts'],
		languageOptions: {
			globals: { require: 'readonly' },
		},
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'@typescript-eslint/no-require-imports': 'off',
		},
	},

	{
		// Tests build fake vaults, so a literal '.obsidian' is the thing under test
		// rather than a hardcoded assumption. Matchers like expect.objectContaining
		// are typed as `any`, which is the assertion library's business, not ours.
		files: ['**/*.test.ts', 'src/test/**/*.ts'],
		rules: {
			'obsidianmd/hardcoded-config-path': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
		},
	},

	{
		// The stub imitates Obsidian's API for tests. It runs in jsdom, where
		// Obsidian's DOM helpers (createDiv, the window timer wrappers) do not
		// exist, so plain DOM calls are correct here.
		files: ['src/test/**/*.ts'],
		rules: {
			'obsidianmd/prefer-create-el': 'off',
			'obsidianmd/prefer-window-timers': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-empty-function': 'off',
		},
	}
);
