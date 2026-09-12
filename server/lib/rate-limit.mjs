import { createHmac } from 'node:crypto';
import { cloudflareDatabase } from '@netlify/blobs';

function subjectHash(request) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'unknown';
  const secret = process.env.BUDGET_TRACKER_PASSWORD || process.env.RATE_LIMIT_SALT || 'budget-tracker-rate-limit';
  return createHmac('sha256', secret).update(String(ip)).digest('hex');
}

export async function enforceRateLimit(request, { scope, limit, windowSeconds }) {
  const db = await cloudflareDatabase();
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - Math.max(1, Number(windowSeconds || 60));
  const subject = subjectHash(request);
  const row = await db.prepare(`INSERT INTO rate_limits(scope, subject, window_start, count, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(scope, subject) DO UPDATE SET
      window_start = CASE WHEN rate_limits.window_start <= ? THEN excluded.window_start ELSE rate_limits.window_start END,
      count = CASE WHEN rate_limits.window_start <= ? THEN 1 ELSE rate_limits.count + 1 END,
      updated_at = excluded.updated_at
    RETURNING window_start, count`)
    .bind(String(scope), subject, now, now, cutoff, cutoff)
    .first();

  if ((now % 97) === 0) {
    await db.prepare('DELETE FROM rate_limits WHERE updated_at < ?').bind(now - 86400).run().catch(() => {});
  }

  const allowed = Number(row?.count || 0) <= Number(limit || 1);
  return {
    allowed,
    limit: Number(limit || 1),
    remaining: Math.max(0, Number(limit || 1) - Number(row?.count || 0)),
    resetAt: (Number(row?.window_start || now) + Number(windowSeconds || 60)) * 1000,
  };
}
