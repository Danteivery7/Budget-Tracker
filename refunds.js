(() => {
  const originalFetch = window.fetch.bind(window);
  let latestState = null;

  const money = (value) => Math.abs(Number(value || 0)).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
  });

  const localDateKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const amounts = (entry = {}) => {
    const spent = Number(entry.amount || 0);
    const refunded = Number(entry.refund || 0);
    return { spent, refunded, net: spent - refunded };
  };

  function refundValuesFor(date) {
    const dialog = document.querySelector('#dayDialog[open]');
    if (dialog && document.querySelector('#dayDialogDate')?.value === date) {
      return {
        refund: Number(document.querySelector('#dayDialogRefund')?.value || 0),
        refundNote: document.querySelector('#dayDialogRefundNote')?.value || '',
      };
    }
    return {
      refund: Number(document.querySelector('#todayRefund')?.value || 0),
      refundNote: document.querySelector('#todayRefundNote')?.value || '',
    };
  }

  window.fetch = async (input, init = {}) => {
    let nextInit = init;
    const url = typeof input === 'string' ? input : input?.url || '';

    if (url.includes('/api/budget/mutate') && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        if (body?.action === 'saveDaily' && body?.payload?.date) {
          body.payload = { ...body.payload, ...refundValuesFor(body.payload.date) };
          nextInit = { ...init, body: JSON.stringify(body) };
        }
      } catch { /* leave request alone */ }
    }

    const response = await originalFetch(input, nextInit);
    if (url.includes('/api/budget/state') || url.includes('/api/budget/mutate')) {
      try {
        const data = await response.clone().json();
        if (data?.state) latestState = data.state;
      } catch { /* non-json response */ }
    }
    return response;
  };

  function injectStyle() {
    if (document.querySelector('#refundEnhancementStyles')) return;
    const style = document.createElement('style');
    style.id = 'refundEnhancementStyles';
    style.textContent = `
      .refund-entry-field{margin-top:12px}.refund-entry-field label{display:block;margin-bottom:7px;font-size:.82rem;font-weight:700;color:var(--text,#eef2ff)}
      .refund-help{display:block;margin-top:5px;font-size:.72rem;color:var(--muted,#8f99ad);line-height:1.35}
      .refund-summary{margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(45,212,191,.08);border:1px solid rgba(45,212,191,.2);font-size:.82rem;line-height:1.45}
      .refund-summary strong{color:#5eead4}.refund-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      @media(max-width:620px){.refund-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function enhanceToday() {
    const form = document.querySelector('#todayForm');
    if (!form || document.querySelector('#todayRefund')) return;
    injectStyle();
    const note = document.querySelector('#todayNote');
    if (!note) return;

    const wrap = document.createElement('div');
    wrap.className = 'refund-entry-field';
    wrap.innerHTML = `
      <label for="todayRefund">Money back / refunds</label>
      <div class="money-input"><span>$</span><input id="todayRefund" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" /></div>
      <input id="todayRefundNote" class="entry-note" type="text" maxlength="200" placeholder="Optional refund note, e.g. Steam refund" style="margin-top:8px" />
      <span class="refund-help">Refunds and reimbursements reduce that day’s net spending. If money back is larger than spending, the difference becomes extra future buffer.</span>`;
    form.insertBefore(wrap, note);

    const entry = latestState?.dailySpending?.[localDateKey()];
    if (entry) {
      document.querySelector('#todayRefund').value = Number(entry.refund || 0) || '';
      document.querySelector('#todayRefundNote').value = entry.refundNote || '';
      if (Number(entry.refund || 0) > 0) {
        const a = amounts(entry);
        const summary = document.createElement('div');
        summary.className = 'refund-summary';
        summary.innerHTML = `<strong>${money(a.refunded)} returned</strong> · ${a.net < 0 ? `${money(Math.abs(a.net))} net gain` : `${money(a.net)} net spent`}`;
        wrap.appendChild(summary);
      }
    }
  }

  function populateDialog() {
    const date = document.querySelector('#dayDialogDate')?.value;
    if (!date) return;
    const entry = latestState?.dailySpending?.[date];
    const refund = document.querySelector('#dayDialogRefund');
    const refundNote = document.querySelector('#dayDialogRefundNote');
    if (refund) refund.value = entry ? (Number(entry.refund || 0) || '') : '';
    if (refundNote) refundNote.value = entry?.refundNote || '';
  }

  function enhanceHistory() {
    if (!latestState) return;
    const buttons = document.querySelectorAll('.calendar-day[data-date]');
    if (!buttons.length) return;
    buttons.forEach((button) => {
      const entry = latestState.dailySpending?.[button.dataset.date];
      if (!entry) return;
      const a = amounts(entry);
      const spentEl = button.querySelector('.day-spent');
      const caption = button.querySelector('.day-caption');
      if (spentEl) spentEl.textContent = a.net < 0 ? `+${money(Math.abs(a.net))}` : money(a.net);
      if (caption && a.refunded > 0) caption.textContent = a.net < 0 ? 'net gain' : `${money(a.refunded)} back`;
    });

    const section = document.querySelector('#view .form-card .section-head');
    const picker = document.querySelector('#historyMonthPicker')?.value;
    if (section && picker) {
      let gross = 0, refunded = 0;
      Object.entries(latestState.dailySpending || {}).forEach(([date, entry]) => {
        if (!date.startsWith(`${picker}-`)) return;
        const a = amounts(entry); gross += a.spent; refunded += a.refunded;
      });
      const p = section.querySelector('p');
      if (p && (gross || refunded)) p.textContent = `${money(gross)} gross spent · ${money(refunded)} back · ${gross - refunded < 0 ? `+${money(refunded - gross)} net gain` : `${money(gross - refunded)} net spent`}`;
      const labels = [...document.querySelectorAll('#view .summary-grid .metric-label')];
      const spentCard = labels.find((el) => el.textContent.trim() === 'Spent');
      if (spentCard) spentCard.textContent = 'Net spending';
    }
  }

  function enhanceCurrentView() {
    enhanceToday();
    enhanceHistory();
  }

  const observer = new MutationObserver(() => queueMicrotask(enhanceCurrentView));
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('click', (event) => {
    if (event.target.closest('.calendar-day[data-date]')) setTimeout(populateDialog, 0);
    if (event.target.closest('#exportCsv')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!latestState) return;
      const rows = [['Date', 'Spent', 'Money Back', 'Net Spending', 'Spending Note', 'Refund Note', 'Month']];
      Object.entries(latestState.dailySpending || {}).sort(([a], [b]) => a.localeCompare(b)).forEach(([date, entry]) => {
        const a = amounts(entry);
        rows.push([date, a.spent.toFixed(2), a.refunded.toFixed(2), a.net.toFixed(2), entry.note || '', entry.refundNote || '', date.slice(0, 7)]);
      });
      const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `budget-tracker-spending-${localDateKey()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    }
  }, true);
})();
