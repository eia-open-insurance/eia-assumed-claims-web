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
- Claim assignment: owner line in the record header, `Assign` modal with an adjuster select
  from the shared `GET /api/v1/directory` people (display name plus role and a role/email hint),
  a team select narrowed to the selected person's team codes, current/default prefill, and a
  versioned `PATCH .../assignment` (409 reload-and-retry) that sends the selected displayName,
  team code, and `expectedVersion`; a directory 503 falls back to free-text adjuster entry and
  the static team list. Owner appears on every queue row and in the queue filter, with an
  "Assigned to" summary card and a "Claim ownership" context panel.
- Event-derived Activity tab after Audit: selection loads
  `GET /api/v1/events/aggregate/{claimId}?limit=50` with `X-EIA-Tenant` (no book wall), renders
  newest first with a UTC timestamp, readable event label, inbox status, event/aggregate version,
  and payload facts for status, reserve, advice, cash call, recovery, commutation, task/note, and
  assignment. Loading, empty, and 503 error states stay card-local, Refresh re-reads the
  aggregate, selecting another claim refetches it, and a context note explains that activity is
  event-derived and append-only while the claim record remains the source of truth.
- Overview cross-links resolve the governing contract through
  `GET /api/v1/contracts/{contractId}` (ASSUMED book) and render
  `<contractNumber> · <contractType>` in the record header, Overview, "Why this matters"
  panel, and related records, falling back to the short UUID while the lookup loads or fails.
  Cedent reference, the "Why this matters" panel, and related retrocessions by contract id
  remain.
- Commutation release document picker over `GET /api/v1/documents/search?q=<term>&limit=8`
  (tenant header only) that searches by document number or title and stores the selected
  document id/number in the form. The selection links to `/document?record=<id>`, a missing
  selection blocks execution with an inline error, and `POST .../commute` still sends only the
  required `releaseDocumentId` UUID. Existing commutations hydrate the document number/title
  through `GET /api/v1/documents/{id}` (short-id fallback on failure), and the tab explains that
  the release is a Document service record.
- Playwright flows for the ASSUMED book wall and layout, register, loss-advice record/accept,
  reserve history, all tabs, close, URL entry, queue filtering, contract selection, contract
  label resolution and fallback, cross-links, diary tasks and notes, claim assignment
  ownership, versioned PATCH, queue filters, 409 reload-and-retry, the event-derived Activity
  timeline (aggregate path/header, order, empty, contained 503, payload facts, and selection
  refetch), and the Commutation release document picker (search request, selection label/link,
  posted `releaseDocumentId`, hydrated label/link, short-id fallback, and required validation).
