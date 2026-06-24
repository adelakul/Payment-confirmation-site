// Core runtime fixes and safety patches for index.html
// Loaded after the original inline script. This file applies small, safe fixes:
// - Ensures buttons have type="button"
// - Replaces showSection to avoid relying on global `event`
// - Provides newId() utility (crypto.randomUUID fallback)
// - Wraps generateTicket to use UUIDs and ISO timestamps
// - Replaces renderQRs and renderTable with safer DOM creation (avoids innerHTML)
// - Adds accessibility attributes (aria-live/role)

(function(){
  function newId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch(e){}
    return 'PT-' + Math.random().toString(36).slice(2,10).toUpperCase();
  }

  function ensureButtonTypes() {
    document.querySelectorAll('button').forEach(b => { if (!b.hasAttribute('type')) b.setAttribute('type','button'); });
  }

  function safeShowSection(name, ev) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const section = document.getElementById(name);
    if (section) section.classList.add('active');

    // Prefer currentTarget from event, otherwise try to find matching nav button
    if (ev && ev.currentTarget) {
      ev.currentTarget.classList.add('active');
    } else {
      const btn = Array.from(document.querySelectorAll('.nav-btn')).find(b => {
        const onclick = b.getAttribute('onclick') || '';
        return onclick.includes(`showSection('${name}')`) || onclick.includes(`showSection("${name}")`);
      });
      if (btn) btn.classList.add('active');
    }

    if (name === 'scanner') { if (typeof switchScanMode === 'function') switchScanMode('live'); if (typeof resetScan === 'function') resetScan(); }
    else { if (typeof stopCamera === 'function') stopCamera(); }
  }

  function patchGenerateTicket() {
    if (typeof generateTicket !== 'function') return;
    const orig = generateTicket;
    window.generateTicket = function(){
      // call original which will push a ticket into tickets[] and save
      orig();
      try {
        // grab last ticket and normalize id and created
        const t = Array.isArray(tickets) && tickets.length ? tickets[tickets.length-1] : null;
        if (t) {
          if (!t.id || String(t.id).length < 8) t.id = newId();
          // save ISO timestamps if not already
          try { t.created = new Date(t.created).toISOString(); } catch(e){ t.created = new Date().toISOString(); }
          // persist normalized ticket
          if (typeof saveToCloud === 'function') saveToCloud();
          if (typeof updateUI === 'function') updateUI();
        }
      } catch (e) { console.warn('post-generateTicket patch failed', e); }
    };
  }

  function safeRenderQRs() {
    const container = document.getElementById('qrContainer');
    if (!container) return;
    container.innerHTML = '';

    tickets.forEach(t => {
      const card = document.createElement('div');
      card.className = 'qr-card';

      const dot = document.createElement('div');
      dot.className = 'status-dot' + (t.status === 'used' ? ' used' : '');
      card.appendChild(dot);

      const name = document.createElement('div'); name.className = 'name'; name.textContent = t.name || '';
      card.appendChild(name);

      const type = document.createElement('div'); type.className = 'type'; type.textContent = t.type || '';
      card.appendChild(type);

      // code container for QR lib
      const code = document.createElement('div'); code.className = 'code'; code.id = `qr-${t.id}`;
      // show plain code text for accessibility/printing
      const codeText = document.createElement('div'); codeText.textContent = t.code || ''; codeText.style.marginBottom = '8px'; code.appendChild(codeText);
      card.appendChild(code);

      const wrap = document.createElement('div'); wrap.className = 'qr-wrap';
      const qrHolder = document.createElement('div'); qrHolder.id = `qr-${t.id}-canvas`;
      wrap.appendChild(qrHolder);
      card.appendChild(wrap);

      container.appendChild(card);

      // generate QR in next tick (ensures element is in DOM)
      setTimeout(() => {
        const el = document.getElementById(`qr-${t.id}-canvas`);
        if (el && window.QRCode) {
          try {
            // clear existing
            el.innerHTML = '';
            new QRCode(el, { text: t.code, width: 120, height: 120, colorDark: t.status === 'used' ? '#ff4757' : '#00d4aa' });
          } catch(e) { /* ignore */ }
        }
      }, 0);
    });
  }

  function safeRenderTable() {
    const tbody = document.getElementById('ticketTableBody');
    if (!tbody) return;
    const searchInput = document.getElementById('searchTickets');
    const search = searchInput ? (searchInput.value || '').toLowerCase() : '';
    const filtered = search ? tickets.filter(t => (t.name||'').toLowerCase().includes(search) || (t.code||'').toLowerCase().includes(search)) : tickets;

    tbody.innerHTML = '';
    filtered.forEach(t => {
      const tr = document.createElement('tr');
      const tdStatus = document.createElement('td');
      const span = document.createElement('span'); span.className = 'badge ' + (t.status === 'used' ? 'badge-used' : 'badge-valid'); span.textContent = t.status; tdStatus.appendChild(span); tr.appendChild(tdStatus);

      const tdName = document.createElement('td'); tdName.innerHTML = escapeHtml(t.name || ''); tr.appendChild(tdName);
      const tdType = document.createElement('td'); tdType.textContent = t.type || ''; tr.appendChild(tdType);
      const tdAmt = document.createElement('td'); tdAmt.textContent = '₦' + (Number(t.amount||0)).toFixed(2); tr.appendChild(tdAmt);
      const tdCode = document.createElement('td'); tdCode.textContent = t.code || ''; tr.appendChild(tdCode);

      const tdActions = document.createElement('td'); tdActions.className = 'actions';
      const btnCheck = document.createElement('button'); btnCheck.className = 'btn-check'; btnCheck.textContent = 'Check-in'; btnCheck.type = 'button'; btnCheck.onclick = () => { if (typeof markUsed === 'function') markUsed(t.id); };
      const btnReset = document.createElement('button'); btnReset.className = 'btn-reset'; btnReset.textContent = 'Reset'; btnReset.type = 'button'; btnReset.onclick = () => { if (typeof markValid === 'function') markValid(t.id); };
      const btnDel = document.createElement('button'); btnDel.className = 'btn-del'; btnDel.textContent = 'Delete'; btnDel.type = 'button'; btnDel.onclick = () => { if (typeof deleteTicket === 'function') deleteTicket(t.id); };
      tdActions.appendChild(btnCheck); tdActions.appendChild(btnReset); tdActions.appendChild(btnDel);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    });
  }

  function patchRenderers() {
    if (typeof renderQRs === 'function') window.renderQRs = safeRenderQRs;
    else window.renderQRs = safeRenderQRs;
    if (typeof renderTable === 'function') window.renderTable = safeRenderTable;
    else window.renderTable = safeRenderTable;
  }

  function patchNavOnclicks() {
    document.querySelectorAll('.nav-btn[onclick]').forEach(b => {
      const v = b.getAttribute('onclick');
      if (v && !v.includes('event')) {
        // replace showSection('name') with showSection('name', event)
        const newv = v.replace(/showSection\(([^)]*)\)/, (m, p1) => `showSection(${p1}, event)`);
        b.setAttribute('onclick', newv);
      }
    });
  }

  function addAccessibility() {
    const ss = document.getElementById('scanStatus'); if (ss) { ss.setAttribute('role','status'); ss.setAttribute('aria-live','polite'); }
    const sr = document.getElementById('scanResult'); if (sr) sr.setAttribute('role','status');
  }

  // Run patches after a short delay so original script has run
  document.addEventListener('DOMContentLoaded', () => {
    try {
      ensureButtonTypes();
      window.showSection = safeShowSection;
      window.newId = newId;
      patchGenerateTicket();
      patchRenderers();
      patchNavOnclicks();
      addAccessibility();

      // Re-render UI safely once
      if (typeof updateUI === 'function') updateUI();
    } catch (err) {
      console.error('core-fixes load failed', err);
    }
  });
})();
