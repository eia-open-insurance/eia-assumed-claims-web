# Implementation plan

1. Add `package.json` and the Webpack Module Federation configuration.
2. Implement the remote entry and the exposed application component.
3. Use `eia-frontend/packages` for runtime, UI, and routing primitives.
4. Add Playwright tests for the remote and its transaction flows.
5. Add the remote descriptor to the signed manifest.
6. Add the nginx Docker image and Helm values.
7. Verify the bundle budget and accessibility checks.

## Implemented

- Operational assumed-claim page using the shared EIA design classes: page head and ASSUMED
  badge, two-pane record register/workbench, claim header, summary grid, and tabs for overview,
  loss advice, reserve history, cash calls, recoveries, commutation, disputes, and audit.
- Claim register/create moved into a modal action; close-claim and audit endpoints are wired.
- Record discovery via `?record=` / `?new=1` and `popstate`, with the assumed-claims search
  projection as the deep-link fallback.
- Queue filter plus predictive assumed-contract lookup through the shared `EntityPicker`.
- Claim assignment: owner line in the record header, `Assign` modal with adjuster, team, prefill,
  and a versioned `PATCH .../assignment` (409 reload-and-retry), owner on every queue row and in
  the queue filter, an "Assigned to" summary card, and a "Claim ownership" context panel.
- Overview cross-links resolve the governing contract through
  `GET /api/v1/contracts/{contractId}` (ASSUMED book) and render
  `<contractNumber> · <contractType>` in the record header, Overview, "Why this matters"
  panel, and related records, falling back to the short UUID while the lookup loads or fails.
  Cedent reference, the "Why this matters" panel, and related retrocessions by contract id
  remain.
- Playwright flows for the ASSUMED book wall and layout, register, loss-advice record/accept,
  reserve history, all tabs, close, URL entry, queue filtering, contract selection, contract
  label resolution and fallback, cross-links, diary tasks and notes, and claim assignment
  ownership, versioned PATCH, queue filters, and 409 reload-and-retry.
