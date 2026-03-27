# ULDA Bachelor Research Workspace

## Overview

This repository is a public-facing ULDA research and bachelor-project workspace related to the topic:

**Information system of stateless authentication for web services with minimal metadata disclosure. Information and software support for cryptographic subject verification based on ULDA protocols.**

The repository is intended for experimental development, software maintenance coursework, and demonstration of ULDA-based ideas. It should not be interpreted as a production-ready identity platform.

## Relation to the bachelor thesis topic

The main focus of this repository is the ULDA-based approach to cryptographic subject verification and state progression with minimal metadata disclosure.

- `packages/ulda-sign` contains the core signing and verification logic most closely related to the bachelor topic.
- `packages/ulda-front` provides a frontend-oriented integration layer for working with ULDA-backed encrypted records.
- The applications under `applications/` are supporting demos, experiments, and test servers built around those packages.

Although the repository includes a password keeper example, this project is **not** positioned as a generic password manager repository. The password keeper is only a demonstration application used to showcase ULDA integration in a browser-oriented workflow.

## Repository structure

- `packages/ulda-sign`  
  Core ULDA signing functionality and tests. This is the part most directly connected to the research topic.

- `packages/ulda-front`  
  Frontend integration layer for working with ULDA-protected data and transport adapters.

- `applications/example-password-keeper`  
  Demo application that shows one possible user-facing integration of the ULDA approach.

- `applications/ulda-crud`  
  Supporting CRUD-style demo server backed by MySQL for experiments with ULDA state verification.

- `applications/max_speed_test_server`  
  Supporting in-memory test server for performance and stress experiments.

## How to start exploring the repository

There is no single root application entry point. The repository is organized as a workspace of related packages and demo applications.

Suggested starting points:

1. Review `packages/ulda-sign` to inspect the core ULDA-related logic.
2. Review `packages/ulda-front` to understand the frontend-facing integration layer.
3. Open one of the demo applications in `applications/` depending on your focus:
   - `example-password-keeper` for an end-user style demo
   - `ulda-crud` for a MySQL-backed demo server
   - `max_speed_test_server` for performance-oriented experiments

Each application directory contains its own `package.json` and local documentation. Where available, use the scripts documented in those local files instead of assuming a root-level bootstrap command.

## Developer setup

For deployment-oriented development in this repository, the most practical main target is:

- `applications/ulda-crud`

This is the MySQL-backed demo server and the closest thing in the repository to a standalone server deployment target.

### Required software

Install these tools on a fresh machine before starting:

- Git
- Node.js `>=18`
- npm
- MySQL 8.0+ or Docker Desktop / Docker Engine

Optional but useful:

- a database client such as MySQL Shell, MySQL Workbench, or the `mysql` CLI

### Clone the repository

```bash
git clone https://github.com/iammarguuss/ulda-bachelor.git
cd ulda-bachelor
```

### Install repository-level tooling

The root repository contains linting, type-checking, and documentation tooling:

```bash
npm install
```

Useful root commands:

```bash
npm run lint
npm run typecheck
npm run check
npm run docs:build
```

### Prepare the main deployment target

Install the application dependencies for `applications/ulda-crud`:

```bash
cd applications/ulda-crud
npm install
```

### Configure the database

Use the provided example configuration as a starting point:

```bash
cp .env.example .env
```

If you are on Windows without `cp`, create `.env` manually from `.env.example`.

Review at least these variables:

- `PORT`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_POOL_LIMIT`

Optional Docker fallback variables already supported by the application:

- `DB_DOCKER_ENABLE`
- `DB_DOCKER_IMAGE`
- `DB_DOCKER_CONTAINER`
- `DB_DOCKER_VOLUME`
- `DB_DOCKER_ROOT_PASSWORD`

### Run the application in development mode

From `applications/ulda-crud`:

```bash
npm run dev
```

After startup, verify the main endpoints:

- `http://localhost:8787/health`
- `http://localhost:8787/config`
- `http://localhost:8787/browser-test/`

### Basic day-to-day operations

From the repository root:

```bash
npm run check
npm run docs:build
```

From `applications/ulda-crud`:

```bash
npm run dev
npm test
```

More deployment, update, and backup guidance is documented in:

- `docs/deployment.md`
- `docs/update.md`
- `docs/backup.md`

For an optional container-based setup of the same deployment target, see:

- `applications/ulda-crud/Dockerfile`
- `applications/ulda-crud/docker-compose.yml`

## Documentation conventions

This repository uses **JSDoc** as the primary code documentation style for JavaScript source files.

At minimum, documentation is expected for:

- public classes and exported functions in `packages/ulda-sign/ulda-sign.js`
- public classes and exported functions in `packages/ulda-front/ulda-front.js`
- exported HTTP-facing handlers and server factories in the demo server applications
- important configuration and payload shapes that are reused across the codebase

The most important JSDoc tags in this project are:

- `@param`
- `@returns`
- `@throws`
- `@typedef`
- `@example`

Documentation must be updated when:

- a public interface changes
- a function starts accepting a new config shape or payload shape
- a behavior-related example becomes outdated
- a generated documentation build would otherwise diverge from the actual implementation

Supporting documentation lives in:

- `docs/architecture.md`
- `docs/algorithms.md`
- `docs/interactions.md`
- `docs/generate_docs.md`

Generated HTML documentation is produced into `generated-docs/jsdoc/`.
Living documentation examples are kept in JSDoc `@example` blocks and in the existing test files under `packages/*/tests/`.

## Security and privacy note

This repository is intended to avoid storing private or sensitive information in version control. Example environment files may be included as configuration templates, but they are not secrets and should not be treated as deployed credentials.

The code and demos in this repository are experimental. They are useful for research, coursework, and prototype evaluation, but they do not claim production readiness, full hardening, or a complete operational security model.

## Prototype status

This repository contains demo and research prototype code. It is not production-ready software and should be treated as an experimental workspace for ULDA-related development and evaluation.

## License

This repository is distributed under the MIT License. See the root `LICENSE` file for the full text.
