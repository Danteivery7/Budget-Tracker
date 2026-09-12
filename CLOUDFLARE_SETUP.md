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

The production D1 binding is managed through `wrangler.jsonc`, so Cloudflare may show the dashboard binding controls as read-only. That is expected.

The runtime creates its required tables defensively on first use. The canonical schema is also committed at:

`migrations/0001_cloudflare_storage.sql`

The D1 store preserves the optimistic/versioned writes previously used by the app, including the budget state, encrypted Plaid vault, encrypted bank cache, passkeys, intelligence rules, and tamper-evident ledger.

## 3. Add encrypted secrets

In Cloudflare Pages → Settings → Variables and Secrets, add `BUDGET_TRACKER_PASSWORD` as an encrypted secret.

Plaid secrets can remain unset until banking commissioning begins. At that stage add these as encrypted secrets:

- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_TOKEN_ENCRYPTION_KEY`

`PLAID_TOKEN_ENCRYPTION_KEY` must be a fresh 32-byte random value encoded as Base64. Do not commit it, paste it into the website, or send it through chat.

A local example command for generating one is:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

## 4. Add normal runtime variables for Plaid when ready

These can wait until Plaid Sandbox commissioning:

- `PLAID_ENV` = `sandbox` while testing, later `production`
- `PLAID_TRANSACTION_HISTORY_DAYS` = `180`
- `PLAID_REDIRECT_URI` = `https://YOUR_HOST/plaid-oauth.html`
- `PLAID_WEBHOOK_URL` = `https://YOUR_HOST/api/plaid/webhook`

`SITE_ID` is already set to `budget-tracker-cloudflare` in `wrangler.jsonc` so cryptographic identity remains stable across deployments.

## 5. Passkeys

If the permanent production hostname is the existing Cloudflare Pages hostname, no additional passkey environment variables are required. The WebAuthn backend derives the exact HTTPS origin and relying-party hostname from the production request, so a credential registered from that site is scoped to that hostname automatically.

Optional `PASSKEY_RP_ID` and `PASSKEY_ORIGIN` overrides remain supported for a future custom-domain migration, but they are not required for the permanent Pages hostname.

Register Face ID / Touch ID / Windows Hello passkeys from **Security & Audit** on the permanent production site. The UI shows the hostname the passkey will belong to and proposes a device-appropriate label that can be edited before registration.

The password remains available as a recovery/fallback path. A registered passkey can also satisfy the separate 15-minute banking re-authentication.

## 6. Automatic day rollover

The production frontend watches the local calendar boundary. Just after local midnight it reloads the authoritative budget state so Today, fiscal-cycle calculations, daily allowance, and the date label advance without manual action. It also re-checks the date when the page is restored, focused, brought back from the background, or comes back online, covering phones and computers that were asleep at midnight.

## 7. Plaid

Start with Plaid Sandbox. After the Pages deployment and final hostname are stable:

1. Add the exact OAuth redirect URI in Plaid.
2. Add the exact webhook URL in Plaid.
3. Verify Sandbox linking and transaction sync.
4. Change `PLAID_ENV` and credentials to Production only when ready to connect real institutions.

The Budget Tracker requests the Transactions product only. It does not request Auth/account-and-routing credentials, Identity, Transfer, ACH, or money-moving capabilities.

## 8. Security model after migration

- Static frontend assets are built into `dist`; server modules are not published as static files.
- API requests execute in Cloudflare Pages Functions.
- Persistent application state uses Cloudflare D1.
- Plaid access tokens and raw bank cache remain AES-256-GCM encrypted at the application layer before D1 storage.
- API rate limiting uses D1 and stores only a keyed hash of the connecting IP, never the raw IP.
- API responses are `no-store` and receive security headers directly from the Pages Function.
- Static responses use the committed `_headers` policy.
- Financial ledger entries remain append-only/tamper-evident with hash-chain verification.

## 9. Local verification

```bash
npm install
npm run verify
```

`npm run verify` runs all existing tests, syntax checks, the static build, and a real Cloudflare Pages Functions bundle with Wrangler.

For local Pages execution, create `.dev.vars` for local-only secrets and never commit it. Then bind a local/remote D1 database named `DB` and run Wrangler Pages development.
