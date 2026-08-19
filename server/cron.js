const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { syncChannel } = require('./telegram');
const { analyzeBetImage, isDailyQuotaExhausted } = require('./gemini');
const { verifyAllPending } = require('./verifier');
const { exportToExcel } = require('./excel');
const { queries } = require('./db');

let isJobRunning = false;

/**
 * Limpieza automática de almacenamiento:
 * Elimina imágenes con más de 30 días de antigüedad para que el disco nunca se llene.
 */
function cleanOldImages(maxDays = 30) {
  const imagesDir = path.join(__dirname, '..', 'data', 'images');
  if (!fs.existsSync(imagesDir)) return;

  const now = Date.now();
  const maxAgeMs = maxDays * 24 * 60 * 60 * 1000;
  let deletedCount = 0;

  try {
    const files = fs.readdirSync(imagesDir);
    for (const file of files) {
      const filePath = path.join(imagesDir, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      console.log(`🧹 [LIMPIEZA DE DISCO] Se eliminaron ${deletedCount} imágenes antiguas (> ${maxDays} días).`);
    }
  } catch (e) {
    console.error('Error en limpieza de imágenes:', e.message);
  }
}

/**
 * Ciclo de sincronización y lectura de capturas desde Telegram.
 * Revisa SOLO mensajes nuevos nunca antes analizados.
 */
async function runTelegramSyncCycle() {
  if (isJobRunning) return;

  if (isDailyQuotaExhausted()) {
    console.log('⛔ [AUTO-SYNC] Cuota diaria de Gemini agotada. Esperando reset...');
    return;
  }

  isJobRunning = true;
  console.log('\n📡 [AUTO-SYNC] Buscando nuevas capturas en @PapitaBET...');

  try {
    // Obtener todos los IDs de mensajes ya procesados (aprobados o rechazados)
    const processedIds = await queries.getProcessedMessageIds();

    const { success, messages } = await syncChannel(20, processedIds);

    if (!success || messages.length === 0) {
      console.log('📡 [AUTO-SYNC] Sin capturas nuevas por analizar.');
      return;
    }

    console.log(`📸 [AUTO-SYNC] ${messages.length} imagen(es) nueva(s) nunca antes analizada(s).`);

    const msg = messages[0];
    console.log(`🤖 [AUTO-SYNC] Analizando imagen msg #${msg.telegram_msg_id} con Gemini AI (1 sola vez)...`);

    const geminiResult = await analyzeBetImage(msg.image_path);

    if (geminiResult.quota_exhausted) {
      console.log('⛔ [AUTO-SYNC] Cuota diaria agotada. Se reintentará en el próximo ciclo.');
      return;
    }

    // Si NO es un ticket de apuesta (ej: foto de perfil, banner publicitario)
    if (geminiResult.is_valid_bet === false) {
      console.log(`🚫 [AUTO-SYNC] Omitiendo msg #${msg.telegram_msg_id}: ${geminiResult.reason || 'No es un ticket'}`);
      // Marcar como procesado para NUNCA volver a gastar peticiones en esta misma foto
      await queries.markMessageProcessed(msg.telegram_msg_id, 0);
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
      status: 'pending',
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
 * Ciclo de verificación de partidos en PandaScore - CADA 1 HORA
 * SOLO verifica si existen apuestas con estado 'pending'
 */
async function runMatchVerificationCycle() {
  const pending = await queries.getPendingBets();
  if (!pending.length) {
    console.log('⏳ [AUTO-VERIFIER] 0 apuestas pendientes. Omitiendo consulta a PandaScore.');
    return;
  }

  console.log(`\n🔍 [AUTO-VERIFIER] Verificando ${pending.length} apuesta(s) pendiente(s) en PandaScore...`);
  try {
    const results = await verifyAllPending();

    if (results.verified > 0) {
      console.log(`🎯 [AUTO-VERIFIER] ${results.verified} apuesta(s) resueltas (GANADA/PERDIDA).`);
      const currentBets = await queries.getBets();
      const stats = await queries.getStats();
      const excelPath = exportToExcel(currentBets, stats);
      console.log(`📊 [AUTO-VERIFIER] Excel actualizado: ${excelPath}`);
    }
  } catch (err) {
    console.error('❌ [AUTO-VERIFIER] Error:', err.message);
  }
}

/**
 * Inicializa las tareas programadas
 */
function startAutoCron() {
  console.log('\n⏰ Sistema de automatización activo:');
  console.log('   📡 Lectura de capturas: 1 imagen nueva cada 15 minutos');
  console.log('   🔍 Verificación de resultados: Cada 1 hora (solo si hay apuestas pendientes)');
  console.log('   🧹 Limpieza de almacenamiento: Automática a 30 días');

  setTimeout(runTelegramSyncCycle, 8000);
  setTimeout(runMatchVerificationCycle, 20000);
  setTimeout(cleanOldImages, 30000);

  cron.schedule('*/15 * * * *', runTelegramSyncCycle);
  cron.schedule('0 * * * *', runMatchVerificationCycle);
  cron.schedule('0 3 * * *', () => cleanOldImages(30));
}

module.exports = { startAutoCron, runTelegramSyncCycle, runMatchVerificationCycle, cleanOldImages };
