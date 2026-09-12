(() => {
  const eyebrowMap = {
    TODAY: 'OVERVIEW',
    MONTH: 'MONTHLY PLAN',
    PLANNER: 'PURCHASE PLANNER',
  };
  const titleMap = {
    'Your spending limit': 'Your financial position',
    'Your budget': 'Your financial position',
    'Monthly setup': 'Monthly plan',
    'What-if purchase planner': 'Purchase decision',
    'Recurring expenses': 'Fixed costs',
    'Monthly history': 'Financial history',
  };

  function polish() {
    const eyebrow = document.querySelector('#pageEyebrow');
    const title = document.querySelector('#pageTitle');
    if (eyebrow && eyebrowMap[eyebrow.textContent.trim()]) eyebrow.textContent = eyebrowMap[eyebrow.textContent.trim()];
    if (title && titleMap[title.textContent.trim()]) title.textContent = titleMap[title.textContent.trim()];
  }

  function injectCardTheme() {
    if (document.querySelector('#professionalCardsTheme')) return;
    const style = document.createElement('style');
    style.id = 'professionalCardsTheme';
    style.textContent = `
      .cards-note{border-color:#363027!important;background:#12100d!important;color:#9f988d!important;border-radius:9px!important}
      .payment-card{background:#121214!important;border-color:#29292d!important}
      .payment-card .last4,.payment-card .purpose,.cards-row-main span,.cards-row-meta{color:#77736c!important}
      .card-stat{background:#0f0f11!important;border-color:#29292d!important;border-radius:8px!important}
      .card-stat span{color:#706b63!important}.card-stat strong{color:#e8e3da!important}
      .cards-badge{border-color:#343338!important;background:#161618!important;color:#a9a298!important;border-radius:6px!important}
      .cards-badge.credit,.cards-badge.debit{color:#d5b66f!important;background:#1a1711!important}
      .cards-x{border-color:#313136!important;background:#141416!important;color:#8d8880!important;border-radius:7px!important}
      .cards-row{background:#101012!important;border-color:#29292d!important;border-radius:8px!important}
      .cards-empty{border-color:#343338!important;color:#77736c!important;border-radius:8px!important}
      .autopay-chip{background:#101012!important;border-color:#29292d!important;color:#8e8980!important;border-radius:7px!important}
      .autopay-chip strong{color:#ded9d0!important}
      .cards-positive{color:#84bea0!important}.cards-negative{color:#d48686!important}
    `;
    document.head.appendChild(style);
  }

  const topbar = document.querySelector('.topbar');
  if (topbar) new MutationObserver(polish).observe(topbar, { childList: true, subtree: true, characterData: true });
  document.addEventListener('click', () => queueMicrotask(polish), true);
  injectCardTheme();
  setTimeout(() => { polish(); injectCardTheme(); }, 0);
})();
