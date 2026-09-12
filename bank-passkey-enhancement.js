import { authenticateWithPasskey, passkeysSupported } from './passkey-client.js';

function enhance() {
  if (!passkeysSupported()) return;
  const form = document.querySelector('#bankUnlockForm');
  if (!form || document.querySelector('#bankPasskeyUnlock')) return;
  const button = document.createElement('button');
  button.id = 'bankPasskeyUnlock';
  button.className = 'button ghost wide';
  button.type = 'button';
  button.textContent = 'Use Face ID / Windows Hello / passkey';
  form.insertAdjacentElement('afterend', button);
  button.addEventListener('click', async () => {
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Waiting for passkey…';
    try {
      await authenticateWithPasskey('bank');
      const nav = document.querySelector('[data-bank-nav="desktop"]') || document.querySelector('[data-bank-nav]');
      nav?.click();
    } catch (error) {
      const toast = document.querySelector('#toast');
      if (toast) {
        toast.textContent = error.message;
        toast.className = 'toast show error';
        setTimeout(() => { toast.className = 'toast'; }, 3200);
      }
      button.disabled = false;
      button.textContent = original;
    }
  });
}

const observer = new MutationObserver(enhance);
observer.observe(document.documentElement, { childList:true, subtree:true });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhance, { once:true });
else enhance();
