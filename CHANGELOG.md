# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

- Repository baseline.
- React 19 Module Federation remote (`./App`) for the Assumed Claims workbench on port 3005, with the ASSUMED book header on API requests and a Playwright test against a mocked API.
- Second slice: claim workbench tabs for loss advice and bordereau ingest, reserve history, cash calls, recoveries, commutation, and disputes, with the existing claim register and create flow preserved. Playwright coverage now includes the loss-advice record/accept flow and the reserve-history/current-reserve flow.
- Record discovery and predictive entry: `?record=` selects a claim (using the common assumed-claims search projection when it is not in the loaded queue), `?new=1` opens the register modal, and a `popstate` listener follows shell navigation.
- Prominent queue filter across claim number, cedent reference, and status with a live count and Clear action.
- Predictive contract lookup in the register modal via the shared `EntityPicker` (`/api/v1/contracts/search`, ASSUMED book), showing the contract number/type and linking to `/contract?record=<id>`.
- Overview cross-links: governing contract, cedent reference, a "Why this matters" panel covering coverage, cessions/recoveries, and SAP FS-RI as the system of record, plus related retrocessions fetched by contract id.
- Cross-link transparency: the selected claim resolves its governing contract through `GET /api/v1/contracts/{contractId}` on the ASSUMED book and renders `<contractNumber> · <contractType>` in the header, Overview, context panel, and related records. The short UUID stays visible while the lookup loads or fails, so record rendering is never blocked.
- Five additional Playwright tests cover URL entry/popstate, search-projection record discovery, queue filtering, contract-picker selection and post payload, and the Overview cross-links (13 total, including contract-label resolution and fallback).
- Claim assignment mirroring Direct Claims: header ownership (`Assigned to <adjuster> · <team>` or `Unassigned`), an `Assign` modal with adjuster text, team select, prefill, and `PATCH /api/v1/assumed-claims/claims/{claimId}/assignment` carrying `expectedVersion` and `X-EIA-Actor`, assignee/team queue rows and search, an `Assigned to` summary card, and a "Claim ownership" context panel. A stale 409 keeps the typed values, explains the conflict, and offers `Reload claim` before the retry.
- Four Playwright assignment tests cover ownership across the header/queue/summary/context panel, the versioned PATCH payload and prefill, assignee/team queue filtering, and the 409 reload-and-retry path (31 tests total).
- Event-derived Activity timeline after Audit: the tab loads `GET /api/v1/events/aggregate/{claimId}?limit=50` with `X-EIA-Tenant` as soon as a claim is selected, renders newest first with a UTC timestamp, readable event label (`assumed.claim.registered` → `Claim registered`), inbox status, event/aggregate version, and payload facts for status, reserve, advice, cash call, recovery, commutation, task/note, and assignment. Loading, empty, and error states are card-local, Refresh re-reads the aggregate, selecting another claim refetches it, and a context note records that activity is event-derived and append-only while the claim record remains the source of truth.
- Six Playwright activity tests cover the aggregate path and tenant header, newest-first rendering with tab order, the card-local empty state and context note, the contained 503 failure, payload facts, and selection refetch (42 tests total).

### Changed

- Refactored the workbench to the shared EIA operational record design: page head with book
  badge, two-pane record layout, summary grid, tabbed record panel, canonical form/table/button
  classes, and a modal register action. The canonical `ui.css` is copied into the remote and
  loaded through the Webpack CSS pipeline.

### Added

- Overview, Audit, financial summary, and close-claim actions on the operational page, with
  Playwright coverage for the register modal, every tab, and close.
