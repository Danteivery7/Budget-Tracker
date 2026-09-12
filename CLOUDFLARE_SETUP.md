# Budget Tracker — Cloudflare Pages setup

The application backend is designed for Cloudflare Pages Functions + D1. Netlify is not required.

## 1. Pages project

Use production branch `main`, build command `npm run build`, output directory `dist`, and Node.js 22. The generated `dist/_routes.json` sends only `/api/*` through Pages Functions.

## 2. D1

The production D1 database is named `budget-tracker` and is bound as `DB` through `wrangler.jsonc`. Cloudflare may therefore show dashboard binding controls as read-only. That is expected.

The runtime creates its required tables defensively on first use. The canonical schema is `migrations/0001_cloudflare_storage.sql`.

## 3. Secrets

The normal tracker requires:

- `BUDGET_TRACKER_PASSWORD`

Plaid commissioning additionally requires encrypted secrets:

- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_TOKEN_ENCRYPTION_KEY` — fresh 32 random bytes encoded Base64
- `BANK_REFERENCE_KEY` — a second, independent 32-byte Base64 key

Generate each random key locally, separately:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

`PLAID_TOKEN_ENCRYPTION_KEY` encrypts provider tokens, private bank cache, and financial-intelligence settings. `BANK_REFERENCE_KEY` only derives stable opaque account/transaction references and must not be rotated just because the data-encryption key rotates. This separation prevents a future AES key rotation from silently changing rule/reconciliation IDs.

Never commit these values or send them through chat.

### Encryption rotation only

During a planned rotation, temporarily add:

- `PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS` = the old encryption key
- `PLAID_TOKEN_ENCRYPTION_KEY` = the new encryption key

Redeploy, unlock **System Health**, run **Re-encrypt previous-key records**, verify previous-key records reach zero, then remove `PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS` and redeploy. Do not change `BANK_REFERENCE_KEY` during normal encryption rotation.

## 4. Plaid runtime variables

These can wait until Sandbox commissioning:

- `PLAID_ENV=sandbox` initially, later `production`
- `PLAID_TRANSACTION_HISTORY_DAYS=180`
- `PLAID_REDIRECT_URI=https://YOUR_HOST/plaid-oauth.html`
- `PLAID_WEBHOOK_URL=https://YOUR_HOST/api/plaid/webhook`

`SITE_ID=budget-tracker-cloudflare` is already fixed in `wrangler.jsonc`.

## 5. Passkeys

When the existing Pages hostname is permanent, no extra passkey variables are required. WebAuthn derives the exact HTTPS origin/RP hostname from the production request. Optional `PASSKEY_RP_ID` and `PASSKEY_ORIGIN` overrides remain supported for a future custom-domain migration.

Register Face ID / Touch ID / Windows Hello from **Security & Audit**. The password remains the recovery fallback and registered passkeys can also satisfy the separate 15-minute banking re-authentication.

## 6. Automatic day rollover

The frontend watches local midnight and reloads authoritative state just after the date changes. It also re-checks on page restore, focus, background return, and reconnect so sleeping devices cannot stay stuck on yesterday.

## 7. System Health & commissioning

The **System Health** workspace provides:

- D1/auth/passkey/ledger/encryption/Plaid/classification health;
- deterministic synthetic finance stress testing;
- protected Plaid Sandbox commissioning controls;
- browser-encrypted recovery export/import;
- bank-encryption key-rotation status and execution.

Protected operations require the same separate 15-minute banking session used for private balances.

Plaid Sandbox controls remain disabled until all Sandbox credentials, AES encryption, and `BANK_REFERENCE_KEY` are configured. They are unavailable when `PLAID_ENV=production`.

## 8. Recovery

System Health exports the logical D1 application records and encrypts the recovery file in the browser with a user-supplied passphrase using PBKDF2-SHA256 + AES-256-GCM. The recovery passphrase never reaches the server.

The package deliberately does not contain Cloudflare/Plaid secrets or the bank-encryption key. Store those separately in a secure secrets/password manager.

Cloudflare D1 Time Travel remains the second recovery layer for point-in-time database rollback. The application recovery import is merge/upsert based, which is safer for portable disaster recovery; use D1 Time Travel for destructive rollback to an exact earlier database state.

## 9. Plaid commissioning

Start with Sandbox. System Health can create a dynamic Transactions Sandbox Item using Plaid's supported Link-bypass test endpoint, sync through the encrypted production code path, seed custom Sandbox activity, and fire a `SYNC_UPDATES_AVAILABLE` webhook. The browser never receives Plaid access tokens/provider IDs.

Do not switch to Production until the synthetic suite and Sandbox flow are green and Review Inbox/subscription behavior has been inspected.

The integration requests Transactions only. It does not request Plaid Auth/account-and-routing credentials, Identity, Transfer, ACH, or money-moving capabilities.

## 10. Real-money activation gate

Raw bank transactions still do not automatically mutate daily discretionary spending. Keep the first real connection read-only, observe classifications, recurring charges, card settlements, internal transfers, and refunds, then enable a future idempotent economic-impact pipeline only after the data is proven.

See `PRE_MONEY_COMMISSIONING.md` for the complete gate plan and the data-dependent features intentionally deferred until real history exists.

## 11. Verification

```bash
npm install
npm run verify
```

`npm run verify` runs finance/security tests, the pre-money stress fixture, syntax checks, the static build, and a real Cloudflare Pages Functions bundle with Wrangler.
