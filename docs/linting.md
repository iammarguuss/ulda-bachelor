# Linting and Static Analysis

## Tooling choice

This repository uses **ESLint** as the main linter for JavaScript and the **TypeScript compiler** in JavaScript checking mode for static analysis.

This combination was selected because it is practical for the current codebase:

- the repository is already JavaScript-based;
- ESLint is the standard maintainable choice for JavaScript correctness and style checks;
- TypeScript can check existing `.js` files with `allowJs`, `checkJs`, and `noEmit` without forcing a full migration to `.ts`.

## What matters most in this repository

The most important quality aspects for this ULDA workspace are:

- correctness in cryptographic and verification-related logic;
- avoiding accidental undefined variables and unused code paths;
- keeping server and browser-side modules readable and consistent;
- catching mistakes early before commits are created.

## Linting scope and ignores

Linting is focused on the JavaScript codebase in:

- `packages/**/*.js`
- `applications/**/*.js`

Type checking is intentionally narrower and focuses on the most stable maintainable surfaces:

- `packages/**/*.js`
- `applications/*/src/**/*.js`
- `applications/*/scripts/**/*.js`

This keeps TypeScript checks practical for the repository while browser stress-test UI code remains covered by ESLint.

Ignored paths are limited to directories that should not be linted as source code:

- `**/node_modules/**`
- `**/dist/**`
- `**/build/**`
- `**/coverage/**`
- `assets/**`
- `landing/assets/**`

## Basic ESLint rules

The root ESLint configuration uses the modern flat config format and starts from the ESLint recommended ruleset.

Additional repository rules enforce:

- `eqeqeq`: require strict equality;
- `no-unused-vars`: prevent dead bindings while allowing `_`-prefixed ignored parameters;
- `no-var`: require `let` / `const`;
- `no-empty`: disallow empty blocks except intentionally empty `catch` blocks used for best-effort demo behavior.

## How to run checks

From the repository root:

```bash
npm install
npm run lint
npm run lint:fix
npm run typecheck
npm run check
```

## Static type checking

Static analysis is configured through the root `tsconfig.json` with:

- `allowJs: true`
- `checkJs: true`
- `noEmit: true`

This means TypeScript analyzes JavaScript files for type-related problems but does not generate output files.

## Git hooks

Pre-commit hooks are configured with **Husky**.

The hook file `.husky/pre-commit` runs:

```bash
npm run check
```

This ensures linting and type checking run before a commit is finalized in a prepared local environment.

## Workflow integration

Repository-level verification is exposed through the root script:

```bash
npm run check
```

This script combines:

1. ESLint linting
2. TypeScript JS-mode type checking

That makes it suitable as the main local verification step before commits or before broader repository validation.

## Fixed-issues percentage

The percentage of fixed issues is calculated from the configured baseline after the tooling setup was added:

```text
fixed percentage = (baseline issues - remaining issues) / baseline issues * 100
```

For lab reporting:

- **50% completion** means at least half of the baseline actionable issues were removed;
- **90% completion** means at least ninety percent of the baseline actionable issues were removed;
- **100% practical completion** means the configured lint workflow passes cleanly, or only clearly documented intentional exceptions remain.

The baseline and the final count should be measured using the same commands and the same repository scope.
