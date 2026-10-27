## Tooling, Environment & Mock Observations

### 1. Scaffolding & TypeScript Peer Dependencies
- **Issue:** `npm create vite@latest` scaffolded TypeScript `~7.0.x`, which failed peer-dependency resolution against `typescript-eslint@^8.x` (which restricts peer dependencies to `<6.1.0`).
- **Resolution:** Explicitly pegged TypeScript to `^5.8.0` in `package.json` rather than bypassing resolution with `--force` or `--legacy-peer-deps`. This maintains type-checking integrity and lint compliance.

### 2. MSW Typing, Imports & Peer Dependencies
- **Issue:** In current MSW versions, GraphQL parsing requires the peer dependency `graphql` to be explicitly installed when using GraphQL mocking endpoints, otherwise bundlers fail resolving optional peer stubs like `OperationTypeNode` and `parse`. Additionally, `worker.start()` options standardized on `onUnhandledFrame: 'bypass'` (superseding `onUnhandledRequest`).
- **Resolution:** Installed `graphql` as a dev dependency, imported `graphql` from `msw/graphql`, typed `HttpResponse.json<{ errors: Array<{ message: string }> }>`, and configured `onUnhandledFrame: 'bypass'` in `src/main.tsx` to achieve clean `tsc -b && vite build` compilation without altering runtime mock behavior.

### 3. Schema vs. Mock Handler Divergence
- **`listAvailableActions(stateId: String)` vs `Number(stateId)`:** The schema specifies `stateId` as a `String`, while device states in `DeviceDetail` and `DeviceList` are `Int` (`State { id: Int! }`). The handler casts `Number(variables.stateId)`. At call sites, stringifying `stateId` before transmission avoids silent filter failure.
- **`act-release` Action Name in History:** The handler pushes `actionName: actionId === 'act-lock' ? 'Lock device' : 'Unlock device'` for release actions. Recorded here rather than modifying the provided mock code.
