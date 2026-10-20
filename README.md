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
  and workbench panel, claim header actions, and a four-card `eia-summary-grid` (current
  reserve, advised loss, recoveries, cash calls).
- `Register assumed claim` is a primary page action that opens a focused modal; the workbench
  no longer keeps an inline create form on the page.
- Workbench tabs (`eia-tabs` / `eia-tab`): Overview, Loss Advice (advice history, accept,
  record advice, bordereau ingest), Reserve History (append-only history plus reserve change),
  Cash Calls, Recoveries, Commutation, Disputes (raise and resolve), and Audit. Claim status
  transitions, close, financial summary, and the audit trail remain available.
- Money is rendered from the API's decimal strings; the UI never treats an amount as a float for
  submission (inputs are sent as decimal strings).
- The canonical `ui.css` is copied from the shell and loaded through `style-loader`/`css-loader`.
  A small scoped tab-hover guard preserves the shared transparent tab treatment against the
  global `main button:hover` normalization.
- `@swc/core` is pinned to exactly `1.10.7`.
- Six Playwright tests mock the API statefully: the ASSUMED book wall and operational layout,
  the register modal, loss-advice record/accept, reserve history with the derived current
  reserve, every workbench tab including audit, and claim close.

## Local run

```powershell
npm install
npm start        # http://localhost:3005
npm run build
npm test
```

## Verification

- Playwright: `npx playwright test` (6 tests).
- Production bundle: `npm run build`.
- Contract tests
- Security scan and SBOM
- Build and publish

## Notes

No business logic; all actions go through the domain service.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
