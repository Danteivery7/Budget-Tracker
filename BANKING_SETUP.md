# Secure Plaid banking setup on Cloudflare

Budget Tracker's linked-account layer is read-only and separate from normal budget state. The application runs on Cloudflare Pages Functions + D1.

## Scope

The integration requests Plaid `transactions` only. It does not request Auth/account-and-routing credentials, Identity, Transfer, ACH, or money-moving permissions. Bank credentials stay inside Plaid Link / institution OAuth and never pass through Budget Tracker.

## Private storage model

- Plaid access tokens live only in an AES-256-GCM encrypted server-side vault in D1.
- Normalized bank transactions live in a separate AES-256-GCM encrypted D1 namespace.
- Financial rules/manual decisions are stored in the same encrypted banking boundary.
- The browser never receives access tokens, Item IDs, Plaid account IDs, or Plaid transaction IDs.
- Browser-facing account/transaction references are opaque HMAC-derived IDs.
- Raw linked-bank transactions do not automatically alter daily spending.
- Balances/activity require the separate 15-minute banking re-authentication.

## Required encrypted secrets for banking

Add these in Cloudflare Pages → Settings → Variables and Secrets:

- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_TOKEN_ENCRYPTION_KEY`
- `BANK_REFERENCE_KEY`

Generate the two application keys independently as fresh random 32-byte Base64 values:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

`PLAID_TOKEN_ENCRYPTION_KEY` protects ciphertext and is designed to rotate. `BANK_REFERENCE_KEY` keeps opaque account/transaction identifiers stable across encryption-key rotations. Do not rotate `BANK_REFERENCE_KEY` during normal AES key rotation.

Do not commit or share any secret value.

## Runtime variables

- `PLAID_ENV=sandbox` initially, later `production`
- `PLAID_TRANSACTION_HISTORY_DAYS=180`
- `PLAID_REDIRECT_URI=https://YOUR-HOST/plaid-oauth.html`
- `PLAID_WEBHOOK_URL=https://YOUR-HOST/api/plaid/webhook`

Passkey overrides are optional when the permanent Cloudflare Pages hostname is used.

## Sandbox commissioning

Use **System Health** for the controlled commissioning flow. When Sandbox is fully configured it can:

1. create a dynamic Plaid Transactions Sandbox Item using Plaid's supported Link-bypass endpoint;
2. perform the initial `/transactions/sync` through the same encrypted vault/cache path used by Production;
3. create custom Sandbox transactions and sync them;
4. fire a `SYNC_UPDATES_AVAILABLE` Sandbox webhook;
5. expose health/reconciliation/review counts without exposing provider tokens to the browser.

The deterministic synthetic stress test should also be green before relying on Sandbox results.

Do not switch to Production until recurring discovery, Review Inbox, card-payment settlement, transfer, refund, webhook, and disconnect behavior have all been inspected.

## Encryption-key rotation

Never replace the only encryption key after data exists. Instead:

1. generate a new key;
2. set the new value as `PLAID_TOKEN_ENCRYPTION_KEY`;
3. temporarily set the old value as `PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS`;
4. redeploy;
5. open **System Health** and run the protected re-encryption action;
6. confirm previous-key records are zero and unreadable records are zero;
7. remove `PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS` and redeploy.

The backend can decrypt with current-or-previous during the transition but always writes new ciphertext with the current key.

## Recovery

System Health can export logical D1 application state. The browser encrypts that export using a user-chosen recovery passphrase before download. The recovery passphrase never reaches the server, and the file never contains Plaid/Cloudflare secrets or the AES encryption key.

Cloudflare D1 Time Travel is the preferred exact point-in-time rollback layer; the portable recovery file is a disaster-recovery/merge layer.

## Security behavior

- same-origin validation for sensitive POSTs;
- HttpOnly/Secure/SameSite cookies;
- separate 15-minute protected banking session;
- ES256 Plaid webhook JWT verification plus request-body hash/freshness checks;
- D1-backed rate limiting with keyed IP hashes;
- append-only tamper-evident audit chain;
- automatic banking lock and in-memory clearing of private browser activity.
