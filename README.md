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
  proxies `/api` to `http://localhost:8090`. There are two platform reads: the event inbox
  (`GET /api/v1/events/aggregate/{claimId}?limit=50`) is tenant-scoped without the ASSUMED
  book wall, and the public `GET /api/v1/directory` people/team directory carries neither
  header. The directory is fetched once when the app starts and reused in memory.
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
  `Assigned to <adjuster> · <team>` or `Unassigned`, and the `Assign` action opens a modal with:
  - an **Assigned adjuster** select built from `GET /api/v1/directory` people, showing each
    person's display name and role; the selected person's role and email are shown underneath;
  - a **Team** select built from the directory `{code,label}` teams, narrowed to the selected
    person's team codes when the directory has routing data and otherwise showing every team;
  - the current `assignedAdjuster` preselected when it matches a directory person (otherwise
    `A. Adjuster`), and the current team when it belongs to that person (otherwise their first
    team).

  Saving sends `PATCH /api/v1/assumed-claims/claims/{claimId}/assignment` with the selected
  displayName, the team code, and the observed `expectedVersion` plus the optional `X-EIA-Actor`
  header. If the directory is unavailable the modal keeps a free-text adjuster input and the
  static assignment team list, and the directory-503 message explains the fallback. The Overview
  adds an "Assigned to" summary card and a "Claim ownership" context panel. A stale version is
  answered with 409: the modal keeps the typed values, shows the conflict, and offers
  `Reload claim` so the next save uses the refreshed version; a successful assign reloads the
  queue and claim detail (including the assignment audit entry).
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
  Cash Calls, Recoveries, Commutation, Disputes (raise and resolve), Audit, Activity, and
  Diary & Notes. Claim status transitions, close, financial summary, and the audit trail remain
  available.
- Activity is an event-derived timeline loaded as soon as a claim is selected from
  `GET /api/v1/events/aggregate/{claimId}?limit=50` (tenant header only). The card renders newest
  first with a UTC timestamp, readable event label (`assumed.claim.registered` → `Claim
  registered`), inbox status, event/aggregate version, and payload facts for status, reserve,
  advice, cash call, recovery, commutation, task/note, and assignment. Loading, empty, and error
  states stay card-local, Refresh re-reads the aggregate, and selecting another claim refetches
  it. A context note states that activity is event-derived and append-only while the assumed
  claim record remains the source of truth.
- The Overview claim Payments card follows Documents and reads
  `GET /api/v1/payments?sourceType=ASSUMED_CLAIM&sourceId=<claimId>` with `X-EIA-Tenant` and
  `X-EIA-Book: ASSUMED`. It accepts a bare array or an `{items:[...]}` page; each row shows the
  payment number linked to `/payment?record=<id>`, status, amount/currency, payee (`payeeName`,
  falling back to `payeePartyId`), and created date, with total paid per currency and the pending
  count. Loading, empty, and 503 error states stay card-local, and a context note records that
  Payment owns approval and execution while the assumed claim holds the loss advice, cash calls,
  and settlement position.
- The Overview adds a **Related notifications** card after **Payments**. It reads
  `GET /api/v1/notifications?sourceType=ASSUMED_CLAIM&sourceId=<claimId>` with `X-EIA-Tenant` and
  no book header (Notifications is a tenant-scoped platform read) and accepts either a bare array
  or an `{items:[...]}` envelope, using `total` for the heading count when present. Rows are kept
  only when `sourceId` names this claim (and, when present, `sourceType` is `ASSUMED_CLAIM`), so
  the shared Notifications service can never surface another record's messages. The heading count
  covers every linked notification and the table shows the newest three by `createdAt`:
  notification number linked to `/notifications?record=<id>`, subject, status, and created date.
  Loading, failure, and empty states stay inside the card and never block or alter the claim; the
  empty state reads **No notifications linked to this claim.** **View all notifications** opens
  the Notifications queue scoped to this claim:
  `/notifications?sourceType=ASSUMED_CLAIM&sourceId=<claimId>`.
- Money is rendered from the API's decimal strings; the UI never treats an amount as a float for
  submission (inputs are sent as decimal strings).
- The canonical `ui.css` and `EntityPicker.jsx` are copied from the shell/ui-kit and loaded
  through `style-loader`/`css-loader`. A small scoped tab-hover guard preserves the shared
  transparent tab treatment against the global `main button:hover` normalization.
- `@swc/core` is pinned to exactly `1.10.7`.
- Sixty Playwright tests mock the API statefully: the ASSUMED book wall and operational layout,
  the register modal, loss-advice record/accept, reserve history with the derived current
  reserve, every workbench tab including audit, claim close, URL record discovery (queue and
  search projection), queue filtering (claim facts and assignment), predictive contract
  selection and payload, the Overview cross-links including contract-label resolution and its
  short-UUID fallback, diary tasks and notes, claim assignment (directory fetch/cache, person
  options with role and email hints, team filtering by person, displayName/team-code submission,
  prefill/default states, owner filtering, 409 reload-and-retry, and the directory-503
  free-text/static-team fallback), the event-derived Activity timeline (aggregate
  path/tenant header, newest-first rendering, card-local empty and 503 states, payload facts,
  and selection refetch), the claim Payments card (the `ASSUMED_CLAIM` source query and
  tenant/book headers, rows with linked payment numbers, payee and created date, paid/pending
  summary, the `{items}` envelope, the empty state, a contained 503 that leaves the claim
  rendered, the loading state before the payment response arrives, and refetch when another
  claim is selected), and the Related notifications card (the `ASSUMED_CLAIM` source query and
  tenant header with no book header, newest-three ordering with the full count, unrelated-record
  exclusion, `/notifications?record=` links, the `{items}` envelope and page total, the empty
  state, a contained 503 that leaves the claim rendered, the loading state before the
  notifications response arrives, the filtered-queue hand-off, and refetch when another claim is
  selected).

## Local run

```powershell
npm install
npm start        # http://localhost:3005
npm run build
npm test
```

## Verification

- Playwright: `npx playwright test` (60 tests).
- Production bundle: `npm run build`.
- Contract tests
- Security scan and SBOM
- Build and publish

## Notes

No business logic; all actions go through the domain service.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
