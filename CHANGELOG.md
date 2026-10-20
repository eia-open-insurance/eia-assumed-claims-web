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
- Five additional Playwright tests cover URL entry/popstate, search-projection record discovery, queue filtering, contract-picker selection and post payload, and the Overview cross-links (11 total).

### Changed

- Refactored the workbench to the shared EIA operational record design: page head with book
  badge, two-pane record layout, summary grid, tabbed record panel, canonical form/table/button
  classes, and a modal register action. The canonical `ui.css` is copied into the remote and
  loaded through the Webpack CSS pipeline.

### Added

- Overview, Audit, financial summary, and close-claim actions on the operational page, with
  Playwright coverage for the register modal, every tab, and close.
