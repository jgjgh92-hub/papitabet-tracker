const cron = require('node-cron');
const { syncChannel } = require('./telegram');
const { analyzeBetImage, isDailyQuotaExhausted } = require('./gemini');
const { verifyAllPending } = require('./verifier');
const { exportToExcel } = require('./excel');
const { queries } = require('./db');

let isJobRunning = false;

/**
 * Ciclo de sincronización y lectura de capturas desde Telegram.
 * Procesa de a UNA imagen por ciclo para no saturar la cuota gratuita de Gemini.
 * El cron corre cada 15 minutos → máximo 4 imágenes/hora, bien bajo el límite diario de 1500 req/día.
 */
async function runTelegramSyncCycle() {
  if (isJobRunning) return;

  // Si la cuota diaria de Gemini está agotada, saltear el ciclo completo
  if (isDailyQuotaExhausted()) {
    console.log('⛔ [AUTO-SYNC] Cuota diaria de Gemini agotada. Esperando reset (cron reintentará en 1h).');
    return;
  }

  isJobRunning = true;
  console.log('\n📡 [AUTO-SYNC] Buscando nuevas capturas en @PapitaBET...');

  try {
    const allBets = await queries.getBets();
    const existingMsgIds = allBets.map(b => b.telegram_msg_id).filter(Boolean);

    const { success, messages } = await syncChannel(20, existingMsgIds);

    if (!success || messages.length === 0) {
      console.log('📡 [AUTO-SYNC] Sin capturas nuevas en el canal.');
      return;
    }

    console.log(`📸 [AUTO-SYNC] ${messages.length} imagen(es) nueva(s) encontrada(s). Procesando de a 1 para respetar la cuota...`);

    // Solo procesar 1 imagen por ciclo → 4/hora → ~96/día (muy por debajo del límite de 1500/día)
    const msg = messages[0];
    console.log(`🤖 [AUTO-SYNC] Analizando imagen msg #${msg.telegram_msg_id} con Gemini AI...`);

    const geminiResult = await analyzeBetImage(msg.image_path);

    // Si cuota diaria se agotó en esta petición, abortar
    if (geminiResult.quota_exhausted) {
      console.log('⛔ [AUTO-SYNC] Cuota diaria agotada durante el procesamiento. Se reintentará en el próximo ciclo horario.');
      return;
    }

    // Filtro: no es un boleto de apuesta real
    if (geminiResult.is_valid_bet === false) {
      console.log(`🚫 [AUTO-SYNC] Omitiendo msg #${msg.telegram_msg_id}: ${geminiResult.reason || 'No es un ticket'}`);
      return;
    }

    const betData = geminiResult.data;

    const betId = await queries.insertBet({
      telegram_msg_id: msg.telegram_msg_id,
      image_path: msg.image_path,
      image_url: msg.image_url,
      game: betData.game || 'Unknown',
      team1: betData.team1 || null,
      team2: betData.team2 || null,
      bet_type: betData.bet_type || null,
      pick: betData.pick || null,
      odds: betData.odds || null,
      stake: betData.stake || null,
      potential_win: betData.potential_win || null,
      bet_date: betData.bet_date || msg.date?.split('T')[0] || null,
      match_date: betData.match_date || null,
      platform: betData.platform || null,
      tournament: betData.tournament || null,
      status: 'pending', // Siempre pendiente al registrar
      raw_gemini_response: geminiResult.raw,
    });

    console.log(`  ✅ [NUEVA APUESTA #${betId}] ${betData.team1 || '?'} vs ${betData.team2 || '?'} | ${betData.game} | ${betData.pick} @ ${betData.odds} — ⏳ PENDIENTE`);

  } catch (err) {
    console.error('❌ [AUTO-SYNC] Error en ciclo:', err.message);
  } finally {
    isJobRunning = false;
  }
}

/**
 * Ciclo de verificación de partidos - CADA 1 HORA
 * Revisa en PandaScore si las partidas pendientes ya terminaron.
 */
async function runMatchVerificationCycle() {
  console.log('\n🔍 [AUTO-VERIFIER] Revisión horaria de partidos pendientes en PandaScore...');
  try {
    const results = await verifyAllPending();

    if (results.verified > 0) {
      console.log(`🎯 [AUTO-VERIFIER] ${results.verified} apuesta(s) resueltas automáticamente (GANADA/PERDIDA).`);
      // Actualizar Excel cuando se resuelven apuestas
      const currentBets = await queries.getBets();
      const stats = await queries.getStats();
      const excelPath = exportToExcel(currentBets, stats);
      console.log(`📊 [AUTO-VERIFIER] Excel actualizado: ${excelPath}`);
    } else {
      console.log('⏳ [AUTO-VERIFIER] Ninguna apuesta resuelta aún en este ciclo horario.');
    }
  } catch (err) {
    console.error('❌ [AUTO-VERIFIER] Error:', err.message);
  }
}

/**
 * Inicializa las tareas programadas del sistema automático
 */
function startAutoCron() {
  console.log('\n⏰ Sistema de automatización activo:');
  console.log('   📡 Lectura de capturas: 1 imagen cada 15 minutos (4/hora, ~96/día)');
  console.log('   🔍 Verificación de resultados: Cada 1 hora en PandaScore');

  // Ejecutar una primera vez a los 8 segundos de arrancar el servidor
  setTimeout(runTelegramSyncCycle, 8000);
  setTimeout(runMatchVerificationCycle, 20000);

  // Scanear el canal cada 15 minutos (UNA imagen por ciclo)
  cron.schedule('*/15 * * * *', runTelegramSyncCycle);

  // Verificar resultados cada hora exacta
  cron.schedule('0 * * * *', runMatchVerificationCycle);
}

module.exports = { startAutoCron, runTelegramSyncCycle, runMatchVerificationCycle };
