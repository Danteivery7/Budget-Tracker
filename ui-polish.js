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

  const topbar = document.querySelector('.topbar');
  if (topbar) new MutationObserver(polish).observe(topbar, { childList: true, subtree: true, characterData: true });
  document.addEventListener('click', () => queueMicrotask(polish), true);
  setTimeout(polish, 0);
})();
