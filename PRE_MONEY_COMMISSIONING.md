# Budget Tracker — Pre-Money Commissioning Plan

This document defines the final commissioning gate before Budget Tracker is trusted with real financial activity.

## Objectives

1. Prove the finance intelligence engine does not double-count transfers, card payments, refunds, or pending transactions.
2. Make Plaid Sandbox testing repeatable without exposing provider secrets or access tokens to the browser.
3. Surface one health dashboard for D1, authentication, passkeys, ledger integrity, Plaid readiness, encrypted banking state, classification coverage, and recovery readiness.
4. Make disaster recovery practical before the database contains meaningful history.
5. Allow AES-256-GCM banking encryption keys to be rotated without disconnecting linked accounts.
6. Keep real-money mutation disabled until transaction classification/reconciliation has been observed against real data.

## Commissioning gates

### Gate A — Local / CI synthetic finance stress test

The deterministic fixture verifies payroll/income, checking-to-card settlements, owned-account transfers, refunds, recurring charges, pending activity, ambiguous purchases, and manual-review precedence. It runs in CI and can also be executed from the deployed System Health page.

### Gate B — Plaid Sandbox

When `PLAID_ENV=sandbox` and the Plaid/encryption secrets exist, System Health exposes Sandbox-only commissioning controls. They are unavailable in Production.

Recommended flow:

1. Create a dynamic Transactions Sandbox Item without automating the Link UI.
2. Sync its history through the same encrypted vault and `/transactions/sync` path used by production.
3. Create custom Sandbox transactions and sync again.
4. Fire `SYNC_UPDATES_AVAILABLE` and confirm the public webhook is accepted.
5. Inspect subscription discovery, reconciliation health, and Review Inbox.
6. Disconnect and verify the encrypted local cache is purged.

### Gate C — Recovery

Before real financial history is stored:

1. Export a recovery package from System Health.
2. Protect it locally with a recovery passphrase. The passphrase never goes to the server.
3. Verify the package can be decrypted in-browser and dry-run validated.
4. Keep Cloudflare D1 Time Travel as a second recovery layer.

The recovery package contains application state and already-encrypted bank records. It deliberately does not contain Cloudflare/Plaid secrets or the bank encryption key.

### Gate D — Encryption key rotation

Rotation uses two Cloudflare secrets temporarily:

- `PLAID_TOKEN_ENCRYPTION_KEY` = new current 32-byte Base64 key
- `PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS` = old 32-byte Base64 key

After redeploying, System Health re-encrypts the encrypted bank vault, bank data, and financial-intelligence state with the new key. Once health reports no previous-key records, remove `PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS` and redeploy again.

Never rotate by simply replacing the only key. Existing ciphertext would become unreadable.

## Real-money activation gate

Raw bank transactions must not automatically post into daily budget spending yet. First connect real accounts read-only, let history sync, review recurring charges, teach Review Inbox rules, and confirm settlement/refund/transfer behavior. Only then should the later idempotent economic-impact pipeline be enabled.

## Features intentionally deferred until real history exists

These are valuable, but implementing them against invented data would create false confidence:

- probabilistic cash-flow forecasting;
- advanced safe-to-spend forecasts based on observed settlement timing;
- long-horizon sinking-fund recommendations based on real recurring behavior;
- automatic bank-transaction-to-budget posting.

The current planner, fiscal-cycle engine, subscriptions, rules engine, Review Inbox, and purchase planner remain available in the meantime.
