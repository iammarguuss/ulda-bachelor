# Repository Architecture

## Overview

This repository is organized as a JavaScript-based ULDA bachelor research workspace with two reusable package layers and several supporting demo applications.

The architecture is intentionally split into:

- cryptographic/state-transition logic
- frontend/client integration logic
- demo server/application layers
- static public-facing repository presentation

## Core reusable packages

### `packages/ulda-sign`

Responsibility:

- create ULDA origin packages
- advance origin state with `stepUp`
- sign state packages
- verify forward transitions between signatures

Why it matters:

- this package is the closest code-level representation of the bachelor-thesis topic
- other packages and demo servers depend on its behavior

### `packages/ulda-front`

Responsibility:

- expose a higher-level client API over ULDA-backed encrypted records
- manage encrypted master/content documents
- coordinate adapter-driven transport over REST or Socket.IO
- provide autosave and proxy-based mutation flow

Why it matters:

- it turns lower-level ULDA transitions into a client-side integration layer
- it is the package most likely to be reused by browser-facing applications

## Application layer

### `applications/ulda-crud`

Responsibility:

- provide a MySQL-backed demo server
- persist record content and the latest ULDA key
- verify that update/delete requests carry a valid forward ULDA transition

Role in architecture:

- reference demo backend for repository experiments
- main documented server surface for Lab 5

### `applications/example-password-keeper`

Responsibility:

- provide a demo application showing ULDA integration in a user-facing scenario
- reuse the same general verification and encrypted-record pattern as the repository backend demos

Role in architecture:

- demonstrator, not the repository identity
- useful for understanding end-to-end integration of `ulda-front`

### `applications/max_speed_test_server`

Responsibility:

- provide an in-memory ULDA server for throughput and stress experiments
- reduce startup/storage overhead for performance-oriented tests

Role in architecture:

- benchmark and stress-test support
- not intended as a durable backend

## Static documentation/presentation layer

Root static files and generated docs support public presentation of the research workspace:

- landing page files at repository root
- markdown docs in `docs/`
- generated API docs in `generated-docs/jsdoc/`

## Documentation architecture

The documentation system itself is layered:

- inline JSDoc in public code surfaces
- markdown architecture/algorithm/interaction docs for broader understanding
- generated HTML docs for navigable API output
- tests as executable living documentation
