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
- `@swc/core` is pinned to exactly `1.10.7`.
- One Playwright test mocks the API, verifies the workbench renders, and asserts the ASSUMED
  book header is sent.

## Local run

```powershell
npm install
npm start        # http://localhost:3005
npm run build
npm test
```

## Verification

- Lint and format
- Unit tests with 100% business-logic coverage where applicable
- Contract tests
- Integration or Playwright tests where applicable
- Security scan and SBOM
- Build and publish

## Notes

No business logic; all actions go through the domain service.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
