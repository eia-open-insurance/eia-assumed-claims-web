# eia-assumed-claims-web

- GitHub organization: `eia-open-insurance`
- Repository URL: https://github.com/eia-open-insurance/eia-assumed-claims-web
- Type: Federated front-end
- Deployable: Yes
- Owner: Assumed Claims
- Runtime: React 19 and Webpack 5
- Data store: None
- Depends on: eia-frontend/packages, eia-contracts, eia-platform/gateway

## Purpose

Assumed Claims federated remote: screens, widgets, record tabs, and transaction composition. Assumed claims: loss advices, reserves, cash calls, recoveries, and commutations.

## Responsibilities

- Keep this repository focused on one deployable component or one platform concern.
- Follow the repository standard in `../CONVENTIONS.md` and the specification in `../../SPEC.md`.
- Publish and consume contracts through `eia-contracts`.
- Maintain README, CODEOWNERS, SECURITY, CHANGELOG, tests, and local verification.
- Contain no business logic in shared libraries or front-end remotes.

## Implemented slice

- React 19 workbench exposed as Webpack 5 Module Federation remote `eia_assumed_claims`
  (`./App`), served on port `3005`.
- Async bootstrap (`src/index.jsx` imports `./bootstrap`) so React is resolved as a shared
  singleton.
- Every API request sends `X-EIA-Tenant` and `X-EIA-Book: ASSUMED`; the development server
  proxies `/api` to `http://localhost:8090`.
- Operational assumed-claim page built on the shared EIA design: `eia-page-head` with the
  `Claims · Assumed book` eyebrow and ASSUMED badge, a two-pane `eia-record-layout` register
  and workbench panel, claim header actions, and a six-card `eia-summary-grid` (assigned to,
  current reserve, advised loss, recoveries, cash calls, open tasks).
- `Register assumed claim` is a primary page action that opens a focused modal; the workbench
  no longer keeps an inline create form on the page.
- Record discovery: `?record=<id>` selects the assumed claim (falling back to the common
  `/api/v1/assumed-claims/search` projection and the claim read when the id is not in the
  loaded queue), `?new=1` opens the register modal, and a `popstate` listener keeps the
  workbench in step with shell navigation. `src/navigation.js` pushes history, dispatches
  `PopStateEvent`, and falls back to `location.assign`.
- The claim queue has a prominent client-side filter over claim number, cedent reference,
  status, assignee, and team (including the humanized team label and `Unassigned`), with a
  live match count and a Clear action. Each queue row shows the current owner.
- Claim assignment mirrors the Direct Claims ownership UX: the record header shows
  `Assigned to <adjuster> · <team>` or `Unassigned`, the `Assign` action opens a modal
  pre-filled with the current adjuster and team, and saving sends
  `PATCH /api/v1/assumed-claims/claims/{claimId}/assignment` with `assignedAdjuster`,
  `assignedTeam`, and the observed `expectedVersion` plus the optional `X-EIA-Actor` header.
  The Overview adds an "Assigned to" summary card and a "Claim ownership" context panel.
  A stale version is answered with 409: the modal keeps the typed values, shows the conflict,
  and offers `Reload claim` so the next save uses the refreshed version; a successful assign
  reloads the queue and claim detail (including the assignment audit entry).
- The register form uses the shared `EntityPicker` against
  `/api/v1/contracts/search` with `X-EIA-Book: ASSUMED`; the selected contract shows its
  number and type and links to `/contract?record=<id>`, and the contract id is posted with
  the claim.
- Overview cross-links show the governing assumed contract resolved through
  `GET /api/v1/contracts/<contractId>` on the ASSUMED book as
  `<contractNumber> · <contractType>` (falling back to the short UUID while the lookup is in
  flight or fails) and the cedent reference, a "Why this matters" panel (coverage,
  cessions/recoveries, and SAP FS-RI as the system of record for actual reinsurance), and
  Related records with retrocessions fetched from
  `/api/v1/retrocessions/search?q=<contractId>&limit=5` on the ASSUMED book.
- Workbench tabs (`eia-tabs` / `eia-tab`): Overview, Loss Advice (advice history, accept,
  record advice, bordereau ingest), Reserve History (append-only history plus reserve change),
  Cash Calls, Recoveries, Commutation, Disputes (raise and resolve), and Audit. Claim status
  transitions, close, financial summary, and the audit trail remain available.
- Money is rendered from the API's decimal strings; the UI never treats an amount as a float for
  submission (inputs are sent as decimal strings).
- The canonical `ui.css` and `EntityPicker.jsx` are copied from the shell/ui-kit and loaded
  through `style-loader`/`css-loader`. A small scoped tab-hover guard preserves the shared
  transparent tab treatment against the global `main button:hover` normalization.
- `@swc/core` is pinned to exactly `1.10.7`.
- Thirty-one Playwright tests mock the API statefully: the ASSUMED book wall and operational layout,
  the register modal, loss-advice record/accept, reserve history with the derived current
  reserve, every workbench tab including audit, claim close, URL record discovery (queue and
  search projection), queue filtering (claim facts and assignment), predictive contract
  selection and payload, the Overview cross-links including contract-label resolution and its
  short-UUID fallback, diary tasks and notes, and claim assignment (header/queue/summary
  ownership, prefill and versioned PATCH, owner filtering, and 409 reload-and-retry).

## Local run

```powershell
npm install
npm start        # http://localhost:3005
npm run build
npm test
```

## Verification

- Playwright: `npx playwright test` (31 tests).
- Production bundle: `npm run build`.
- Contract tests
- Security scan and SBOM
- Build and publish

## Notes

No business logic; all actions go through the domain service.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
