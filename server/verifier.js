const { findMatch, determineResult } = require('./pandascore');
const { queries } = require('./db');

/**
 * Verifica el resultado de una apuesta buscando en PandaScore
 * @param {object} bet - Apuesta de la DB
 * @returns {object} - { status, source, match }
 */
async function verifyBet(bet) {
  if (!bet.team1 || !bet.team2) {
    return { verified: false, reason: 'Faltan datos de equipos' };
  }

  if (!['CS2', 'Dota2'].includes(bet.game)) {
    return { verified: false, reason: 'Juego no soportado para verificación automática' };
  }

  console.log(`🔍 Verificando: ${bet.team1} vs ${bet.team2} (${bet.game}) - ${bet.match_date || bet.bet_date}`);

  const { found, match, error } = await findMatch(
    bet.team1, bet.team2, bet.game, bet.match_date || bet.bet_date
  );

  if (!found) {
    return {
      verified: false,
      reason: error ? `Error PandaScore: ${error}` : 'Partido no encontrado en PandaScore',
    };
  }

  const status = determineResult(match, bet);
  
  if (!status) {
    return {
      verified: false,
      reason: 'No se pudo determinar el resultado del mercado apostado',
      match,
    };
  }

  return {
    verified: true,
    status,
    source: 'pandascore',
    match: {
      id: match.id,
      name: match.name,
      tournament: match.league?.name,
      begin_at: match.begin_at,
      winner: match.winner?.name,
      score: match.results?.map(r => `${r.team_id}: ${r.score}`).join(' - '),
    },
  };
}

/**
 * Verifica todas las apuestas pendientes
 * @returns {object} - Resumen de verificaciones
 */
async function verifyAllPending() {
  const pending = await queries.getPendingBets();
  console.log(`📋 Verificando ${pending.length} apuestas pendientes...`);

  const results = { verified: 0, failed: 0, errors: [] };

  for (const bet of pending) {
    try {
      const result = await verifyBet(bet);
      
      if (result.verified && result.status) {
        const profit_loss = result.status === 'won'
          ? parseFloat(((bet.potential_win || 0) - (bet.stake || 0)).toFixed(2))
          : result.status === 'lost'
          ? -parseFloat((bet.stake || 0).toFixed(2))
          : null;

        await queries.updateBet(bet.id, {
          status: result.status,
          verified: 1,
          verified_at: new Date().toISOString(),
          verification_source: result.source,
          profit_loss,
          notes: result.match ? JSON.stringify(result.match) : null,
        });
        results.verified++;
        console.log(`  ✅ Bet #${bet.id}: ${result.status.toUpperCase()}`);
      } else {
        results.failed++;
        results.errors.push({ bet_id: bet.id, reason: result.reason });
        console.log(`  ⚠️ Bet #${bet.id}: ${result.reason}`);
      }

      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      results.failed++;
      results.errors.push({ bet_id: bet.id, reason: err.message });
      console.error(`  ❌ Bet #${bet.id}: ${err.message}`);
    }
  }

  console.log(`✅ Verificación completa: ${results.verified} verificadas, ${results.failed} fallidas`);
  return results;
}

module.exports = { verifyBet, verifyAllPending };
