# Logging Guide

## Scope

Lab 7 logging is implemented primarily for:

- `applications/ulda-crud`

This is the main MySQL-backed server application in the repository, so it is the most appropriate target for structured logging and centralized request tracing.

## Chosen logging library

The main logging library is:

- `winston`

Why it was selected:

- it is a standard, well-documented Node.js logging library
- it supports structured metadata without adding external infrastructure
- it fits a student/research deployment better than heavier observability stacks
- it supports multiple transports and custom levels

For file rotation, the application uses:

- `winston-daily-rotate-file`

This keeps the setup local, practical, and compatible with the existing repository structure.

## Implemented log levels

The logger defines these levels:

- `debug`
- `info`
- `warning`
- `error`
- `critical`

Usage in the current implementation:

- `debug` for detailed request/operation tracing when `LOG_REQUESTS=true`
- `info` for startup, shutdown, successful HTTP/socket operations, and database readiness
- `warning` for validation failures, not-found cases, verification failures, and recoverable conditions
- `error` for server-side failures and database problems
- `critical` for `uncaughtException`, `unhandledRejection`, or fatal startup/shutdown failures

## How log level is configured

The minimum log level is configured via environment variable:

- `LOG_LEVEL`

Example:

```bash
LOG_LEVEL=debug npm run dev
```

Related logging variables documented in `applications/ulda-crud/.env.example`:

- `LOG_LEVEL`
- `LOG_DIR`
- `LOG_MAX_FILES`
- `LOG_ZIPPED_ARCHIVE`
- `LOG_REQUESTS`

## Log format and fields

Console logs are timestamped text lines with structured JSON metadata.
File logs are JSON records suitable for later filtering or manual inspection.

The most important contextual fields are:

- `requestId`
- `method`
- `path`
- `route`
- `statusCode`
- `durationMs`
- `locale`
- `ip`
- `errorId` for failures
- `component` through child loggers such as `server`, `http`, `database`, `operations`, `socket`, `process`

For critical data operations, logs also include contextual fields such as:

- `recordId`
- `contentBytes`
- `keyBytes`
- `operation`

## Log file locations

By default, `ulda-crud` writes logs to:

- `applications/ulda-crud/logs/`

The current rotating files are:

- `ulda-crud-YYYY-MM-DD.log`
- `ulda-crud-error-YYYY-MM-DD.log`

The folder can be changed with `LOG_DIR`.

## Rotation approach

Rotation is implemented in-process with `winston-daily-rotate-file`.

Current practical behavior:

- one daily combined log file
- one daily error-focused log file
- retention controlled by `LOG_MAX_FILES`
- optional compression controlled by `LOG_ZIPPED_ARCHIVE`

This is appropriate for a demo/research deployment and avoids inventing an external log management platform.

## Request ids and correlation

Each HTTP request receives a `requestId` generated with `crypto.randomUUID()`.

That value is attached to:

- request lifecycle logs
- successful JSON responses
- error responses
- contextual logs emitted during the same request

Socket operations also receive generated request-like ids so that socket failures can still be correlated in logs.

## Frontend error collection

For the browser-oriented password-keeper demo, the frontend now captures:

- `window.onerror`
- `window.onunhandledrejection`

It sends a small safe payload to:

- `POST /client-logs`

This is intentionally lightweight and limited to demo diagnostics rather than full browser observability.
