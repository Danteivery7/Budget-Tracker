# Budget Tracker

A private, responsive personal budget tracker built for a simple daily workflow:

1. Set monthly income.
2. Subtract housing and fixed recurring costs.
3. Set a monthly reinvestment target.
4. The remaining amount becomes the month's discretionary budget.
5. The app divides that budget across the exact number of days in the month.
6. Unused daily allowance rolls forward; overspending reduces future allowance.
7. The final month balance carries into the next configured month.

## Features

- Mobile, Mac, and desktop responsive UI
- Monthly income / housing / reinvestment setup
- Recurring fixed-cost templates with month-specific snapshots
- Daily spending entry with green / yellow / red pacing
- Large-purchase recovery / no-spend-day guidance
- Month-to-month positive or negative carryover
- Monthly calendar and editable historical entries
- JSON backup / restore and CSV spending export
- PWA manifest and offline app-shell caching
- Private server-side access-code login
- Cross-device persistence with Netlify Blobs
- Strong-consistency reads and conditional writes to reduce multi-device overwrite risk

## Netlify deployment

Connect this repository to a Netlify project. No frontend build step is required; `netlify.toml` contains the publish and Functions configuration.

### Required environment variable

In Netlify, create this environment variable for the project:

- `BUDGET_TRACKER_PASSWORD` — the private access code/password you want to use to unlock the tracker.

After adding or changing the environment variable, redeploy the project so the Functions runtime receives the updated value.

The access code is never shipped to the browser. Successful login creates an HttpOnly, Secure, SameSite=Strict session cookie.

## Storage

The backend uses the `budget-tracker` Netlify Blobs store and a site-wide `state` key. Site-wide Blobs persist across future deploys, so changing the website does not erase the financial history.

## Development checks

```bash
npm test
npm run check
```

The core budget math is isolated in `engine.js` and covered by tests for daily carry, month-end carry, reinvestment changes, large overspending recovery, and leap-year month lengths.
