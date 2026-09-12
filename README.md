# Budget Tracker

A private, responsive financial operating system for income planning, fiscal-cycle budgeting, protected targets, subscriptions, cards, linked-account intelligence, passkeys, and transaction review.

## Core capabilities

- Financial cycles anchored to the actual start date rather than the calendar first
- Persistent approved-plan revisions and deliberate plan-change workflow
- Business/reinvestment, loan/savings, and personal-spending allocation priorities
- Adaptive daily spending and purchase planning
- Cards, recurring expenses, subscription discovery, and payment routing
- Secure Plaid Transactions integration with encrypted token and transaction storage
- Separate 15-minute protected-banking session
- Face ID / Touch ID / Windows Hello / passkey authentication with password fallback
- Deterministic financial rules and manual Review Inbox
- Transfer, credit-card payment, refund, recurring-charge, income, and loan-payment reconciliation
- Append-only tamper-evident financial audit ledger
- JSON backup/restore and PWA/offline app-shell support

## Cloudflare architecture

Production is designed for:

- **Cloudflare Pages** for static frontend delivery
- **Cloudflare Pages Functions** for `/api/*`
- **Cloudflare D1** for persistent application state and optimistic/versioned writes
- Application-level AES-256-GCM encryption for Plaid tokens and private bank data before D1 storage
- D1-backed API rate limiting using keyed hashes rather than storing raw source IP addresses
- Cloudflare encrypted secrets for passwords, Plaid credentials, and the bank encryption key

Netlify services are not required by the Cloudflare deployment.

## Deployment

See `CLOUDFLARE_SETUP.md` for the exact GitHub → Cloudflare Pages setup, D1 binding, secrets, passkey domain, and Plaid callback/webhook configuration.

Cloudflare Pages build settings:

- Build command: `npm run build`
- Output directory: `dist`
- Production branch: `main`
- D1 binding name: `DB`

The `/functions` directory is bundled by Cloudflare Pages Functions. Only `/api/*` invokes Functions; the rest of the site stays on static Pages delivery.

## Development checks

```bash
npm install
npm run verify
```

`npm run verify` runs the full budget/security test suite, syntax checks, the static build, and an actual Cloudflare Pages Functions bundle through Wrangler.
