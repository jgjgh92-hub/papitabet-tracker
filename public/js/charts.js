// ─── Charts Manager ───────────────────────────────────────────────────────────

const CHART_DEFAULTS = {
  color: {
    won: '#10b981',
    lost: '#ef4444',
    pending: '#f59e0b',
    void: '#6366f1',
    accent: '#7c3aed',
    accent2: '#06b6d4',
    cs2: '#e8a53a',
    dota: '#c23b22',
    grid: 'rgba(255,255,255,0.05)',
    text: '#8b8fa8',
  }
};

Chart.defaults.color = CHART_DEFAULTS.color.text;
Chart.defaults.borderColor = CHART_DEFAULTS.color.grid;
Chart.defaults.font.family = "'Inter', sans-serif";

const charts = {};

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

// ── Profit Acumulado (línea) ────────────────────────────────────────────────
function renderProfitChart(data) {
  destroyChart('profit');
  const ctx = document.getElementById('chart-profit');
  if (!ctx) return;

  const labels = data.map(d => d.date);
  const values = data.map(d => d.profit);

  charts.profit = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Profit Acumulado',
        data: values,
        borderColor: CHART_DEFAULTS.color.accent,
        backgroundColor: (ctx) => {
          const grad = ctx.chart.ctx.createLinearGradient(0, 0, 0, 300);
          grad.addColorStop(0, 'rgba(124,58,237,0.25)');
          grad.addColorStop(1, 'rgba(124,58,237,0)');
          return grad;
        },
        fill: true,
        tension: 0.4,
        pointBackgroundColor: values.map(v => v >= 0 ? CHART_DEFAULTS.color.won : CHART_DEFAULTS.color.lost),
        pointBorderColor: 'transparent',
        pointRadius: 4,
        pointHoverRadius: 6,
      }]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.parsed.y >= 0 ? '+' : ''}$${ctx.parsed.y.toFixed(2)}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
        y: {
          grid: { color: CHART_DEFAULTS.color.grid },
          ticks: { callback: v => `$${v}` }
        }
      }
    }
  });
}

// ── Win/Loss donut ──────────────────────────────────────────────────────────
function renderWLChart(won, lost, pending) {
  destroyChart('wl');
  const ctx = document.getElementById('chart-wl');
  if (!ctx) return;

  charts.wl = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Ganadas', 'Perdidas', 'Pendientes'],
      datasets: [{
        data: [won, lost, pending],
        backgroundColor: [
          CHART_DEFAULTS.color.won,
          CHART_DEFAULTS.color.lost,
          CHART_DEFAULTS.color.pending,
        ],
        borderWidth: 0,
        hoverOffset: 6,
      }]
    },
    options: {
      responsive: true,
      cutout: '72%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed}` }
        }
      }
    }
  });
}

// ── Por Juego (barras) ──────────────────────────────────────────────────────
function renderByGameChart(data) {
  destroyChart('by-game');
  const ctx = document.getElementById('chart-by-game');
  if (!ctx) return;

  const labels = data.map(d => d.game);
  charts['by-game'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Ganadas', data: data.map(d => d.won), backgroundColor: CHART_DEFAULTS.color.won + 'cc' },
        { label: 'Perdidas', data: data.map(d => d.lost), backgroundColor: CHART_DEFAULTS.color.lost + 'cc' },
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { grid: { display: false }, stacked: false },
        y: { grid: { color: CHART_DEFAULTS.color.grid }, ticks: { stepSize: 1 } }
      }
    }
  });
}

// ── Por Mercado (barras horizontales) ──────────────────────────────────────
function renderByMarketChart(data) {
  destroyChart('by-market');
  const ctx = document.getElementById('chart-by-market');
  if (!ctx) return;

  const sorted = [...data].sort((a, b) => b.total - a.total).slice(0, 6);
  charts['by-market'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(d => d.bet_type || 'Otro'),
      datasets: [
        { label: 'Ganadas', data: sorted.map(d => d.won), backgroundColor: CHART_DEFAULTS.color.won + 'cc' },
        { label: 'Perdidas', data: sorted.map(d => d.lost), backgroundColor: CHART_DEFAULTS.color.lost + 'cc' },
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { grid: { color: CHART_DEFAULTS.color.grid }, stacked: false },
        y: { grid: { display: false } }
      }
    }
  });
}

// ── Win Rate por Juego (análisis) ───────────────────────────────────────────
function renderGameWinrateChart(data) {
  destroyChart('game-wr');
  const ctx = document.getElementById('chart-game-wr');
  if (!ctx) return;

  const labels = data.map(d => d.game);
  const winrates = data.map(d => (d.won + d.lost) > 0 ? ((d.won / (d.won + d.lost)) * 100).toFixed(1) : 0);

  charts['game-wr'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Win Rate %',
        data: winrates,
        backgroundColor: labels.map(l => l === 'CS2' ? CHART_DEFAULTS.color.cs2 + 'cc' : CHART_DEFAULTS.color.dota + 'cc'),
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: CHART_DEFAULTS.color.grid }, max: 100, ticks: { callback: v => v + '%' } }
      }
    }
  });
}

// ── ROI por Mercado ─────────────────────────────────────────────────────────
function renderMarketRoiChart(data) {
  destroyChart('market-roi');
  const ctx = document.getElementById('chart-market-roi');
  if (!ctx) return;

  const sorted = [...data].sort((a, b) => b.total - a.total).slice(0, 6);
  const winrates = sorted.map(d => (d.won + d.lost) > 0 ? ((d.won / (d.won + d.lost)) * 100).toFixed(1) : 0);

  charts['market-roi'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(d => d.bet_type || 'Otro'),
      datasets: [{
        label: 'Win Rate %',
        data: winrates,
        backgroundColor: CHART_DEFAULTS.color.accent + 'cc',
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: CHART_DEFAULTS.color.grid }, max: 100, ticks: { callback: v => v + '%' } },
        y: { grid: { display: false } }
      }
    }
  });
}

// ── Bankroll Evolution ──────────────────────────────────────────────────────
function renderBankrollChart(data, initial) {
  destroyChart('bankroll');
  const ctx = document.getElementById('chart-bankroll');
  if (!ctx) return;

  const fullData = [{ date: 'Inicio', profit: initial || 0 }, ...data.map(d => ({
    date: d.date,
    profit: (initial || 0) + d.profit,
  }))];

  charts.bankroll = new Chart(ctx, {
    type: 'line',
    data: {
      labels: fullData.map(d => d.date),
      datasets: [{
        label: 'Bankroll ($)',
        data: fullData.map(d => d.profit),
        borderColor: CHART_DEFAULTS.color.accent2,
        backgroundColor: (ctx) => {
          const grad = ctx.chart.ctx.createLinearGradient(0, 0, 0, 300);
          grad.addColorStop(0, 'rgba(6,182,212,0.2)');
          grad.addColorStop(1, 'rgba(6,182,212,0)');
          return grad;
        },
        fill: true,
        tension: 0.4,
        pointRadius: 3,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` $${ctx.parsed.y.toFixed(2)}` } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
        y: { grid: { color: CHART_DEFAULTS.color.grid }, ticks: { callback: v => `$${v}` } }
      }
    }
  });
}

// ── Stakes Bar ─────────────────────────────────────────────────────────────
function renderStakesChart(bets) {
  destroyChart('stakes');
  const ctx = document.getElementById('chart-stakes');
  if (!ctx) return;

  const last20 = bets.slice(0, 20).reverse();
  charts.stakes = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: last20.map(b => `${b.team1 || '?'} vs ${b.team2 || '?'}`.substring(0, 15) + '...'),
      datasets: [{
        label: 'Stake',
        data: last20.map(b => b.stake || 0),
        backgroundColor: last20.map(b =>
          b.status === 'won' ? CHART_DEFAULTS.color.won + 'cc' :
          b.status === 'lost' ? CHART_DEFAULTS.color.lost + 'cc' :
          CHART_DEFAULTS.color.pending + 'cc'
        ),
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 9 } } },
        y: { grid: { color: CHART_DEFAULTS.color.grid }, ticks: { callback: v => `$${v}` } }
      }
    }
  });
}
