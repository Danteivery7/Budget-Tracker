# Budget Tracker — Cloudflare Pages setup

The application backend is designed for Cloudflare Pages Functions + D1. Netlify is not required.

## 1. Create the Pages project

Connect `Danteivery7/Budget-Tracker` to Cloudflare Pages.

Use:

- Production branch: `main`
- Build command: `npm run build`
- Build output directory: `dist`
- Node.js: 22

The repository `functions/` directory provides the Pages Functions API. The generated `dist/_routes.json` limits Function invocations to `/api/*`, so normal static assets remain static requests.

## 2. Create and bind D1

Create one D1 database named `budget-tracker` and bind it to the Pages project with the binding name:

`DB`

Add the binding to Production and Preview if preview branches should have a working backend. For maximum isolation, use a separate preview D1 database.

The runtime creates its required tables defensively on first use. The canonical schema is also committed at:

`migrations/0001_cloudflare_storage.sql`

The D1 store preserves the optimistic/versioned writes previously used by the app, including the budget state, encrypted Plaid vault, encrypted bank cache, passkeys, intelligence rules, and tamper-evident ledger.

## 3. Add encrypted secrets

In Cloudflare Pages → Settings → Variables and Secrets, add these as encrypted secrets:

- `BUDGET_TRACKER_PASSWORD`
- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_TOKEN_ENCRYPTION_KEY`

`PLAID_TOKEN_ENCRYPTION_KEY` must be a fresh 32-byte random value encoded as Base64. Do not commit it, paste it into the website, or send it through chat.

A local example command for generating one is:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

## 4. Add normal runtime variables

Set these as normal Cloudflare variables as appropriate:

- `PLAID_ENV` = `sandbox` while testing, later `production`
- `PLAID_TRANSACTION_HISTORY_DAYS` = `180`
- `PASSKEY_RP_ID` = your production hostname only, such as `budget.example.com`
- `PASSKEY_ORIGIN` = the exact HTTPS production origin, such as `https://budget.example.com`
- `PLAID_REDIRECT_URI` = `https://YOUR_HOST/plaid-oauth.html`
- `PLAID_WEBHOOK_URL` = `https://YOUR_HOST/api/plaid/webhook`

`SITE_ID` is already set to `budget-tracker-cloudflare` in `wrangler.jsonc` so cryptographic identity remains stable across deployments.

## 5. Passkeys

Register permanent Face ID / Touch ID / Windows Hello passkeys only on the final production hostname. WebAuthn credentials are scoped to the relying-party domain.

The password remains available as a recovery/fallback path. A registered passkey can also satisfy the separate 15-minute banking re-authentication.

## 6. Plaid

Start with Plaid Sandbox. After the Pages deployment and final hostname are stable:

1. Add the exact OAuth redirect URI in Plaid.
2. Add the exact webhook URL in Plaid.
3. Verify Sandbox linking and transaction sync.
4. Change `PLAID_ENV` and credentials to Production only when ready to connect real institutions.

The Budget Tracker requests the Transactions product only. It does not request Auth/account-and-routing credentials, Identity, Transfer, ACH, or money-moving capabilities.

## 7. Security model after migration

- Static frontend assets are built into `dist`; server modules are not published as static files.
- API requests execute in Cloudflare Pages Functions.
- Persistent application state uses Cloudflare D1.
- Plaid access tokens and raw bank cache remain AES-256-GCM encrypted at the application layer before D1 storage.
- API rate limiting uses D1 and stores only a keyed hash of the connecting IP, never the raw IP.
- API responses are `no-store` and receive security headers directly from the Pages Function.
- Static responses use the committed `_headers` policy.
- Financial ledger entries remain append-only/tamper-evident with hash-chain verification.

## 8. Local verification

```bash
npm install
npm run verify
```

`npm run verify` runs all existing tests, syntax checks, the static build, and a real Cloudflare Pages Functions bundle with Wrangler.

For local Pages execution, create `.dev.vars` for local-only secrets and never commit it. Then bind a local/remote D1 database named `DB` and run Wrangler Pages development.
