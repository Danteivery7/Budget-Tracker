import { json } from '../lib/auth.mjs';
import { markConnectionRepairByItemId, syncConnectionByItemId } from '../lib/bank-service.mjs';
import { plaidConfigured } from '../lib/plaid-client.mjs';
import { verifyPlaidWebhook } from '../lib/plaid-webhook.mjs';

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!plaidConfigured()) return json({ error: 'Unavailable.' }, 503);

  const rawBody = await request.text();
  let verified = false;
  try { verified = await verifyPlaidWebhook(request, rawBody); } catch { verified = false; }
  if (!verified) return json({ error: 'Invalid webhook signature.' }, 401);

  let body = {};
  try { body = JSON.parse(rawBody); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const itemId = String(body?.item_id || '');
  if (!itemId) return json({ received: true });

  try {
    if (body?.webhook_type === 'TRANSACTIONS' && body?.webhook_code === 'SYNC_UPDATES_AVAILABLE') {
      await syncConnectionByItemId(itemId, { webhook: true });
    } else if (body?.webhook_type === 'ITEM' && body?.error) {
      await markConnectionRepairByItemId(itemId, String(body.error?.error_code || 'ITEM_ERROR'));
    }
  } catch {
    return json({ error: 'Webhook processing failed.' }, 500);
  }
  return json({ received: true });
};

export const config = { path: '/api/plaid/webhook' };
