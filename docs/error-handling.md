# Error Handling Guide

## Scope

The main error-handling implementation target is:

- `applications/ulda-crud`

The goal is to provide academically defensible, maintainable handling of common web-application failures without claiming production-grade observability or incident automation.

## Error model

The application now uses reusable custom error classes:

- `AppError`
- `ValidationError`
- `NotFoundError`
- `DatabaseError`
- `VerificationError`

Each error carries:

- HTTP status
- machine-readable error code
- localization key
- next-step guidance key
- contextual payload
- unique `errorId`

## Error categories

### Validation errors

Used for malformed IDs, unsupported formats, and other invalid request payloads.

Typical result:

- HTTP `400`
- localized message
- `VALIDATION_ERROR`

### Not-found errors

Used when a route or record does not exist.

Typical result:

- HTTP `404`
- localized message
- `NOT_FOUND`

### Database errors

Used when MySQL connection or query execution fails.

Typical result:

- HTTP `503`
- localized message
- `DATABASE_ERROR`

### Verification errors

Used when ULDA forward verification fails during update or delete.

Typical result:

- HTTP `400`
- localized message
- `VERIFICATION_ERROR`

### Internal errors

Used for unexpected failures that are not already mapped to a narrower category.

Typical result:

- HTTP `500`
- localized message
- `INTERNAL_ERROR`

## Centralized HTTP error handling

`ulda-crud` now uses Express middleware for:

- not-found handling
- centralized exception logging
- localized user-facing error responses

Normal user responses do not expose stack traces.
Instead, they return:

- localized message
- short next-step guidance
- `requestId`
- `errorId`

Example response shape:

```json
{
  "ok": false,
  "error": {
    "id": "error-id",
    "code": "VALIDATION_ERROR",
    "message": "The request data is invalid.",
    "nextStep": "Review the request data and try again.",
    "requestId": "request-id"
  }
}
```

## Localization

User-facing error text is localized for:

- `en`
- `uk`

Language selection is intentionally simple:

- query parameter `lang`, if present
- otherwise `X-Lang`
- otherwise `Accept-Language`

If no Ukrainian preference is detected, English is used as the fallback.

## Unique error ids

Each `AppError` receives a unique `errorId` generated with:

- `crypto.randomUUID()`

This id is returned to the user and also written to logs, which makes it easier to match a visible failure with the corresponding server-side record.

## Request ids

Every HTTP request receives its own `requestId`, also generated with `crypto.randomUUID()`.

This id is used to:

- correlate request start/end logs
- trace DB and ULDA operation logs
- link error responses back to server logs

## Process-level handling

The application also logs:

- `unhandledRejection`
- `uncaughtException`

These are logged at `critical` level so unexpected failures are not silently ignored.

## Practical limits

This implementation is intentionally realistic for a coursework/demo repository:

- it does not add external APM or tracing systems
- it does not implement enterprise incident routing
- it does not claim that browser/client errors are fully exhaustive
- it does not replace deeper security hardening or operational monitoring
