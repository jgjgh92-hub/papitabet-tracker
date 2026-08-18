require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { analyzeBetImage } = require('./server/gemini');
const { queries } = require('./server/db');
const { verifyAllPending } = require('./server/verifier');

async function syncAndVerifyLast5() {
  console.log('📡 Conectando con https://t.me/s/PapitaBET para obtener las últimas apuestas...');

  const res = await fetch('https://t.me/s/PapitaBET');
  const html = await res.text();

  const imgRegex = /https:\/\/cdn[0-9]*\.telesco\.pe\/file\/[a-zA-Z0-9_\-]+\.jpg/g;
  const allImages = [...new Set(html.match(imgRegex) || [])];

  console.log(`📸 Total de imágenes encontradas en el canal: ${allImages.length}`);

  // Tomar las últimas 5 imágenes del canal
  const last5 = allImages.slice(-5);
  console.log(`🔍 Procesando las últimas ${last5.length} capturas...`);

  const imgDir = path.join(__dirname, 'data', 'images');
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

  const processedBets = [];

  for (let i = 0; i < last5.length; i++) {
    const imgUrl = last5[i];
    const filename = `msg_last5_${i}_${Date.now()}.jpg`;
    const filepath = path.join(imgDir, filename);

    try {
      const imgRes = await fetch(imgUrl);
      const buffer = await imgRes.buffer();
      fs.writeFileSync(filepath, buffer);

      console.log(`\n🤖 [${i + 1}/${last5.length}] Analizando captura con Gemini Vision...`);
      const result = await analyzeBetImage(filepath);

      if (result.is_valid_bet && result.data && result.data.team1) {
        const betData = result.data;
        const betId = await queries.insertBet({
          telegram_msg_id: 8000 + i,
          image_path: filepath,
          image_url: `/images/${filename}`,
          game: betData.game || 'CS2',
          team1: betData.team1,
          team2: betData.team2,
          bet_type: betData.bet_type || 'Match Winner',
          pick: betData.pick || betData.team1,
          odds: betData.odds,
          stake: betData.stake,
          potential_win: betData.potential_win,
          bet_date: betData.bet_date || new Date().toISOString().split('T')[0],
          status: 'pending',
          raw_gemini_response: result.raw
        });

        console.log(`  ✅ Apuesta guardada #${betId}: ${betData.team1} vs ${betData.team2} (${betData.game}) | Pick: ${betData.pick} @ ${betData.odds}`);
        processedBets.push({ id: betId, ...betData });
      } else {
        console.log(`  🚫 Descartada: ${result.reason || 'No es un ticket de apuesta válido'}`);
      }

      // Pausa de 4 segundos para respetar el RPM
      await new Promise(r => setTimeout(r, 4000));
    } catch (e) {
      console.log(`  ❌ Error procesando imagen:`, e.message);
    }
  }

  console.log('\n🔍 Verificando resultados en PandaScore...');
  const verification = await verifyAllPending();
  console.log('Resultado de verificación PandaScore:', verification);

  const updatedBets = await queries.getBets();
  console.log('\n📋 RESUMEN_FINAL_JSON_START');
  console.log(JSON.stringify(updatedBets, null, 2));
  console.log('📋 RESUMEN_FINAL_JSON_END');
}

syncAndVerifyLast5();
