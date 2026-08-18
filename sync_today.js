require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { analyzeBetImage } = require('./server/gemini');
const { queries } = require('./server/db');

async function syncToday() {
  console.log('📡 Buscando capturas recientes en https://t.me/s/PapitaBET...');
  
  const res = await fetch('https://t.me/s/PapitaBET');
  const html = await res.text();

  const imgRegex = /https:\/\/cdn[0-9]*\.telesco\.pe\/file\/[a-zA-Z0-9_\-]+\.jpg/g;
  const images = [...new Set(html.match(imgRegex) || [])];

  console.log(`📸 Imágenes encontradas en el canal: ${images.length}`);
  let count = 0;

  const imgDir = path.join(__dirname, 'data', 'images');
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

  for (let i = 0; i < images.length; i++) {
    const imgUrl = images[i];
    const filename = `msg_today_${i}.jpg`;
    const filepath = path.join(imgDir, filename);

    try {
      const imgRes = await fetch(imgUrl);
      const buffer = await imgRes.buffer();
      fs.writeFileSync(filepath, buffer);

      console.log(`\n[${i + 1}/${images.length}] Analizando con Gemini Vision: ${filename}...`);
      const result = await analyzeBetImage(filepath);

      if (result.is_valid_bet && result.data && result.data.team1) {
        const id = await queries.insertBet({
          telegram_msg_id: 9500 + i,
          image_path: filepath,
          image_url: `/images/${filename}`,
          game: result.data.game || 'CS2',
          team1: result.data.team1,
          team2: result.data.team2,
          bet_type: result.data.bet_type || 'Match Winner',
          pick: result.data.pick || result.data.team1,
          odds: result.data.odds,
          stake: result.data.stake,
          potential_win: result.data.potential_win,
          bet_date: result.data.bet_date || new Date().toISOString().split('T')[0],
          status: 'pending',
          raw_gemini_response: result.raw
        });
        console.log(`  ✅ Apuesta registrada: ${result.data.team1} vs ${result.data.team2} (${result.data.game}) | Pick: ${result.data.pick} | ID #${id}`);
        count++;
      } else {
        console.log(`  🚫 Imagen rechazada (foto de perfil, logo o sin datos): ${result.reason || 'Sin equipos'}`);
      }

      await new Promise(r => setTimeout(r, 3500));
    } catch (e) {
      console.log(`  ❌ Error procesando imagen ${i}:`, e.message);
    }
  }

  console.log(`\n🎉 Finalizado: ${count} apuestas guardadas correctamente.`);
}

syncToday();
