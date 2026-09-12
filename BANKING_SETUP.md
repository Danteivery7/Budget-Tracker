# Secure Plaid banking setup

Budget Tracker's linked-account layer is deliberately read-only and separate from normal budget state.

## What the integration requests

- Plaid `transactions` only.
- No Plaid Auth product.
- No routing/account-number retrieval.
- No Identity product.
- No Transfer or payment-initiation capability.
- No ability to move money.

Bank credentials are entered only in Plaid Link / the institution OAuth flow. Budget Tracker never receives or stores them.

## Private storage model

- Plaid access tokens live only in the server-side `budget-tracker-bank-vault` Netlify Blob store.
- The entire vault is AES-256-GCM encrypted before storage.
- Normalized bank transactions live only in the separate `budget-tracker-bank-data` Blob store and are also AES-256-GCM encrypted before storage.
- The browser never receives access tokens, Plaid Item IDs, Plaid account IDs, or Plaid transaction IDs.
- Browser-facing account/transaction references are opaque HMAC-derived IDs.
- The normal budget state receives only recurring-charge candidates and a small feed summary.
- Recent bank activity is fetched only after a separate 15-minute banking re-auth and is kept in page memory only.

## 1. Create/configure Plaid

Create a Plaid Dashboard account and begin with Sandbox. Enable/use the Transactions product for this app.

Plaid currently supports `sandbox` and `production` API environments. Budget Tracker intentionally rejects the retired `development` value.

For mobile-web OAuth support, add this exact HTTPS URL to Plaid Dashboard > Allowed redirect URIs:

`https://YOUR-SITE/plaid-oauth.html`

Use the actual Netlify custom/site domain. Do not add query parameters.

## 2. Create the encryption key locally

Generate a fresh 32-byte random key. Do not reuse the site password or a Plaid secret.

With Node installed:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copy the output directly into Netlify as `PLAID_TOKEN_ENCRYPTION_KEY`. Do not commit it and do not paste it into ChatGPT.

If this key is lost or changed after accounts are connected, existing encrypted bank-vault data cannot be decrypted. Store it in a secure password manager or secrets vault.

## 3. Add Netlify environment variables

Required:

- `PLAID_CLIENT_ID` = Plaid Dashboard client ID
- `PLAID_SECRET` = the matching Sandbox or Production secret
- `PLAID_ENV` = `sandbox` initially; later `production`
- `PLAID_TOKEN_ENCRYPTION_KEY` = the 32-byte Base64 value generated above

Recommended:

- `PLAID_TRANSACTION_HISTORY_DAYS` = `180` by default. Allowed range is 30–730. The same value controls the private encrypted cache retention window.
- `PLAID_REDIRECT_URI` = `https://YOUR-SITE/plaid-oauth.html` after that exact URL is allow-listed in Plaid.

Optional:

- `PLAID_WEBHOOK_URL` = `https://YOUR-SITE/api/plaid/webhook`. If omitted, Budget Tracker derives this from the request origin.
- `PLAID_API_VERSION` = leave unset to use the pinned application default unless a deliberate migration is being performed.

Redeploy after adding/changing Netlify environment variables.

## 4. Sandbox verification

1. Sign in to Budget Tracker.
2. Open **Linked Accounts**.
3. Re-enter the Budget Tracker access code. This creates a separately signed banking session that expires server-side after 15 minutes.
4. Select **Connect financial account**.
5. Complete Plaid Link using a Sandbox institution/test credentials.
6. Confirm that the account summary appears and **Recent activity** loads.
7. Confirm the Subscriptions workspace receives recurring candidates after enough repeating test transactions exist.
8. Test **Disconnect**. It calls Plaid `/item/remove`, deletes the encrypted local bank cache, and stops future sync.

Do not switch to Production until this entire flow works in Sandbox.

## 5. Production

After Plaid Production access is enabled, change `PLAID_ENV` to `production` and replace `PLAID_SECRET` with the Production secret. Keep the existing encryption key unless intentionally starting a completely new encrypted bank vault.

Connect only accounts you want Budget Tracker to read. Institution OAuth/consent determines the actual accounts and permissions shared.

## Security behavior

- Banking POST requests require same-origin checks in addition to SameSite cookies.
- Bank balances and activity require the normal app login plus a separate short-lived bank session.
- Plaid webhooks are accepted only after ES256 JWT verification, a five-minute freshness check, and timing-safe SHA-256 request-body verification.
- Link is loaded directly from Plaid's official CDN and is restricted by Content Security Policy.
- Raw linked-bank transactions do **not** automatically alter daily discretionary spending. They currently feed read-only account views and recurring-charge discovery. Automatic income/transfer/card-payment classification must be explicit before it is allowed to mutate budget math.
