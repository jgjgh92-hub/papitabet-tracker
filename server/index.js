require('dotenv').config();
const express = require('express');
const expressWs = require('express-ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const { queries } = require('./db');
const { analyzeBetImage, analyzeBetImageFromBase64 } = require('./gemini');
const { syncChannel } = require('./telegram');
const { verifyBet, verifyAllPending } = require('./verifier');
const { exportToExcel } = require('./excel');
const { startAutoCron, runAutomationCycle } = require('./cron');

const app = express();
expressWs(app);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Servir imágenes descargadas
const IMAGES_DIR = path.join(__dirname, '..', 'data', 'images');
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
app.use('/images', express.static(IMAGES_DIR));

// Servir frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// Multer para subida de imágenes
const storage = multer.diskStorage({
  destination: IMAGES_DIR,
  filename: (req, file, cb) => cb(null, `upload_${Date.now()}_${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// WebSocket para notificaciones en tiempo real
const wsClients = new Set();
app.ws('/ws', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
});

function broadcast(event, data) {
  const msg = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  wsClients.forEach(ws => { try { ws.send(msg); } catch (e) {} });
}

// ─── API Routes ────────────────────────────────────────────────────────────────

// GET /api/bets - Lista apuestas
app.get('/api/bets', async (req, res) => {
  try {
    const bets = await queries.getBets(req.query);
    res.json({ success: true, data: bets, count: bets.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/bets/:id - Detalle
app.get('/api/bets/:id', async (req, res) => {
  try {
    const bet = await queries.getBetById(req.params.id);
    if (!bet) return res.status(404).json({ success: false, error: 'Apuesta no encontrada' });
    res.json({ success: true, data: bet });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/bets - Crear apuesta manual
app.post('/api/bets', async (req, res) => {
  try {
    const id = await queries.insertBet(req.body);
    broadcast('bet_added', { id });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/bets/:id - Actualizar apuesta
app.put('/api/bets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['status','team1','team2','odds','stake','potential_win','pick','bet_type','game','notes','profit_loss','match_date','bet_date','tournament','platform'];
    const data = {};
    for (const key of allowed) { if (req.body[key] !== undefined) data[key] = req.body[key]; }
    
    if (data.status === 'won' && req.body.stake && req.body.potential_win) {
      data.profit_loss = parseFloat((req.body.potential_win - req.body.stake).toFixed(2));
    } else if (data.status === 'lost' && req.body.stake) {
      data.profit_loss = -parseFloat(req.body.stake);
    } else if (data.status === 'void') {
      data.profit_loss = 0;
    }

    await queries.updateBet(id, data);
    broadcast('bet_updated', { id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/bets/:id
app.delete('/api/bets/:id', async (req, res) => {
  try {
    await queries.deleteBet(req.params.id);
    broadcast('bet_deleted', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/stats - Estadísticas
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await queries.getStats();
    const bankroll = await queries.getBankroll();
    res.json({ success: true, data: { ...stats, bankroll } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/verify/:id - Verificar apuesta individual
app.post('/api/verify/:id', async (req, res) => {
  try {
    const bet = await queries.getBetById(req.params.id);
    if (!bet) return res.status(404).json({ success: false, error: 'Apuesta no encontrada' });

    const result = await verifyBet(bet);
    
    if (result.verified && result.status) {
      const profit_loss = result.status === 'won'
        ? parseFloat(((bet.potential_win || 0) - (bet.stake || 0)).toFixed(2))
        : result.status === 'lost' ? -parseFloat((bet.stake || 0).toFixed(2)) : 0;

      await queries.updateBet(bet.id, {
        status: result.status,
        verified: 1,
        verified_at: new Date().toISOString(),
        verification_source: result.source,
        profit_loss,
        notes: result.match ? JSON.stringify(result.match) : bet.notes,
      });
      broadcast('bet_verified', { id: bet.id, status: result.status });
    }

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/verify/all - Verificar todas las pendientes
app.post('/api/verify/all', async (req, res) => {
  try {
    broadcast('verification_started', {});
    const results = await verifyAllPending();
    broadcast('verification_done', results);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/sync/telegram - Sincronizar canal
app.post('/api/sync/telegram', async (req, res) => {
  try {
    broadcast('sync_started', {});
    const allBets = await queries.getBets();
    const existingIds = allBets.map(b => b.telegram_msg_id).filter(Boolean);
    const { success, messages, error, source } = await syncChannel(req.body.limit || 30, existingIds);

    if (!success) {
      await queries.logSync({ messages_found: 0, bets_processed: 0, status: 'error', error });
      return res.json({ success: false, error });
    }

    let processed = 0;
    const processingResults = [];

    for (const msg of messages) {
      broadcast('processing_image', { msg_id: msg.telegram_msg_id });
      try {
        const geminiResult = await analyzeBetImage(msg.image_path);
        
        // Filtro anti-fotos de perfil / imágenes que no son tickets de apuesta
        if (geminiResult.is_valid_bet === false) {
          console.log(`🚫 Omitiendo msg #${msg.telegram_msg_id}: ${geminiResult.reason || 'No es un ticket'}`);
          processingResults.push({ msg_id: msg.telegram_msg_id, success: false, skipped: true, reason: geminiResult.reason });
          continue;
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
          status: 'pending', // Estado inicial siempre PENDIENTE al leer del Telegram
          raw_gemini_response: geminiResult.raw,
        });

        processed++;
        processingResults.push({ msg_id: msg.telegram_msg_id, bet_id: betId, success: true });
        broadcast('bet_processed', { msg_id: msg.telegram_msg_id, bet_id: betId });
        
        await new Promise(r => setTimeout(r, 3000)); // Delay para respetar rate limit gratuito de Gemini (15 RPM)
      } catch (e) {
        processingResults.push({ msg_id: msg.telegram_msg_id, success: false, error: e.message });
      }
    }

    await queries.logSync({ messages_found: messages.length, bets_processed: processed, status: 'ok', error: null });
    broadcast('sync_done', { messages: messages.length, processed });

    res.json({ success: true, messages_found: messages.length, bets_processed: processed, source, results: processingResults });
  } catch (err) {
    await queries.logSync({ messages_found: 0, bets_processed: 0, status: 'error', error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/process/image - Procesar imagen subida manualmente
app.post('/api/process/image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No se subió imagen' });

    broadcast('processing_image', { file: req.file.filename });
    const geminiResult = await analyzeBetImage(req.file.path);

    if (geminiResult.is_valid_bet === false) {
      return res.json({ success: false, is_valid_bet: false, error: geminiResult.reason || 'La imagen no es un ticket de apuesta válido' });
    }

    const betData = geminiResult.data;

    const betId = await queries.insertBet({
      telegram_msg_id: null,
      image_path: req.file.path,
      image_url: `/images/${req.file.filename}`,
      game: betData.game || 'Unknown',
      team1: betData.team1 || null,
      team2: betData.team2 || null,
      bet_type: betData.bet_type || null,
      pick: betData.pick || null,
      odds: betData.odds || null,
      stake: betData.stake || null,
      potential_win: betData.potential_win || null,
      bet_date: betData.bet_date || new Date().toISOString().split('T')[0],
      match_date: betData.match_date || null,
      platform: betData.platform || null,
      tournament: betData.tournament || null,
      status: betData.status || 'pending',
      raw_gemini_response: geminiResult.raw,
    });

    broadcast('bet_processed', { bet_id: betId });
    res.json({ success: true, bet_id: betId, data: betData, confidence: betData.confidence });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/process/base64 - Procesar imagen en base64
app.post('/api/process/base64', async (req, res) => {
  try {
    const { base64, mimeType } = req.body;
    if (!base64) return res.status(400).json({ success: false, error: 'No se recibió base64' });

    const geminiResult = await analyzeBetImageFromBase64(base64, mimeType || 'image/jpeg');
    const betData = geminiResult.data;

    const betId = await queries.insertBet({
      telegram_msg_id: req.body.telegram_msg_id || null,
      image_path: null,
      image_url: null,
      game: betData.game || 'Unknown',
      team1: betData.team1 || null,
      team2: betData.team2 || null,
      bet_type: betData.bet_type || null,
      pick: betData.pick || null,
      odds: betData.odds || null,
      stake: betData.stake || null,
      potential_win: betData.potential_win || null,
      bet_date: betData.bet_date || new Date().toISOString().split('T')[0],
      match_date: betData.match_date || null,
      platform: betData.platform || null,
      tournament: betData.tournament || null,
      status: betData.status || 'pending',
      raw_gemini_response: geminiResult.raw,
    });

    res.json({ success: true, bet_id: betId, data: betData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/export/excel - Exportar Excel
app.get('/api/export/excel', async (req, res) => {
  try {
    const bets = await queries.getBets(req.query);
    const stats = await queries.getStats();
    const filePath = exportToExcel(bets, stats);
    res.download(filePath, `papitabet_${new Date().toISOString().split('T')[0]}.xlsx`);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET/POST /api/bankroll
app.get('/api/bankroll', async (req, res) => {
  try {
    const bankroll = await queries.getBankroll();
    res.json({ success: true, data: bankroll });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/bankroll', async (req, res) => {
  try {
    await queries.updateBankroll(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/sync/status
app.get('/api/sync/status', async (req, res) => {
  try {
    const lastSync = await queries.getLastSync();
    res.json({ success: true, lastSync });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// POST /api/automation/run - Ejecutar ciclo automático manualmente
app.post('/api/automation/run', async (req, res) => {
  runAutomationCycle();
  res.json({ success: true, message: 'Ciclo de automatización iniciado en segundo plano' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🎰 PapitaBET Tracker corriendo en http://localhost:${PORT}`);
  console.log(`📡 WebSocket disponible en ws://localhost:${PORT}/ws`);
  console.log(`\n💡 Si no has autenticado Telegram, corre: npm run setup-telegram\n`);
  
  // Iniciar automatización en segundo plano (cada 15 minutos)
  startAutoCron('*/15 * * * *');
});

module.exports = app;
