import { isAuthenticated, json } from '../lib/auth.mjs';
import { isBankAuthorized, requireSameOrigin } from '../lib/bank-auth.mjs';
import { safeAppendLedgerEvent } from '../lib/ledger.mjs';
import {
  createSandboxDynamicConnection,
  exportRecoveryPackage,
  fireSandboxSyncWebhook,
  restoreRecoveryPackage,
  rotateEncryptedRecords,
  seedSandboxTransactions,
  syntheticCommissioning,
  systemHealth,
  validateRecoveryPackage,
} from '../lib/system-service.mjs';

async function bodyOf(request) {
  try { return await request.json(); } catch { throw new Error('Invalid request body.'); }
}

function needsProtectedSession(pathname) {
  return pathname.includes('/recovery/') || pathname.endsWith('/encryption/rotate') || pathname.includes('/sandbox/');
}

export default async (request) => {
  const { pathname } = new URL(request.url);
  if (!isAuthenticated(request)) return json({ error:'Unauthorized.' }, 401);

  try {
    if (request.method === 'GET' && pathname.endsWith('/health')) {
      return json(await systemHealth());
    }
    if (request.method === 'GET' && pathname.endsWith('/commissioning/synthetic')) {
      return json(syntheticCommissioning());
    }

    if (request.method === 'POST' && !requireSameOrigin(request)) return json({ error:'Invalid request origin.' }, 403);
    if (needsProtectedSession(pathname) && !isBankAuthorized(request)) return json({ error:'Protected system operation locked. Unlock banking first.' }, 403);

    if (request.method === 'POST' && pathname.endsWith('/recovery/export')) {
      const pkg = await exportRecoveryPackage();
      await safeAppendLedgerEvent({ source:'system', action:'recovery_exported', summary:`Recovery package exported with ${pkg.rows.length} records`, payload:{ records:pkg.rows.length, digest:pkg.digest } });
      return json({ package:pkg });
    }
    if (request.method === 'POST' && pathname.endsWith('/recovery/validate')) {
      const body = await bodyOf(request);
      const checked = validateRecoveryPackage(body?.package);
      return json({ valid:true, records:checked.rows.length, createdAt:checked.createdAt, siteId:checked.siteId });
    }
    if (request.method === 'POST' && pathname.endsWith('/recovery/restore')) {
      const body = await bodyOf(request);
      if (body?.confirmation !== 'RESTORE') return json({ error:'Type RESTORE to confirm recovery import.' }, 400);
      const result = await restoreRecoveryPackage(body?.package);
      await safeAppendLedgerEvent({ source:'system', action:'recovery_restored', summary:`Recovery package restored ${result.restored} records`, payload:{ restored:result.restored, sourceCreatedAt:result.sourceCreatedAt } });
      return json(result);
    }
    if (request.method === 'POST' && pathname.endsWith('/encryption/rotate')) {
      const result = await rotateEncryptedRecords();
      await safeAppendLedgerEvent({ source:'security', action:'bank_encryption_rotated', summary:`Re-encrypted ${result.rotated} protected records`, payload:{ rotated:result.rotated } });
      return json(result);
    }
    if (request.method === 'POST' && pathname.endsWith('/sandbox/create')) {
      const connection = await createSandboxDynamicConnection(request);
      await safeAppendLedgerEvent({ source:'commissioning', action:'sandbox_connection_created', entity:connection.connectionId, summary:'Created Plaid dynamic Transactions Sandbox connection' });
      return json({ connection });
    }
    if (request.method === 'POST' && pathname.endsWith('/sandbox/seed')) {
      const body = await bodyOf(request);
      const result = await seedSandboxTransactions(body?.connectionId);
      await safeAppendLedgerEvent({ source:'commissioning', action:'sandbox_transactions_seeded', entity:String(body?.connectionId || '').slice(0, 160), summary:`Seeded ${result.seeded} Sandbox transactions` });
      return json(result);
    }
    if (request.method === 'POST' && pathname.endsWith('/sandbox/fire-webhook')) {
      const body = await bodyOf(request);
      const result = await fireSandboxSyncWebhook(body?.connectionId);
      await safeAppendLedgerEvent({ source:'commissioning', action:'sandbox_webhook_fired', entity:String(body?.connectionId || '').slice(0, 160), summary:'Fired SYNC_UPDATES_AVAILABLE Sandbox webhook' });
      return json(result);
    }
  } catch (error) {
    return json({ error:error?.message || 'System operation failed.' }, 400);
  }

  return json({ error:'Not found.' }, 404);
};

export const config = { path:'/api/system/*' };
