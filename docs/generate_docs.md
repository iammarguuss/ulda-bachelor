# Generating Documentation

## Purpose

This repository uses JSDoc-generated HTML as the main automatically built code documentation output for the public JavaScript interfaces.

The primary documented surfaces are:

- `packages/ulda-sign/ulda-sign.js`
- `packages/ulda-front/ulda-front.js`
- `applications/ulda-crud/src/server.js`
- `applications/example-password-keeper/src/server.js`
- `applications/max_speed_test_server/src/server.js`

## Prerequisites

- Node.js `>=18`
- repository dependencies installed from the root

## Exact commands

Install dependencies:

```bash
npm install
```

Run documentation quality checks already integrated into ESLint:

```bash
npm run lint
npm run typecheck
```

Generate HTML documentation:

```bash
npm run docs:build
```

Clean generated HTML output only:

```bash
npm run docs:clean
```

## Output location

Generated HTML documentation is written to:

```text
generated-docs/jsdoc/
```

The main entry page is:

```text
generated-docs/jsdoc/index.html
```

## Living documentation

The generated docs are complemented by executable examples in:

- `packages/ulda-sign/tests/ulda-sign.test.mjs`
- `packages/ulda-front/tests/ulda-front.test.mjs`

Those tests are useful when the generated HTML needs to be checked against actual current behavior.

## Archive command

If an archive needs to be created manually from the generated HTML in the current Windows environment:

```powershell
New-Item -ItemType Directory -Force artifacts | Out-Null
if (Test-Path artifacts/ulda-jsdoc.zip) { Remove-Item artifacts/ulda-jsdoc.zip -Force }
Compress-Archive -Path generated-docs/jsdoc/* -DestinationPath artifacts/ulda-jsdoc.zip
```
