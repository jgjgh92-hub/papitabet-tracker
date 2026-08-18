const XLSX = require('xlsx');
const path = require('path');

/**
 * Exporta las apuestas a un archivo Excel con formato profesional
 * @param {Array} bets - Lista de apuestas
 * @param {object} stats - Estadísticas generales
 * @returns {string} - Ruta del archivo generado
 */
function exportToExcel(bets, stats) {
  const wb = XLSX.utils.book_new();

  // ─── Hoja 1: Todas las apuestas ────────────────────────────────────────────
  const betsData = bets.map(b => ({
    'ID': b.id,
    'Fecha Apuesta': b.bet_date || '',
    'Fecha Partido': b.match_date || '',
    'Juego': b.game || '',
    'Equipo 1': b.team1 || '',
    'Equipo 2': b.team2 || '',
    'Pick': b.pick || '',
    'Mercado': b.bet_type || '',
    'Cuota': b.odds || '',
    'Stake': b.stake || 0,
    'Ganancia Potencial': b.potential_win || 0,
    'Profit/Loss': b.profit_loss || 0,
    'Estado': translateStatus(b.status),
    'Plataforma': b.platform || '',
    'Torneo': b.tournament || '',
    'Verificado': b.verified ? 'Sí' : 'No',
    'Fuente Verificación': b.verification_source || '',
    'Notas': b.notes || '',
  }));

  const wsBets = XLSX.utils.json_to_sheet(betsData);

  // Ajustar anchos de columna
  wsBets['!cols'] = [
    { wch: 5 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 20 },
    { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 8 }, { wch: 10 },
    { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 25 },
    { wch: 10 }, { wch: 18 }, { wch: 30 },
  ];

  XLSX.utils.book_append_sheet(wb, wsBets, '📋 Todas las Apuestas');

  // ─── Hoja 2: Resumen estadísticas ──────────────────────────────────────────
  const summaryData = [
    ['', ''],
    ['  📊 RESUMEN PAPITABET TRACKER', ''],
    ['', ''],
    ['  Total Apuestas', stats.total],
    ['  Ganadas ✅', stats.won],
    ['  Perdidas ❌', stats.lost],
    ['  Pendientes ⏳', stats.pending],
    ['  Void / Canceladas', stats.void],
    ['', ''],
    ['  Win Rate', `${stats.winRate}%`],
    ['  ROI', `${stats.roi}%`],
    ['  Total Apostado', stats.totalStake],
    ['  Profit/Loss Total', stats.totalProfit],
    ['', ''],
    ['  RACHA ACTUAL', `${stats.streak?.count || 0} ${translateStatus(stats.streak?.type || '')}`],
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 25 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, '📈 Resumen');

  // ─── Hoja 3: Por juego ─────────────────────────────────────────────────────
  if (stats.byGame?.length > 0) {
    const gameData = stats.byGame.map(g => ({
      'Juego': g.game,
      'Total': g.total,
      'Ganadas': g.won,
      'Perdidas': g.lost,
      'Win Rate': g.total > 0 ? `${((g.won / (g.won + g.lost)) * 100 || 0).toFixed(1)}%` : '0%',
      'Profit': parseFloat((g.profit || 0).toFixed(2)),
    }));
    const wsGame = XLSX.utils.json_to_sheet(gameData);
    wsGame['!cols'] = [{ wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsGame, '🎮 Por Juego');
  }

  // ─── Hoja 4: Por mercado ───────────────────────────────────────────────────
  if (stats.byMarket?.length > 0) {
    const marketData = stats.byMarket.map(m => ({
      'Mercado': m.bet_type,
      'Total': m.total,
      'Ganadas': m.won,
      'Perdidas': m.lost,
      'Win Rate': (m.won + m.lost) > 0 ? `${((m.won / (m.won + m.lost)) * 100).toFixed(1)}%` : '0%',
    }));
    const wsMarket = XLSX.utils.json_to_sheet(marketData);
    wsMarket['!cols'] = [{ wch: 18 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsMarket, '🎯 Por Mercado');
  }

  // ─── Hoja 5: Profit acumulado ──────────────────────────────────────────────
  if (stats.cumulativeProfit?.length > 0) {
    const profitData = stats.cumulativeProfit.map(d => ({
      'Fecha': d.date,
      'Profit Acumulado': d.profit,
    }));
    const wsProfit = XLSX.utils.json_to_sheet(profitData);
    wsProfit['!cols'] = [{ wch: 12 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsProfit, '📉 Profit Diario');
  }

  // Guardar archivo
  const outputPath = path.join(__dirname, '..', 'data', `papitabet_${new Date().toISOString().split('T')[0]}.xlsx`);
  XLSX.writeFile(wb, outputPath);
  return outputPath;
}

function translateStatus(s) {
  const map = { won: '✅ Ganada', lost: '❌ Perdida', pending: '⏳ Pendiente', void: '🔵 Void', cancelled: '⚫ Cancelada' };
  return map[s] || s || '';
}

module.exports = { exportToExcel };
