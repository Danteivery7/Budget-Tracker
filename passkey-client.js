const encoder = new TextEncoder();

function fromBase64url(value) {
  const text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = text + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64url(value) {
  if (value == null) return null;
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let body = {};
  try { body = await response.json(); } catch { /* noop */ }
  if (!response.ok) throw new Error(body.error || 'Passkey request failed.');
  return body;
}

function creationOptions(options) {
  return {
    ...options,
    challenge: fromBase64url(options.challenge),
    user: { ...options.user, id: fromBase64url(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((item) => ({ ...item, id: fromBase64url(item.id) })),
  };
}

function requestOptions(options) {
  return {
    ...options,
    challenge: fromBase64url(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((item) => ({ ...item, id: fromBase64url(item.id) })),
  };
}

function registrationJSON(credential) {
  return {
    id: credential.id,
    rawId: toBase64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || null,
    clientExtensionResults: credential.getClientExtensionResults?.() || {},
    response: {
      clientDataJSON: toBase64url(credential.response.clientDataJSON),
      attestationObject: toBase64url(credential.response.attestationObject),
      transports: credential.response.getTransports?.() || [],
    },
  };
}

function authenticationJSON(credential) {
  return {
    id: credential.id,
    rawId: toBase64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || null,
    clientExtensionResults: credential.getClientExtensionResults?.() || {},
    response: {
      clientDataJSON: toBase64url(credential.response.clientDataJSON),
      authenticatorData: toBase64url(credential.response.authenticatorData),
      signature: toBase64url(credential.response.signature),
      userHandle: credential.response.userHandle ? toBase64url(credential.response.userHandle) : null,
    },
  };
}

function friendly(error) {
  if (error?.name === 'NotAllowedError') return new Error('Passkey authentication was cancelled or timed out.');
  if (error?.name === 'SecurityError') return new Error('Passkeys are not available for this site origin.');
  if (error?.name === 'InvalidStateError') return new Error('That passkey is already registered on this authenticator.');
  return error instanceof Error ? error : new Error('Passkey request failed.');
}

export function passkeysSupported() {
  return Boolean(window.PublicKeyCredential && navigator.credentials?.create && navigator.credentials?.get && window.isSecureContext);
}

export async function registerPasskey(name = '') {
  if (!passkeysSupported()) throw new Error('This browser or device does not support passkeys here.');
  try {
    const options = await api('/api/passkeys/registration/options', { method: 'POST', body: '{}' });
    const credential = await navigator.credentials.create({ publicKey: creationOptions(options) });
    if (!credential) throw new Error('No passkey was created.');
    return api('/api/passkeys/registration/verify', {
      method: 'POST',
      body: JSON.stringify({ name, response: registrationJSON(credential) }),
    });
  } catch (error) {
    throw friendly(error);
  }
}

export async function authenticateWithPasskey(purpose = 'login') {
  if (!passkeysSupported()) throw new Error('This browser or device does not support passkeys here.');
  const normalizedPurpose = purpose === 'bank' ? 'bank' : 'login';
  try {
    const options = await api('/api/passkeys/authentication/options', {
      method: 'POST',
      body: JSON.stringify({ purpose: normalizedPurpose }),
    });
    const credential = await navigator.credentials.get({ publicKey: requestOptions(options) });
    if (!credential) throw new Error('No passkey was selected.');
    return api('/api/passkeys/authentication/verify', {
      method: 'POST',
      body: JSON.stringify({ purpose: normalizedPurpose, response: authenticationJSON(credential) }),
    });
  } catch (error) {
    throw friendly(error);
  }
}

export async function passkeyStatus() {
  return api('/api/passkeys/status', { cache: 'no-store' });
}
