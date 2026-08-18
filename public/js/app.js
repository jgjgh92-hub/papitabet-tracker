// ─── PapitaBET Tracker — Main App ────────────────────────────────────────────

const App = (() => {
  let state = {
    bets: [],
    stats: null,
    bankroll: null,
    ws: null,
    currentPage: 'dashboard',
    editingBetId: null,
  };

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    setupNav();
    setupWebSocket();
    await loadAll();
    setupOddsCalculator();
    setupBankrollClick();
  }

  async function loadAll() {
    await Promise.all([loadStats(), loadBets()]);
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  function setupNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(item.dataset.page);
      });
    });
    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });
  }

  function navigateTo(page) {
    state.currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`page-${page}`)?.classList.add('active');
    document.getElementById(`nav-${page}`)?.classList.add('active');

    const titles = { dashboard: 'Dashboard', bets: 'Apuestas', analysis: 'Análisis', sync: 'Sincronizar' };
    document.getElementById('page-title').textContent = titles[page] || page;

    if (page === 'analysis') renderAnalysisCharts();
  }

  // ── Stats & Dashboard ─────────────────────────────────────────────────────
  async function loadStats() {
    try {
      const res = await API.get('/api/stats');
      if (!res.success) return;
      state.stats = res.data;
      state.bankroll = res.data.bankroll;
      renderDashboard(res.data);
    } catch (e) {
      console.error('Error cargando stats:', e);
    }
  }

  function renderDashboard(data) {
    // KPIs
    setText('kpi-total', data.total || 0);
    setText('kpi-pending', data.pending || 0);

    const wr = data.winRate || 0;
    setText('kpi-winrate', `${wr}%`);
    setText('kpi-winrate-big', `${wr}%`);

    const roi = data.roi || 0;
    const roiEl = document.getElementById('kpi-roi');
    if (roiEl) {
      roiEl.textContent = `${roi > 0 ? '+' : ''}${roi}%`;
      roiEl.style.background = roi >= 0
        ? 'linear-gradient(135deg, #10b981, #34d399)'
        : 'linear-gradient(135deg, #ef4444, #f87171)';
      roiEl.style.webkitBackgroundClip = 'text';
      roiEl.style.webkitTextFillColor = 'transparent';
    }

    const profit = data.totalProfit || 0;
    const profitEl = document.getElementById('kpi-profit');
    if (profitEl) {
      profitEl.textContent = `${profit >= 0 ? '+' : ''}$${Math.abs(profit).toFixed(2)}`;
      profitEl.classList.toggle('negative', profit < 0);
    }

    // Racha
    if (data.streak) {
      const s = data.streak;
      setText('kpi-streak', s.count || 0);
      document.getElementById('kpi-streak-icon').textContent = s.type === 'won' ? '🔥' : s.type === 'lost' ? '❄️' : '—';
      setText('kpi-streak-label', s.type === 'won' ? 'Racha Ganadora' : s.type === 'lost' ? 'Racha Perdedora' : 'Racha');
    }

    // Pending badge
    setText('pending-badge', data.pending || 0);

    // Bankroll sidebar
    if (data.bankroll) {
      const initial = data.bankroll.initial_capital || 0;
      const current = data.bankroll.current_capital || 0;
      const diff = current - initial;
      setText('sidebar-bankroll', `$${current.toFixed(2)}`);
      const profitEl2 = document.getElementById('sidebar-profit');
      if (profitEl2) {
        profitEl2.textContent = `${diff >= 0 ? '+' : ''}$${diff.toFixed(2)}`;
        profitEl2.style.color = diff >= 0 ? 'var(--won)' : 'var(--lost)';
      }
    }

    // Charts
    if (data.cumulativeProfit?.length > 0) renderProfitChart(data.cumulativeProfit);
    renderWLChart(data.won || 0, data.lost || 0, data.pending || 0);
    if (data.byGame?.length > 0) renderByGameChart(data.byGame);
    if (data.byMarket?.length > 0) renderByMarketChart(data.byMarket);

    // Last sync
    API.get('/api/sync/status').then(r => {
      if (r.data?.lastSync) {
        const d = new Date(r.data.lastSync.synced_at);
        setText('last-sync-info', `Última sync: ${d.toLocaleString('es')}`);
      }
    }).catch(() => {});
  }

  // ── Bets Table ────────────────────────────────────────────────────────────
  async function loadBets(filters = {}) {
    try {
      const params = new URLSearchParams(filters).toString();
      const res = await API.get(`/api/bets${params ? '?' + params : ''}`);
      if (!res.success) return;
      state.bets = res.data;
      renderBetsTable(res.data);
      renderRecentMini(res.data);
    } catch (e) {
      console.error('Error cargando bets:', e);
    }
  }

  function renderBetsTable(bets) {
    const tbody = document.getElementById('bets-tbody');
    const countEl = document.getElementById('bets-count');
    if (!tbody) return;

    if (!bets.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="table-empty">No hay apuestas registradas</td></tr>';
      if (countEl) countEl.textContent = '0 apuestas';
      return;
    }

    if (countEl) countEl.textContent = `${bets.length} apuesta${bets.length !== 1 ? 's' : ''}`;

    tbody.innerHTML = bets.map(b => `
      <tr>
        <td class="mono" style="font-size:11px;color:var(--text-muted)">${b.bet_date || '—'}</td>
        <td>${gameTag(b.game)}</td>
        <td class="teams-cell">${escHtml(b.team1 || '?')} <span style="color:var(--text-muted)">vs</span> ${escHtml(b.team2 || '?')}</td>
        <td class="pick-cell">${escHtml(b.pick || '—')}</td>
        <td style="color:var(--text-muted);font-size:12px">${escHtml(b.bet_type || '—')}</td>
        <td class="odds-val">${b.odds ? b.odds.toFixed(2) : '—'}</td>
        <td class="mono">$${b.stake != null ? Number(b.stake).toFixed(2) : '—'}</td>
        <td class="mono">$${b.potential_win != null ? Number(b.potential_win).toFixed(2) : '—'}</td>
        <td>${plCell(b.profit_loss, b.status)}</td>
        <td>${statusBadge(b.status)}</td>
        <td>
          ${b.image_url ? `<button class="action-btn" onclick="App.showImage('${escHtml(b.image_url)}')" title="Ver ticket original">🖼️ Ver Ticket</button>` : '—'}
        </td>
      </tr>
    `).join('');
  }

  function renderRecentMini(bets) {
    const el = document.getElementById('recent-bets-mini');
    if (!el) return;
    const recent = bets.slice(0, 8);
    if (!recent.length) { el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px">Sin apuestas</div>'; return; }
    el.innerHTML = recent.map(b => `
      <div class="mini-bet">
        <div>
          <div class="mini-bet-teams">${escHtml(b.team1 || '?')} vs ${escHtml(b.team2 || '?')}</div>
          <div class="mini-bet-meta">${gameTag(b.game)} ${escHtml(b.bet_type || '')}</div>
        </div>
        ${statusBadge(b.status)}
      </div>
    `).join('');
  }

  // ── Analysis Charts ───────────────────────────────────────────────────────
  function renderAnalysisCharts() {
    if (!state.stats) return;
    const s = state.stats;
    if (s.cumulativeProfit) renderBankrollChart(s.cumulativeProfit, s.bankroll?.initial_capital || 0);
    if (s.byGame?.length) renderGameWinrateChart(s.byGame);
    if (s.byMarket?.length) renderMarketRoiChart(s.byMarket);
    if (state.bets.length) renderStakesChart(state.bets);
    renderDetailedStats(s);
  }

  function renderDetailedStats(s) {
    const el = document.getElementById('detailed-stats');
    if (!el) return;
    const rows = [
      ['Total apuestas', s.total],
      ['Ganadas ✅', s.won],
      ['Perdidas ❌', s.lost],
      ['Pendientes ⏳', s.pending],
      ['Void / Canceladas', s.void],
      ['Win Rate', `${s.winRate}%`],
      ['ROI', `${s.roi > 0 ? '+' : ''}${s.roi}%`],
      ['Total Apostado', `$${(s.totalStake || 0).toFixed(2)}`],
      ['Profit/Loss Total', `${s.totalProfit >= 0 ? '+' : ''}$${(s.totalProfit || 0).toFixed(2)}`],
      ['Racha actual', `${s.streak?.count || 0} ${s.streak?.type === 'won' ? '🔥 victorias' : s.streak?.type === 'lost' ? '❄️ derrotas' : '—'}`],
    ];
    el.innerHTML = `<table>
      <thead><tr><th>Métrica</th><th>Valor</th></tr></thead>
      <tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td><strong>${v}</strong></td></tr>`).join('')}</tbody>
    </table>`;
  }

  // ── Filters ───────────────────────────────────────────────────────────────
  async function applyFilters() {
    const filters = {};
    const game = document.getElementById('filter-game')?.value;
    const status = document.getElementById('filter-status')?.value;
    const from = document.getElementById('filter-from')?.value;
    const to = document.getElementById('filter-to')?.value;
    const search = document.getElementById('filter-search')?.value;
    if (game) filters.game = game;
    if (status) filters.status = status;
    if (from) filters.dateFrom = from;
    if (to) filters.dateTo = to;
    if (search) filters.search = search;
    await loadBets(filters);
  }

  // ── Bet Modal ─────────────────────────────────────────────────────────────
  function showAddBetModal() {
    state.editingBetId = null;
    document.getElementById('modal-title').textContent = 'Nueva Apuesta';
    document.getElementById('bet-form').reset();
    document.getElementById('edit-bet-id').value = '';
    document.getElementById('bet-form').querySelector('[name=bet_date]').value = new Date().toISOString().split('T')[0];
    openModal('bet-modal');
  }

  async function editBet(id) {
    const res = await API.get(`/api/bets/${id}`);
    if (!res.success) return toast('Error cargando apuesta', 'error');
    const b = res.data;
    state.editingBetId = id;

    document.getElementById('modal-title').textContent = 'Editar Apuesta';
    const form = document.getElementById('bet-form');
    form.reset();
    document.getElementById('edit-bet-id').value = id;

    const fields = ['game','status','team1','team2','pick','bet_type','odds','stake','potential_win','platform','bet_date','match_date','tournament','notes'];
    fields.forEach(f => {
      const el = form.querySelector(`[name=${f}]`);
      if (el && b[f] != null) el.value = b[f];
    });
    openModal('bet-modal');
  }

  async function saveBet(e) {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form));
    const id = data.id;
    delete data.id;

    // Auto-calc potential_win
    if (data.odds && data.stake && !data.potential_win) {
      data.potential_win = (parseFloat(data.odds) * parseFloat(data.stake)).toFixed(2);
    }

    try {
      if (id) {
        await API.put(`/api/bets/${id}`, data);
        toast('Apuesta actualizada ✅', 'success');
      } else {
        await API.post('/api/bets', data);
        toast('Apuesta guardada ✅', 'success');
      }
      closeBetModal();
      await loadAll();
    } catch (err) {
      toast('Error guardando apuesta', 'error');
    }
  }

  async function deleteBet(id) {
    if (!confirm('¿Eliminar esta apuesta?')) return;
    const res = await API.delete(`/api/bets/${id}`);
    if (res.success) { toast('Apuesta eliminada', 'info'); await loadAll(); }
    else toast('Error al eliminar', 'error');
  }

  // ── Verification ──────────────────────────────────────────────────────────
  async function verifyOne(id) {
    showLoading('Verificando apuesta...');
    try {
      const res = await API.post(`/api/verify/${id}`, {});
      hideLoading();
      if (res.result?.verified) {
        toast(`Resultado: ${res.result.status === 'won' ? '✅ Ganada' : '❌ Perdida'}`, 'success');
      } else {
        toast(`No verificado: ${res.result?.reason || 'Sin datos'}`, 'warning');
      }
      await loadAll();
    } catch (err) {
      hideLoading();
      toast('Error verificando', 'error');
    }
  }

  async function verifyAll() {
    showLoading('Verificando todas las apuestas pendientes...');
    try {
      const res = await API.post('/api/verify/all', {});
      hideLoading();
      toast(`Verificadas: ${res.results?.verified || 0} | Fallidas: ${res.results?.failed || 0}`, 'info');
      await loadAll();
    } catch (err) {
      hideLoading();
      toast('Error en verificación', 'error');
    }
  }

  // ── Sync ──────────────────────────────────────────────────────────────────
  async function syncTelegram() {
    const limit = parseInt(document.getElementById('sync-limit')?.value || '30');
    const btn = document.getElementById('sync-telegram-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Sincronizando...'; }

    logActivity('🔄 Iniciando sincronización del canal @PapitaBET...', 'info');
    updateSyncLog('Conectando al canal...');

    try {
      const res = await API.post('/api/sync/telegram', { limit });
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Sincronizar Canal'; }

      if (res.success) {
        logActivity(`✅ Sync completado: ${res.messages_found} mensajes, ${res.bets_processed} apuestas procesadas`, 'success');
        updateSyncLog(`✅ Completado: ${res.bets_processed} apuestas nuevas`);
        toast(`Sync OK: ${res.bets_processed} apuestas`, 'success');
        await loadAll();
      } else {
        logActivity(`❌ Error: ${res.error}`, 'error');
        updateSyncLog(`❌ Error: ${res.error}`);
        toast(res.error || 'Error sincronizando', 'error');
      }
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Sincronizar Canal'; }
      logActivity(`❌ Error de red: ${err.message}`, 'error');
      toast('Error de conexión', 'error');
    }
  }

  async function quickSync() {
    const btn = document.getElementById('quick-sync-btn');
    if (btn) { btn.disabled = true; }
    try {
      const res = await API.post('/api/sync/telegram', { limit: 10 });
      if (res.success) toast(`Sync rápido: ${res.bets_processed} nuevas`, 'success');
      else toast(res.error || 'Error', 'error');
      await loadAll();
    } catch (e) {
      toast('Error de conexión', 'error');
    }
    if (btn) { btn.disabled = false; }
  }

  // ── File Upload ───────────────────────────────────────────────────────────
  async function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    await processFiles(files);
  }

  function handleDrop(e) {
    e.preventDefault();
    document.getElementById('upload-zone')?.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    processFiles(files);
  }

  function handleDragOver(e) {
    e.preventDefault();
    document.getElementById('upload-zone')?.classList.add('drag-over');
  }

  function handleDragLeave(e) {
    document.getElementById('upload-zone')?.classList.remove('drag-over');
  }

  async function processFiles(files) {
    const queue = document.getElementById('upload-queue');
    for (const file of files) {
      const itemEl = document.createElement('div');
      itemEl.className = 'upload-item';
      itemEl.innerHTML = `<span class="upload-item-name">📸 ${escHtml(file.name)}</span><span class="upload-item-status">⏳</span>`;
      queue?.appendChild(itemEl);

      logActivity(`📤 Procesando: ${file.name}`, 'info');

      try {
        const formData = new FormData();
        formData.append('image', file);
        const res = await API.uploadFile('/api/process/image', formData);
        
        const status = itemEl.querySelector('.upload-item-status');
        if (res.success) {
          if (status) status.textContent = '✅';
          logActivity(`✅ ${file.name} → ${res.data?.team1 || '?'} vs ${res.data?.team2 || '?'} (${res.data?.game || '?'}) — Confianza: ${res.confidence || '?'}%`, 'success');
          toast(`Apuesta detectada: ${res.data?.pick || 'Procesada'}`, 'success');
        } else {
          if (status) status.textContent = '❌';
          logActivity(`❌ Error procesando ${file.name}: ${res.error}`, 'error');
        }
      } catch (err) {
        const status = itemEl.querySelector('.upload-item-status');
        if (status) status.textContent = '❌';
        logActivity(`❌ Error: ${err.message}`, 'error');
      }
    }
    await loadAll();
  }

  // ── Bankroll ──────────────────────────────────────────────────────────────
  function setupBankrollClick() {
    document.getElementById('bankroll-widget')?.addEventListener('click', showBankrollModal);
  }

  function showBankrollModal() {
    if (state.bankroll) {
      const ic = document.getElementById('initial-capital');
      const cc = document.getElementById('current-capital');
      if (ic) ic.value = state.bankroll.initial_capital || 0;
      if (cc) cc.value = state.bankroll.current_capital || 0;
    }
    openModal('bankroll-modal');
  }

  async function saveBankroll(e) {
    e.preventDefault();
    const initial = parseFloat(document.getElementById('initial-capital').value || '0');
    const current = parseFloat(document.getElementById('current-capital').value || '0');
    const res = await API.put('/api/bankroll', { initial_capital: initial, current_capital: current });
    if (res.success) { toast('Bankroll actualizado ✅', 'success'); closeBankrollModal(); await loadStats(); }
    else toast('Error', 'error');
  }

  function closeBankrollModal(e) {
    if (e && e.target !== document.getElementById('bankroll-modal')) return;
    closeModal2('bankroll-modal');
  }

  // ── Image Viewer ──────────────────────────────────────────────────────────
  function showImage(url) {
    const img = document.createElement('img');
    img.src = url;
    img.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.8)';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:pointer';
    overlay.appendChild(img);
    overlay.onclick = () => document.body.removeChild(overlay);
    document.body.appendChild(overlay);
  }

  // ── Export ────────────────────────────────────────────────────────────────
  function exportExcel() {
    toast('Generando Excel...', 'info');
    API.downloadUrl('/api/export/excel');
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────
  function setupWebSocket() {
    const wsUrl = `ws://${location.host}/ws`;
    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => updateWsStatus('connected');
    state.ws.onclose = () => { updateWsStatus('error'); setTimeout(setupWebSocket, 3000); };
    state.ws.onerror = () => updateWsStatus('error');

    state.ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      switch (msg.event) {
        case 'bet_added':
        case 'bet_updated':
        case 'bet_deleted':
        case 'bet_verified':
          await loadAll();
          break;
        case 'processing_image':
          logActivity(`🤖 Gemini analizando imagen msg #${msg.data.msg_id || '?'}...`, 'info');
          break;
        case 'bet_processed':
          logActivity(`✅ Apuesta #${msg.data.bet_id} procesada`, 'success');
          break;
        case 'sync_started':
          logActivity('🔄 Sync iniciado...', 'info');
          break;
        case 'sync_done':
          logActivity(`✅ Sync completo: ${msg.data.messages} mensajes, ${msg.data.processed} apuestas`, 'success');
          break;
        case 'verification_started':
          logActivity('🔍 Verificando apuestas pendientes...', 'info');
          break;
        case 'verification_done':
          logActivity(`✅ Verificación completa: ${msg.data.verified} OK, ${msg.data.failed} fallidas`, 'success');
          break;
      }
    };
  }

  function updateWsStatus(status) {
    const dot = document.querySelector('.ws-dot');
    const txt = document.querySelector('.ws-text');
    if (!dot || !txt) return;
    dot.className = 'ws-dot ' + status;
    txt.textContent = status === 'connected' ? 'Conectado' : status === 'error' ? 'Desconectado' : 'Conectando...';
  }

  // ── Odds Auto-calculator ──────────────────────────────────────────────────
  function setupOddsCalculator() {
    const form = document.getElementById('bet-form');
    if (!form) return;
    const oddsInput = form.querySelector('[name=odds]');
    const stakeInput = form.querySelector('[name=stake]');
    const winInput = document.getElementById('potential-win-input');
    const calc = () => {
      const odds = parseFloat(oddsInput?.value);
      const stake = parseFloat(stakeInput?.value);
      if (odds > 0 && stake > 0 && winInput) {
        winInput.value = (odds * stake).toFixed(2);
      }
    };
    oddsInput?.addEventListener('input', calc);
    stakeInput?.addEventListener('input', calc);
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────
  function openModal(id) {
    document.getElementById(id)?.classList.add('open');
  }
  function closeModal(e) {
    if (e.target.classList.contains('modal-overlay')) {
      e.target.classList.remove('open');
    }
  }
  function closeModal2(id) {
    document.getElementById(id)?.classList.remove('open');
  }
  function closeBetModal() {
    closeModal2('bet-modal');
  }

  // ── Activity log helpers ──────────────────────────────────────────────────
  function logActivity(msg, type = 'info') {
    const log = document.getElementById('activity-log');
    if (!log) return;
    const empty = log.querySelector('.activity-empty');
    if (empty) empty.remove();
    const time = new Date().toLocaleTimeString('es');
    const entry = document.createElement('div');
    entry.className = 'activity-entry';
    entry.innerHTML = `<span class="activity-time">${time}</span><span class="activity-msg ${type}">${escHtml(msg)}</span>`;
    log.insertBefore(entry, log.firstChild);
    if (log.children.length > 50) log.removeChild(log.lastChild);
  }

  function updateSyncLog(msg) {
    const el = document.getElementById('sync-log');
    if (el) el.textContent = msg;
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function toast(msg, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${icons[type] || ''}</span><span>${escHtml(msg)}</span>`;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-out');
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, duration);
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  function showLoading(msg = 'Procesando...') {
    const el = document.getElementById('loading-overlay');
    const txt = document.getElementById('loading-text');
    if (el) { el.style.display = 'flex'; }
    if (txt) txt.textContent = msg;
  }
  function hideLoading() {
    const el = document.getElementById('loading-overlay');
    if (el) el.style.display = 'none';
  }

  // ── Formatters ────────────────────────────────────────────────────────────
  function statusBadge(status) {
    const map = {
      won: '<span class="status-badge status-won">✅ Ganada</span>',
      lost: '<span class="status-badge status-lost">❌ Perdida</span>',
      pending: '<span class="status-badge status-pending">⏳ Pendiente</span>',
      void: '<span class="status-badge status-void">🔵 Void</span>',
      cancelled: '<span class="status-badge status-void">⚫ Cancelada</span>',
    };
    return map[status] || `<span class="status-badge">${status || '?'}</span>`;
  }

  function gameTag(game) {
    const map = {
      CS2: '<span class="game-badge game-cs2">CS2</span>',
      Dota2: '<span class="game-badge game-dota2">Dota2</span>',
    };
    return map[game] || `<span class="game-badge game-other">${game || '?'}</span>`;
  }

  function plCell(pl, status) {
    if (status === 'pending') return '<span class="pl-zero">—</span>';
    if (pl == null) return '<span class="pl-zero">—</span>';
    const n = parseFloat(pl);
    if (n > 0) return `<span class="pl-positive">+$${n.toFixed(2)}</span>`;
    if (n < 0) return `<span class="pl-negative">-$${Math.abs(n).toFixed(2)}</span>`;
    return `<span class="pl-zero">$0.00</span>`;
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    init,
    navigateTo,
    applyFilters,
    showAddBetModal,
    editBet,
    saveBet,
    deleteBet,
    verifyOne,
    verifyAll,
    syncTelegram,
    quickSync,
    handleFileSelect,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    processFiles,
    showBankrollModal,
    saveBankroll,
    closeBankrollModal,
    closeBetModal,
    closeModal,
    exportExcel,
    showImage,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
