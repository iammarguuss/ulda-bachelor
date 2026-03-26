# Component Interactions

## Main interaction chain

The core interaction path in this repository is:

1. `packages/ulda-sign`
2. `packages/ulda-front`
3. application server or demo application

In other words:

- `ulda-sign` defines low-level state/signature behavior
- `ulda-front` consumes that behavior to manage encrypted logical records
- demo servers/apps expose that flow over HTTP or Socket.IO

## `ulda-sign` -> server interaction

The server modules create a `UldaSign` verifier instance and use it to validate that:

- the stored ULDA key
- and the incoming next ULDA key

form a valid forward transition.

This interaction is visible in:

- `applications/ulda-crud/src/server.js`
- `applications/example-password-keeper/src/server.js`
- `applications/max_speed_test_server/src/server.js`

## `ulda-sign` -> `ulda-front` interaction

`ulda-front` uses `UldaSign` indirectly through adapter-oriented helper flows:

- `createInitialOrigin`
- `stepUpAndSign`

That means `ulda-front` does not re-implement the signing logic itself. Instead, it depends on ULDA package progression and signature creation provided by the lower-level layer.

## `ulda-front` -> application interaction

Applications that use `UldaFront` work with:

- a logical proxy object `client.data`
- adapter-based transport
- encrypted master/content envelopes

The application layer mutates logical fields, while `UldaFront` decides how those changes map to:

- record creation
- record updates
- record deletion
- master document synchronization

## REST interaction pattern

For REST-based flows:

- client adapter builds JSON requests
- server receives encoded `ulda_key` and `content`
- server verifies the ULDA transition
- server stores the new key and content

## Socket.IO interaction pattern

For Socket.IO-based flows:

- client adapter sends event/payload/callback requests
- server maps events such as `create`, `read`, `update`, `delete`
- server responds with the same logical verification result shape used by the REST demo flow

## Documentation interaction model

There are also interactions between documentation layers:

- source JSDoc documents public APIs
- markdown docs explain architecture and non-obvious flows
- generated HTML makes the code docs browsable
- tests serve as executable usage examples
