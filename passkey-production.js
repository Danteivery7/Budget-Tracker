function suggestedPasskeyName() {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  if (/iPhone/i.test(ua)) return 'iPhone Face ID';
  if (/iPad/i.test(ua)) return 'iPad Face ID / Touch ID';
  if (/Windows/i.test(ua) || /Win/i.test(platform)) return 'Windows Hello';
  if (/Macintosh|Mac OS X/i.test(ua) || /Mac/i.test(platform)) return 'Mac Touch ID / passkey';
  if (/Android/i.test(ua)) return 'Android passkey';
  return 'Primary device passkey';
}

function buildDomainNote(hostname) {
  const note = document.createElement('div');
  note.className = 'bank-private-note';
  note.dataset.passkeyDomainNote = 'true';

  const inner = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = 'Permanent passkey domain';
  const detail = document.createElement('span');
  detail.textContent = `Passkeys created here are scoped to ${hostname}. Keep using this Cloudflare hostname and Face ID, Touch ID, Windows Hello, or another passkey provider can unlock Budget Tracker.`;

  inner.append(title, detail);
  note.append(inner);
  return note;
}

function enhancePasskeySetup() {
  const form = document.querySelector('#addPasskeyForm');
  if (!form) return;

  const input = form.querySelector('#passkeyName');
  if (input && !input.dataset.passkeySuggested) {
    input.dataset.passkeySuggested = 'true';
    if (!input.value.trim()) input.value = suggestedPasskeyName();
  }

  if (!document.querySelector('[data-passkey-domain-note]')) {
    form.insertAdjacentElement('afterend', buildDomainNote(window.location.hostname));
  }
}

const observer = new MutationObserver(() => queueMicrotask(enhancePasskeySetup));
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('pageshow', enhancePasskeySetup);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhancePasskeySetup, { once: true });
else enhancePasskeySetup();
