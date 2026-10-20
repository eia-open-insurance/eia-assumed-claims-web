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
- Playwright flows for the ASSUMED book wall and layout, register, loss-advice record/accept,
  reserve history, all tabs, and close.
