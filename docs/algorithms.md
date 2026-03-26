# Algorithms and Non-Obvious Flows

## ULDA state progression in `packages/ulda-sign`

The implementation stores ULDA state as an encoded package containing:

- header information
- current index
- block sequence

The two most important public operations are:

1. `New(index)` creates a fresh origin package with random blocks.
2. `stepUp(pkg)` removes the oldest block, appends a new random block, and increments the package index.

This means the package evolves forward over time instead of being reused unchanged.

## Signing flow

`sign(pkg)` performs these high-level steps:

1. import the serialized origin package
2. derive the block list and metadata
3. compute the signature ladder according to the configured mode
4. pack the resulting signature bytes back into the configured export format

The code currently supports:

- `S` mode
- `X` mode

## Verification flow

`verify(a, b)` imports both signatures, checks shared metadata compatibility, and then dispatches to:

- `VerifyS`
- `VerifyX`

### `S` mode behavior

The implementation accepts a forward gap smaller than `N`.

That is why tests include cases where:

- adjacent signatures verify successfully
- non-adjacent signatures may still verify when the gap is valid

### `X` mode behavior

The implementation requires a single forward step between the compared signatures.

That is why tests check:

- adjacent transitions succeed
- non-adjacent transitions fail

## Encrypted record flow in `packages/ulda-front`

`UldaFront` models data as:

- one master document
- many content documents

The master document stores:

- current `originPkg`
- links to content records
- a top-level projection of logical data

Each content document stores:

- its own `originPkg`
- logical data payload

## Update flow in `UldaFront`

When `update()` flushes pending changes, the code:

1. creates missing content records
2. updates changed content records
3. deletes scheduled content records
4. advances the master document state
5. writes the updated encrypted master envelope

The important non-obvious detail is that content and master records each maintain forward ULDA state independently.

## Server-side verification flow

In the demo backends the essential rule is:

- update/delete is accepted only if the new ULDA key verifies against the stored key

This is the repository’s practical demonstration of forward-only state authorization.

The server does not attempt to reconstruct the client-side secret state. It only checks whether the presented next key is a valid cryptographic extension of the previous one.

## Why tests count as living documentation

The following tests demonstrate algorithm behavior in executable form:

- `packages/ulda-sign/tests/ulda-sign.test.mjs`
- `packages/ulda-front/tests/ulda-front.test.mjs`

They are especially useful for:

- adjacent vs non-adjacent verification
- stale-signature rejection
- adapter-backed create/connect/update/delete flows
