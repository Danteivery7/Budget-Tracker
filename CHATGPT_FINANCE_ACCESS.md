# ChatGPT read-only finance access

Budget Tracker exposes a deliberately narrow assistant interface so a connected ChatGPT experience can answer current affordability questions from the tracker instead of relying on stale remembered balances.

## Intended behavior

When the owner asks questions such as:

- How much can I spend today?
- How much is left this week or this financial cycle?
- Can I buy this DLC for $30?
- What would this purchase leave me with?

Budget Tracker is the source of truth. The assistant should retrieve the current snapshot at question time and answer from those values.

This is on-demand access only. It does not poll the tracker or monitor finances in the background.

## Read-only endpoints

`GET /api/assistant/context`

Returns only derived planning values for the current date: current-day allowance/usage/remaining, week window/remaining, active financial-cycle remaining, income/fixed-cost totals, and protected business plus loan/savings targets.

`POST /api/assistant/purchase`

Body example:

```json
{
  "item": "Game DLC",
  "amount": 30
}
```

Returns the current snapshot plus a what-if purchase result, including remaining personal money and whether the purchase would touch business or protected loan/savings money. It never changes saved Budget Tracker state.

## Privacy boundary

The assistant interface does **not** return:

- Plaid access tokens or provider secrets
- bank credentials
- Plaid Item/account/transaction IDs
- raw linked-bank feeds
- full daily notes/history
- money-movement capability
- budget mutation capability

It is strictly read-only.

## Access key

System Health contains **ChatGPT Read-Only Access**. Creating or revoking its key requires the separate Protected Operations session. The key is shown only once when created and is stored server-side only as a SHA-256 hash.

Do not paste the key into a normal conversation. It is intended only for the authentication setup of an approved Budget Tracker connection.

The access key can be revoked at any time without changing the Budget Tracker password, passkeys, Plaid credentials, or bank-encryption keys.
