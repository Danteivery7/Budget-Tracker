import { authenticateWithPasskey, passkeysSupported, passkeyStatus } from './passkey-client.js';

const button = document.querySelector('#passkeyLoginButton');
const note = document.querySelector('#passkeyLoginNote');

async function refresh() {
  if (!button || !passkeysSupported()) return;
  try {
    const status = await passkeyStatus();
    if (!status.available) return;
    button.hidden = false;
    if (note) note.hidden = false;
  } catch { /* password login remains available */ }
}

button?.addEventListener('click', async () => {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Waiting for passkey…';
  try {
    await authenticateWithPasskey('login');
    location.reload();
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

refresh();
