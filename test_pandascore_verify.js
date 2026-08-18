require('dotenv').config();
const { verifyAllPending, verifyBet } = require('./server/verifier');
const { queries } = require('./server/db');

async function testVerification() {
  console.log('📡 Conectando a la API de PandaScore con tu clave (5T59doXKnupF...)...');

  const pending = await queries.getPendingBets();
  console.log(`📋 Apuestas pendientes por verificar: ${pending.length}`);

  for (const bet of pending) {
    console.log(`\n🔍 Consultando PandaScore para Bet #${bet.id}: ${bet.team1} vs ${bet.team2} (${bet.game})...`);
    const result = await verifyBet(bet);
    console.log('  Resultado PandaScore:', JSON.stringify(result, null, 2));

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
      console.log(`  ✅ Apuesta #${bet.id} actualizada a: ${result.status.toUpperCase()} (P/L: ${profit_loss})`);
    }
  }

  const allBets = await queries.getBets();
  console.log('\n📊 Estado actualizado de todas las apuestas en la Base de Datos:');
  allBets.forEach(b => {
    console.log(`  - [ID #${b.id}] ${b.game} | ${b.team1} vs ${b.team2} | Pick: ${b.pick} | Estado: ${b.status.toUpperCase()} | P/L: ${b.profit_loss != null ? (b.profit_loss >= 0 ? '+' : '') + b.profit_loss : 'N/A'} | Fuente: ${b.verification_source || 'pendiente'}`);
  });
}

testVerification();
