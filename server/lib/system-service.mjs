import { createHash } from 'node:crypto';
import { cloudflareDatabase } from '@netlify/blobs';
import { runSyntheticCommissioning } from '../../commissioning-core.js';
import { bankEncryptionStatus, decryptBankValueDetailed, encryptBankValue } from './bank-crypto.mjs';
import { readVault, connectionById } from './bank-store.mjs';
import { exchangePublicToken, listPublicConnections, syncConnection } from './bank-service.mjs';
import { intelligenceView } from './intelligence-service.mjs';
import { ledgerStatus } from './ledger.mjs';
import { passkeySummary } from './passkeys.mjs';
import { plaidConfigured, plaidEnvironment, plaidHistoryDays, plaidRequest, plaidWebhookUrl } from './plaid-client.mjs';

const ENCRYPTED_NAMESPACES = new Set([
  'budget-tracker-bank-vault',
  'budget-tracker-bank-data',
  'budget-tracker-financial-intelligence',
]);

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

function sha(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
}

function encryptionPurpose(namespace, key) {
  if (namespace === 'budget-tracker-bank-vault' && key === 'connections') return 'bank-vault';
  if (namespace === 'budget-tracker-financial-intelligence' && key === 'state') return 'financial-intelligence';
  if (namespace === 'budget-tracker-bank-data' && String(key).startsWith('connection:')) return `bank-data:${String(key).slice('connection:'.length)}`;
  return null;
}

async function d1Stats() {
  const db = await cloudflareDatabase();
  const [row, namespaces] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS records, MAX(updated_at) AS last_updated FROM kv_store').first(),
    db.prepare('SELECT namespace, COUNT(*) AS records FROM kv_store GROUP BY namespace ORDER BY namespace').all(),
  ]);
  return {
    connected: true,
    records: Number(row?.records || 0),
    lastUpdatedAt: row?.last_updated || null,
    namespaces: (namespaces?.results || []).map((item) => ({ namespace:item.namespace, records:Number(item.records || 0) })),
  };
}

export async function encryptionRotationStatus() {
  const status = bankEncryptionStatus();
  if (!status.currentConfigured) return { ...status, currentRecords:0, previousRecords:0, unreadableRecords:0, totalEncryptedRecords:0 };
  const db = await cloudflareDatabase();
  const rows = await db.prepare(`SELECT namespace, key, value FROM kv_store
    WHERE namespace IN ('budget-tracker-bank-vault','budget-tracker-bank-data','budget-tracker-financial-intelligence')`).all();
  let currentRecords = 0;
  let previousRecords = 0;
  let unreadableRecords = 0;
  for (const row of rows?.results || []) {
    const purpose = encryptionPurpose(row.namespace, row.key);
    if (!purpose) continue;
    try {
      const envelope = JSON.parse(row.value);
      const result = decryptBankValueDetailed(envelope, purpose);
      if (result.keySource === 'previous') previousRecords += 1;
      else currentRecords += 1;
    } catch {
      unreadableRecords += 1;
    }
  }
  return {
    ...status,
    currentRecords,
    previousRecords,
    unreadableRecords,
    totalEncryptedRecords: currentRecords + previousRecords + unreadableRecords,
    rotationNeeded: previousRecords > 0,
  };
}

export async function rotateEncryptedRecords() {
  const status = bankEncryptionStatus();
  if (!status.currentConfigured || !status.previousConfigured) throw new Error('Configure both the new current key and the previous key before rotating.');
  if (!status.stableReferenceConfigured) throw new Error('Configure BANK_REFERENCE_KEY before rotating bank encryption so account and transaction references remain stable.');
  const db = await cloudflareDatabase();
  const rows = await db.prepare(`SELECT namespace, key, value, version FROM kv_store
    WHERE namespace IN ('budget-tracker-bank-vault','budget-tracker-bank-data','budget-tracker-financial-intelligence')`).all();
  let rotated = 0;
  for (const row of rows?.results || []) {
    const purpose = encryptionPurpose(row.namespace, row.key);
    if (!purpose) continue;
    const envelope = JSON.parse(row.value);
    const decoded = decryptBankValueDetailed(envelope, purpose);
    if (decoded.keySource !== 'previous') continue;
    const next = JSON.stringify(encryptBankValue(decoded.value, purpose));
    const result = await db.prepare(`UPDATE kv_store SET value = ?, version = version + 1, updated_at = ?
      WHERE namespace = ? AND key = ? AND version = ?`)
      .bind(next, new Date().toISOString(), row.namespace, row.key, Number(row.version))
      .run();
    if (Number(result?.meta?.changes || 0) !== 1) throw new Error('Encrypted state changed during rotation. Retry after other activity stops.');
    rotated += 1;
  }
  const after = await encryptionRotationStatus();
  return { rotated, status:after };
}

function packageDigest(pkg) {
  return sha({ format:pkg.format, version:pkg.version, siteId:pkg.siteId, createdAt:pkg.createdAt, rows:pkg.rows });
}

export async function exportRecoveryPackage() {
  const db = await cloudflareDatabase();
  const result = await db.prepare('SELECT namespace, key, value, version, updated_at FROM kv_store ORDER BY namespace, key').all();
  const rows = (result?.results || []).map((row) => ({
    namespace:String(row.namespace),
    key:String(row.key),
    value:String(row.value),
    version:Number(row.version || 1),
    updatedAt:row.updated_at || null,
  }));
  const pkg = {
    format:'budget-tracker-recovery',
    version:1,
    siteId:String(process.env.SITE_ID || 'budget-tracker-cloudflare'),
    createdAt:new Date().toISOString(),
    rows,
  };
  return { ...pkg, digest:packageDigest(pkg) };
}

export function validateRecoveryPackage(input) {
  if (!input || input.format !== 'budget-tracker-recovery' || input.version !== 1 || !Array.isArray(input.rows)) throw new Error('This is not a supported Budget Tracker recovery package.');
  if (input.rows.length > 5000) throw new Error('Recovery package contains too many records.');
  const rows = input.rows.map((row) => {
    const namespace = String(row?.namespace || '').slice(0, 160);
    const key = String(row?.key || '').slice(0, 260);
    const value = String(row?.value ?? '');
    if (!namespace.startsWith('budget-tracker') || !key || value.length > 2_000_000) throw new Error('Recovery package contains an invalid record.');
    JSON.parse(value);
    return { namespace, key, value, version:Math.max(1, Number(row?.version || 1)), updatedAt:row?.updatedAt || null };
  });
  const expected = packageDigest({ format:input.format, version:input.version, siteId:input.siteId, createdAt:input.createdAt, rows });
  if (String(input.digest || '') !== expected) throw new Error('Recovery package integrity check failed.');
  return { valid:true, rows, createdAt:input.createdAt || null, siteId:String(input.siteId || '') };
}

export async function restoreRecoveryPackage(input) {
  const checked = validateRecoveryPackage(input);
  const db = await cloudflareDatabase();
  const now = new Date().toISOString();
  let restored = 0;
  for (let offset = 0; offset < checked.rows.length; offset += 40) {
    const chunk = checked.rows.slice(offset, offset + 40);
    const statements = chunk.map((row) => db.prepare(`INSERT INTO kv_store(namespace, key, value, version, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(namespace, key) DO UPDATE SET value=excluded.value, version=MAX(kv_store.version + 1, excluded.version), updated_at=excluded.updated_at`)
      .bind(row.namespace, row.key, row.value, row.version, row.updatedAt || now));
    await db.batch(statements);
    restored += chunk.length;
  }
  return { restored, sourceCreatedAt:checked.createdAt };
}

export async function systemHealth() {
  const encryption = await encryptionRotationStatus();
  const [d1, passkeys, ledger] = await Promise.all([
    d1Stats(),
    passkeySummary(),
    ledgerStatus({ verifyDepth:500 }),
  ]);
  let environment = null;
  try { environment = plaidEnvironment(); } catch { /* invalid config */ }
  let connections = [];
  let intelligence = null;
  if (encryption.currentConfigured) {
    try { connections = await listPublicConnections(); } catch { connections = []; }
    try { intelligence = await intelligenceView(); } catch { intelligence = null; }
  }
  const authConfigured = Boolean(process.env.BUDGET_TRACKER_PASSWORD);
  const plaid = {
    configured:plaidConfigured(),
    environment,
    historyDays:plaidHistoryDays(),
    redirectConfigured:Boolean(process.env.PLAID_REDIRECT_URI),
    webhookConfigured:Boolean(process.env.PLAID_WEBHOOK_URL),
    connections:connections.length,
    lastSyncAt:connections.map((item) => item.lastSyncedAt).filter(Boolean).sort().at(-1) || null,
  };
  const checks = [
    { id:'d1', label:'Cloudflare D1', status:d1.connected ? 'ok' : 'blocked', detail:`${d1.records} application records` },
    { id:'auth', label:'Private login', status:authConfigured ? 'ok' : 'blocked', detail:authConfigured ? 'Encrypted secret configured' : 'BUDGET_TRACKER_PASSWORD missing' },
    { id:'passkeys', label:'Passkeys', status:passkeys.count ? 'ok' : 'warn', detail:passkeys.count ? `${passkeys.count} registered` : 'Password fallback only' },
    { id:'ledger', label:'Audit ledger', status:ledger.valid ? 'ok' : 'blocked', detail:ledger.valid ? `${ledger.checked} chain events verified` : ledger.error || 'Integrity failure' },
    { id:'encryption', label:'Bank encryption', status:encryption.currentConfigured ? 'ok' : 'warn', detail:encryption.currentConfigured ? 'AES-256-GCM current key configured' : 'Not configured yet' },
    { id:'stable_refs', label:'Stable bank references', status:encryption.stableReferenceConfigured ? 'ok' : 'warn', detail:encryption.stableReferenceConfigured ? 'Dedicated reference key configured' : 'Add BANK_REFERENCE_KEY before linking real/sandbox accounts' },
    { id:'rotation', label:'Encryption rotation', status:encryption.unreadableRecords ? 'blocked' : encryption.previousRecords ? 'warn' : 'ok', detail:encryption.unreadableRecords ? `${encryption.unreadableRecords} unreadable encrypted records` : encryption.previousRecords ? `${encryption.previousRecords} records still use previous key` : 'No pending rotation' },
    { id:'plaid', label:'Plaid', status:plaid.configured ? 'ok' : 'warn', detail:plaid.configured ? `${String(environment || '').toUpperCase()} · ${connections.length} connections` : 'Secrets not configured yet' },
    { id:'classification', label:'Classification engine', status:intelligence?.health?.reviewCount ? 'warn' : 'ok', detail:intelligence ? `${intelligence.health.classifiedCount}/${intelligence.health.transactionCount} auto-classified · ${intelligence.health.reviewCount} review` : 'No bank data yet' },
  ];
  return {
    generatedAt:new Date().toISOString(),
    coreReady:checks.filter((item) => ['d1','auth','ledger'].includes(item.id)).every((item) => item.status === 'ok'),
    sandboxReady:plaid.configured && environment === 'sandbox' && encryption.currentConfigured && encryption.stableReferenceConfigured,
    productionBankReady:plaid.configured && environment === 'production' && encryption.currentConfigured && encryption.stableReferenceConfigured && encryption.previousRecords === 0 && encryption.unreadableRecords === 0,
    d1,
    passkeys,
    ledger:{ valid:ledger.valid, checked:ledger.checked, sequence:ledger.sequence, headHash:ledger.headHash, error:ledger.error },
    encryption,
    plaid,
    intelligence:intelligence?.health || null,
    checks,
  };
}

function requireSandbox() {
  if (!plaidConfigured() || plaidEnvironment() !== 'sandbox') throw new Error('Plaid Sandbox is not configured.');
  const encryption = bankEncryptionStatus();
  if (!encryption.currentConfigured) throw new Error('Bank encryption is not configured.');
  if (!encryption.stableReferenceConfigured) throw new Error('Configure BANK_REFERENCE_KEY before creating Sandbox accounts.');
}

export async function createSandboxDynamicConnection(request) {
  requireSandbox();
  const data = await plaidRequest('/sandbox/public_token/create', {
    institution_id:'ins_109508',
    initial_products:['transactions'],
    options:{
      override_username:'user_transactions_dynamic',
      override_password:'budget-tracker',
      webhook:plaidWebhookUrl(request),
    },
    transactions:{ days_requested:Math.max(180, plaidHistoryDays()) },
  });
  return exchangePublicToken(data.public_token, 'Plaid Sandbox · Dynamic Transactions');
}

export async function seedSandboxTransactions(connectionId) {
  requireSandbox();
  const vault = await readVault();
  const connection = connectionById(vault, String(connectionId || ''));
  if (!connection) throw new Error('Sandbox connection not found.');
  const today = new Date().toISOString().slice(0, 10);
  await plaidRequest('/sandbox/transactions/create', {
    access_token:connection.accessToken,
    transactions:[
      { date_transacted:today, date_posted:today, amount:82.17, description:'Commissioning Target Purchase', iso_currency_code:'USD' },
      { date_transacted:today, date_posted:today, amount:12.99, description:'Commissioning Spotify', iso_currency_code:'USD' },
      { date_transacted:today, date_posted:today, amount:-45.50, description:'Commissioning Refund', iso_currency_code:'USD' },
      { date_transacted:today, date_posted:today, amount:-1675, description:'Commissioning Payroll', iso_currency_code:'USD' },
    ],
  }, { timeoutMs:25_000 });
  await plaidRequest('/transactions/refresh', { access_token:connection.accessToken }, { timeoutMs:25_000 }).catch(() => null);
  const synced = await syncConnection(connection.connectionId);
  return { connection:synced, seeded:4 };
}

export async function fireSandboxSyncWebhook(connectionId) {
  requireSandbox();
  const vault = await readVault();
  const connection = connectionById(vault, String(connectionId || ''));
  if (!connection) throw new Error('Sandbox connection not found.');
  await plaidRequest('/sandbox/item/fire_webhook', {
    access_token:connection.accessToken,
    webhook_type:'TRANSACTIONS',
    webhook_code:'SYNC_UPDATES_AVAILABLE',
  });
  return { fired:true };
}

export function syntheticCommissioning() {
  return runSyntheticCommissioning();
}
