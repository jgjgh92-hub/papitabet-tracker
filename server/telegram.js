require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const fs = require('fs');
const path = require('path');

const API_ID = parseInt(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const SESSION_STRING = process.env.TELEGRAM_SESSION || '';
const CHANNEL = process.env.TELEGRAM_CHANNEL || 'PapitaBET';
const IMAGES_DIR = path.join(__dirname, '..', 'data', 'images');

if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

let client = null;

async function getClient() {
  if (client && client.connected) return client;

  const session = new StringSession(SESSION_STRING);
  client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
    useWSS: false,
  });

  if (!SESSION_STRING) {
    throw new Error('NO_SESSION: Run "npm run setup-telegram" first to authenticate');
  }

  await client.connect();
  return client;
}

/**
 * Obtiene los mensajes recientes del canal con fotos
 * @param {number} limit - Cuántos mensajes obtener (default 50)
 * @param {number|null} offsetId - ID de mensaje para paginación
 */
async function fetchChannelMessages(limit = 50, offsetId = null) {
  const tg = await getClient();
  
  const params = {
    peer: CHANNEL,
    limit,
    filter: new Api.InputMessagesFilterPhotos(),
  };
  if (offsetId) params.offsetId = offsetId;

  const result = await tg.invoke(new Api.messages.GetHistory(params));
  
  const messages = [];
  for (const msg of result.messages) {
    if (msg.media && msg.media.photo) {
      messages.push({
        id: msg.id,
        date: new Date(msg.date * 1000).toISOString(),
        text: msg.message || '',
        photo: msg.media.photo,
      });
    }
  }
  return messages;
}

/**
 * Descarga una foto del canal y la guarda localmente
 * @param {object} message - Mensaje de Telegram con foto
 * @returns {string} - Ruta local del archivo
 */
async function downloadPhoto(message) {
  const tg = await getClient();
  const filename = `msg_${message.id}.jpg`;
  const filepath = path.join(IMAGES_DIR, filename);

  if (fs.existsSync(filepath)) return filepath;

  const buffer = await tg.downloadMedia(message.photo, { workers: 1 });
  if (buffer) {
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }
  return null;
}

/**
 * Sincroniza el canal: obtiene imágenes nuevas del canal público
 * Alternativa: si no hay sesión, hace scraping del preview web
 */
async function syncChannel(limit = 30, existingMsgIds = []) {
  try {
    const messages = await fetchChannelMessages(limit);
    const newMessages = messages.filter(m => !existingMsgIds.includes(m.id));
    
    const results = [];
    for (const msg of newMessages) {
      try {
        const imagePath = await downloadPhoto(msg);
        results.push({
          telegram_msg_id: msg.id,
          date: msg.date,
          text: msg.text,
          image_path: imagePath,
          image_url: `/images/${path.basename(imagePath)}`,
        });
      } catch (e) {
        console.error(`Error descargando imagen del msg ${msg.id}:`, e.message);
      }
    }
    return { success: true, messages: results };
  } catch (err) {
    console.error('Error sincronizando canal:', err.message);
    // Fallback: scraping web del canal público
    return await syncChannelPublic(limit, existingMsgIds);
  }
}

/**
 * Fallback: obtiene imágenes del preview web público de Telegram
 */
async function syncChannelPublic(limit = 20, existingMsgIds = []) {
  const fetch = require('node-fetch');
  try {
    const url = `https://t.me/s/${CHANNEL}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const html = await resp.text();

    // Extraer imágenes del HTML del preview
    const imgRegex = /https:\/\/cdn[0-9]*\.telesco\.pe\/file\/[a-zA-Z0-9_\-]+\.jpg/g;
    const msgIdRegex = /data-post="PapitaBET\/(\d+)"/g;
    
    const images = [...new Set(html.match(imgRegex) || [])];
    const msgIds = [];
    let m;
    while ((m = msgIdRegex.exec(html)) !== null) msgIds.push(parseInt(m[1]));

    const results = [];
    for (let i = 0; i < Math.min(images.length, limit); i++) {
      const msgId = msgIds[i] || (Date.now() + i);
      if (existingMsgIds.includes(msgId)) continue;

      // Descargar imagen del CDN de Telegram
      try {
        const imgResp = await fetch(images[i]);
        if (imgResp.ok) {
          const buffer = await imgResp.buffer();
          const filename = `msg_${msgId}.jpg`;
          const filepath = path.join(IMAGES_DIR, filename);
          fs.writeFileSync(filepath, buffer);
          results.push({
            telegram_msg_id: msgId,
            date: new Date().toISOString(),
            text: '',
            image_path: filepath,
            image_url: `/images/${filename}`,
          });
        }
      } catch (e) {
        console.error(`Error descargando img ${images[i]}:`, e.message);
      }
    }
    return { success: true, messages: results, source: 'web_preview' };
  } catch (err) {
    return { success: false, error: err.message, messages: [] };
  }
}

module.exports = { syncChannel, getClient };
