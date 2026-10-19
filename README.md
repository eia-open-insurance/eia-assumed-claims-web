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
- Lists assumed claims, creates a claim through the domain service, and displays structured
  validation errors returned by the domain.
- Record workbench tabs for the ASSUMED claim: Loss advice (advice history, accept, record advice,
  bordereau batch ingest), Reserve history (append-only history plus a reserve-change form),
  Cash calls, Recoveries, Commutation, and Disputes (raise and resolve). The claim status action
  remains available from the workbench.
- Money is rendered from the API's decimal strings; the UI never treats an amount as a float for
  submission (inputs are sent as decimal strings).
- `@swc/core` is pinned to exactly `1.10.7`.
- Three Playwright tests mock the API statefully: the claim register and ASSUMED book header, the
  loss-advice record/accept flow, and the reserve-history flow with the derived current reserve.

## Local run

```powershell
npm install
npm start        # http://localhost:3005
npm run build
npm test
```

## Verification

- Playwright: `npx playwright test` (3 tests).
- Production bundle: `npm run build`.
- Contract tests
- Security scan and SBOM
- Build and publish

## Notes

No business logic; all actions go through the domain service.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
