require('dotenv').config();
const axios = require('axios');

const API_KEY = process.env.PANDASCORE_API_KEY;
const BASE_URL = 'https://api.pandascore.co';

const client = axios.create({
  baseURL: BASE_URL,
  headers: { Authorization: `Bearer ${API_KEY}` },
  timeout: 10000,
});

/**
 * Busca partidas de CS2 o Dota2 en PandaScore por equipos y fecha aproximada
 */
async function findMatch(team1, team2, game, dateStr) {
  const videogame = game === 'CS2' ? 'csgo' : 'dota2';
  const matchDate = dateStr ? new Date(dateStr) : new Date();

  // Rango de búsqueda: ±7 días
  const from = new Date(matchDate);
  from.setDate(from.getDate() - 7);
  const to = new Date(matchDate);
  to.setDate(to.getDate() + 7);

  const t1 = normalizeTeamName(team1);
  const t2 = normalizeTeamName(team2);

  try {
    // 1. Búsqueda por team1
    const resp1 = await client.get(`/${videogame}/matches`, {
      params: {
        'filter[status]': 'finished',
        'range[begin_at]': `${from.toISOString().split('T')[0]},${to.toISOString().split('T')[0]}`,
        'search[name]': team1,
        'page[size]': 30,
        sort: '-begin_at',
      },
    });

    for (const match of resp1.data) {
      const matchName = normalizeTeamName(match.name || '');
      const opponents = match.opponents?.map(o => normalizeTeamName(o.opponent?.name || '')) || [];
      
      const hasT1 = opponents.some(o => similarity(o, t1) > 0.6) || matchName.includes(t1);
      const hasT2 = opponents.some(o => similarity(o, t2) > 0.6) || matchName.includes(t2);

      if (hasT1 && hasT2) {
        return { found: true, match };
      }
    }

    // 2. Búsqueda por team2
    const resp2 = await client.get(`/${videogame}/matches`, {
      params: {
        'filter[status]': 'finished',
        'range[begin_at]': `${from.toISOString().split('T')[0]},${to.toISOString().split('T')[0]}`,
        'search[name]': team2,
        'page[size]': 30,
        sort: '-begin_at',
      },
    });

    for (const match of resp2.data) {
      const matchName = normalizeTeamName(match.name || '');
      const opponents = match.opponents?.map(o => normalizeTeamName(o.opponent?.name || '')) || [];

      const hasT1 = opponents.some(o => similarity(o, t1) > 0.6) || matchName.includes(t1);
      const hasT2 = opponents.some(o => similarity(o, t2) > 0.6) || matchName.includes(t2);

      if (hasT1 && hasT2) {
        return { found: true, match };
      }
    }

    return { found: false };
  } catch (err) {
    console.error('PandaScore error:', err.response?.data || err.message);
    return { found: false, error: err.message };
  }
}

/**
 * Determina el resultado de una apuesta basado en los datos de PandaScore
 */
function determineResult(match, bet) {
  if (!match || match.status !== 'finished') return null;

  const winner = match.winner;
  const pick = normalizeTeamName(bet.pick || '');

  // 1. Ganador del partido (Match Winner)
  if (bet.bet_type === 'Match Winner') {
    if (!winner) return null;
    const winnerName = normalizeTeamName(winner.name || '');
    if (similarity(winnerName, pick) > 0.6 || pick.includes(winnerName) || winnerName.includes(pick)) {
      return 'won';
    }
    return 'lost';
  }

  // 2. Ganador de Mapa específico (Map Winner / 1X2 G2 / First Map)
  if (bet.bet_type === 'Map Winner' || bet.bet_type === 'First Map' || (bet.pick && bet.pick.toLowerCase().includes('mapa'))) {
    // Detectar qué mapa se apostó (Mapa 1, Mapa 2, Mapa 3)
    let mapNumber = 1;
    const mapMatch = (bet.pick + ' ' + bet.bet_type).match(/mapa\s*([1-9])|([1-9])\s*mapa|map\s*([1-9])/i);
    if (mapMatch) {
      mapNumber = parseInt(mapMatch[1] || mapMatch[2] || mapMatch[3]);
    }

    if (match.games && match.games[mapNumber - 1]) {
      const mapGame = match.games[mapNumber - 1];
      const mapWinner = normalizeTeamName(mapGame.winner?.name || '');
      if (mapWinner && (similarity(mapWinner, pick) > 0.6 || pick.includes(mapWinner) || mapWinner.includes(pick))) {
        return 'won';
      }
      if (mapWinner) return 'lost';
    }
  }

  // 3. Total de Mapas (Over/Under)
  if (bet.bet_type === 'Total Maps') {
    const totalGames = match.number_of_games || match.games?.length || 0;
    const overMatch = pick.match(/over\s*([\d.]+)|más de\s*([\d.]+)/i);
    const underMatch = pick.match(/under\s*([\d.]+)|menos de\s*([\d.]+)/i);
    if (overMatch) return totalGames > parseFloat(overMatch[1] || overMatch[2]) ? 'won' : 'lost';
    if (underMatch) return totalGames < parseFloat(underMatch[1] || underMatch[2]) ? 'won' : 'lost';
  }

  return null;
}

/**
 * Obtiene partidas recientes para un juego
 */
async function getRecentMatches(game, limit = 10) {
  const videogame = game === 'CS2' ? 'csgo' : 'dota2';
  try {
    const resp = await client.get(`/${videogame}/matches`, {
      params: { 'filter[status]': 'finished', 'page[size]': limit, sort: '-begin_at' },
    });
    return resp.data;
  } catch (err) {
    return [];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeTeamName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const la = a.length, lb = b.length;
  const dp = Array.from({ length: la + 1 }, (_, i) => 
    Array.from({ length: lb + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return 1 - dp[la][lb] / Math.max(la, lb);
}

module.exports = { findMatch, determineResult, getRecentMatches };
