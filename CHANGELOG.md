# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

- Repository baseline.
- React 19 Module Federation remote (`./App`) for the Assumed Claims workbench on port 3005, with the ASSUMED book header on API requests and a Playwright test against a mocked API.
- Second slice: claim workbench tabs for loss advice and bordereau ingest, reserve history, cash calls, recoveries, commutation, and disputes, with the existing claim register and create flow preserved. Playwright coverage now includes the loss-advice record/accept flow and the reserve-history/current-reserve flow.

### Changed

- Refactored the workbench to the shared EIA operational record design: page head with book
  badge, two-pane record layout, summary grid, tabbed record panel, canonical form/table/button
  classes, and a modal register action. The canonical `ui.css` is copied into the remote and
  loaded through the Webpack CSS pipeline.

### Added

- Overview, Audit, financial summary, and close-claim actions on the operational page, with
  Playwright coverage for the register modal, every tab, and close.
