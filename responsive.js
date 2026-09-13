const mobileQuery = window.matchMedia('(max-width: 760px)');

function centerActiveMobileNav() {
  if (!mobileQuery.matches) return;
  const nav = document.querySelector('.mobile-nav');
  const active = nav?.querySelector('.mobile-nav-item.active');
  if (!nav || !active) return;
  const navRect = nav.getBoundingClientRect();
  const itemRect = active.getBoundingClientRect();
  const clipped = itemRect.left < navRect.left + 4 || itemRect.right > navRect.right - 4;
  if (clipped) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

function bootResponsiveNavigation() {
  const nav = document.querySelector('.mobile-nav');
  if (!nav) return;

  nav.addEventListener('click', (event) => {
    if (event.target.closest('.mobile-nav-item')) setTimeout(centerActiveMobileNav, 0);
  });

  const observer = new MutationObserver(() => queueMicrotask(centerActiveMobileNav));
  observer.observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  window.addEventListener('pageshow', centerActiveMobileNav);
  window.addEventListener('orientationchange', () => setTimeout(centerActiveMobileNav, 120));
  mobileQuery.addEventListener?.('change', centerActiveMobileNav);
  setTimeout(centerActiveMobileNav, 80);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootResponsiveNavigation, { once: true });
else bootResponsiveNavigation();
