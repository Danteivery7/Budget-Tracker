# Secure Plaid banking setup on Cloudflare

Budget Tracker's linked-account layer is read-only and separate from normal budget state. The application is hosted with Cloudflare Pages Functions + D1; Netlify is not required.

For the complete hosting checklist, start with `CLOUDFLARE_SETUP.md`.

## What the integration requests

- Plaid `transactions` only.
- No Plaid Auth product.
- No routing/account-number retrieval.
- No Identity product.
- No Transfer or payment-initiation capability.
- No ability to move money.

Bank credentials are entered only in Plaid Link / the institution OAuth flow. Budget Tracker never receives or stores them.

## Private storage model

- Plaid access tokens are stored only in the server-side encrypted bank vault in Cloudflare D1.
- The entire vault is AES-256-GCM encrypted before D1 receives it.
- Normalized bank transactions live in a separate encrypted namespace in D1 and are also AES-256-GCM encrypted before storage.
- The browser never receives access tokens, Plaid Item IDs, Plaid account IDs, or Plaid transaction IDs.
- Browser-facing account/transaction references are opaque HMAC-derived IDs.
- The normal budget state receives only recurring-charge candidates and small derived summaries.
- Recent bank activity requires the separate 15-minute banking re-authentication and is kept in page memory only.

## Cloudflare secrets

Add these in Cloudflare Pages → Settings → Variables and Secrets as encrypted secrets:

- `BUDGET_TRACKER_PASSWORD`
- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_TOKEN_ENCRYPTION_KEY`

Generate `PLAID_TOKEN_ENCRYPTION_KEY` locally as a fresh random 32-byte Base64 value:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Do not commit or share that value. If it is changed after live accounts are connected, the previous encrypted bank vault cannot be decrypted.

## Normal variables

- `PLAID_ENV` = `sandbox` initially, later `production`
- `PLAID_TRANSACTION_HISTORY_DAYS` = `180`
- `PLAID_REDIRECT_URI` = `https://YOUR-HOST/plaid-oauth.html`
- `PLAID_WEBHOOK_URL` = `https://YOUR-HOST/api/plaid/webhook`
- `PASSKEY_RP_ID` = your final production hostname
- `PASSKEY_ORIGIN` = the exact HTTPS production origin

## D1

Bind the Cloudflare D1 database to the Pages project as `DB`. The app initializes the required tables defensively, and the canonical schema is also committed at `migrations/0001_cloudflare_storage.sql`.

## Sandbox verification

1. Sign in to Budget Tracker.
2. Open **Linked Accounts**.
3. Re-enter the Budget Tracker access code or use a registered passkey. This creates a separately signed 15-minute banking session.
4. Select **Connect financial account**.
5. Complete Plaid Link using Sandbox.
6. Confirm account summaries and **Recent activity** load.
7. Confirm recurring-charge discovery and the Review Inbox receive expected test activity.
8. Test **Disconnect** and confirm the connection and encrypted local bank cache are removed.

Do not switch to Plaid Production until the complete Sandbox flow succeeds.

## Security behavior

- Banking POST requests require same-origin checks in addition to SameSite cookies.
- Bank balances and activity require the normal app login plus a separate short-lived banking session.
- Plaid webhooks require ES256 JWT verification, freshness validation, and timing-safe SHA-256 request-body verification.
- Link is loaded directly from Plaid's official CDN and is restricted by Content Security Policy.
- Raw linked-bank transactions remain separate from the normal budget state.
- D1-based API rate limiting stores only keyed hashes of source IP addresses, never raw IP values.
