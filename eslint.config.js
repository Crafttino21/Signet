import { defineConfig } from 'eslint/config';
import globals from 'globals';
import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';

/**
 * The repository holds two very different kinds of code, and they must not be
 * judged by the same rules:
 *
 * - the Obsidian plugin under `src/`, plus the shared protocol package, which run
 *   inside Obsidian and are held to the community review's standards;
 * - the sync server under `packages/server/`, which is a Node service. There,
 *   importing `node:fs` is the point rather than a mobile-compatibility bug, and a
 *   daemon that logs nothing is a daemon nobody can operate.
 */
/** The sync server is a Node service; Obsidian's rules do not apply to it. */
const NOT_OBSIDIAN = ['packages/server/**'];

/**
 * Obsidian's rule set, kept away from the server.
 *
 * Its entries carry their own `files` targeting — one of them even switches the
 * language to JSON so it can validate the manifest — so rewriting that targeting
 * breaks them. Adding an `ignores` instead leaves each entry pointed where its
 * author intended.
 */
const obsidianRules = obsidianmd.configs.recommended.map((config) =>
	// An entry carrying only `ignores` is a global-ignores block. Extending that
	// one would exclude the server from every rule, including our own.
	Object.keys(config).length === 1 && 'ignores' in config
		? config
		: { ...config, ignores: [...(config.ignores ?? []), ...NOT_OBSIDIAN] }
);

export default defineConfig(
	{
		// Build output and dependencies are never linted.
		ignores: ['main.js', 'node_modules/**', 'coverage/**', 'packages/*/dist/**'],
	},

	...obsidianRules,

	{
		// Scoping Obsidian's rule set above also scoped its plugin registrations, so
		// typescript-eslint is set up here for the whole repository. Type-aware rules
		// need the project service on every linted TypeScript file.
		files: ['**/*.ts'],
		plugins: { '@typescript-eslint': tseslint.plugin },
		languageOptions: {
			parser: tseslint.parser,
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
			// TypeScript already resolves every identifier; the core rule only adds
			// false alarms about Buffer, process and the NodeJS namespace.
			'no-undef': 'off',
		},
	},

	{
		// The sync server is a Node service, not a plugin.
		files: ['packages/server/**/*.ts', 'packages/server/*.mjs'],
		languageOptions: {
			globals: globals.node,
		},
		rules: {
			// A server that cannot say why it refused to start is unoperatable.
			'obsidianmd/rule-custom-message': 'off',
		},
	},

	{
		// Build and test configuration runs in Node, never inside Obsidian.
		files: ['*.config.js', '*.config.mjs', '*.config.ts', '*.config.mts', '**/build.mjs'],
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			// Build tooling is a devDependency of the workspace root.
			'import/no-extraneous-dependencies': 'off',
		},
	},

	{
		// The settings tab deliberately stays on the pre-1.13 `display()` API so that
		// minAppVersion can stay where it is. See the comment at the top of the file.
		files: ['src/core/settings-tab.ts'],
		rules: {
			'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
			'@typescript-eslint/no-deprecated': 'off',
		},
	},

	{
		// The shared protocol package runs inside Obsidian *and* on the sync server,
		// so `window` does not exist for half of its callers. The rule guards against
		// per-popout-window state, which the crypto namespace is not.
		files: ['packages/protocol/src/**/*.ts'],
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
			'import/no-extraneous-dependencies': 'off',
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
