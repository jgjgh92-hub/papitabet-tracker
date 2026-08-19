require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

function getApiKeys() {
  const raw = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
  return raw.split(',').map(k => k.trim()).filter(Boolean);
}

let apiKeys = getApiKeys();
let currentKeyIndex = 0;
const exhaustedKeys = new Set();

function getActiveClient() {
  apiKeys = getApiKeys();
  if (!apiKeys.length) throw new Error('No hay GEMINI_API_KEY configurada en .env');

  for (let i = 0; i < apiKeys.length; i++) {
    const idx = (currentKeyIndex + i) % apiKeys.length;
    const key = apiKeys[idx];
    if (!exhaustedKeys.has(key)) {
      currentKeyIndex = idx;
      return { genAI: new GoogleGenerativeAI(key), key, keyIndex: idx };
    }
  }

  exhaustedKeys.clear();
  return { genAI: new GoogleGenerativeAI(apiKeys[0]), key: apiKeys[0], keyIndex: 0 };
}

function rotateToNextKey(exhaustedKey) {
  if (exhaustedKey) {
    exhaustedKeys.add(exhaustedKey);
    console.warn(`⚠️ [Gemini] Key #${currentKeyIndex + 1} agotada. Rotando a la siguiente...`);
  }
  currentKeyIndex = (currentKeyIndex + 1) % (apiKeys.length || 1);
}

const EXTRACTION_PROMPT = `Eres un auditor especializado en capturas de pantalla de apuestas deportivas de esports (Dota 2 y CS2).

PRIMER PASO - VALIDACIÓN RIGUROSA:
Determina si la imagen es REALMENTE una captura de pantalla de un ticket/cupón/boleto de apuesta (de plataformas como Betsson, 1xBet, Bet365, Parimatch, Codere, etc.).
- Si la imagen es una FOTO DE PERFIL, LOGO, IMAGEN PROMOCIONAL, AVATAR, MEME o cualquier imagen que NO contenga un boleto/ticket de apuesta explícito con datos de apuesta, DEBES responder con "is_valid_bet": false.

Responde ÚNICAMENTE con un objeto JSON válido con esta estructura exacta:
{
  "is_valid_bet": true | false,
  "invalid_reason": "Razón corta si is_valid_bet es false (ej: 'Foto de perfil', 'Imagen sin ticket de apuesta')",
  "game": "CS2" | "Dota2" | "Other" | "Unknown",
  "team1": "nombre del equipo 1",
  "team2": "nombre del equipo 2",
  "bet_type": "Match Winner" | "Total Maps" | "Handicap" | "Map Winner" | "Total Rounds" | "First Map" | "Other",
  "pick": "el pick apostado exacto",
  "odds": número decimal de la cuota (ej: 1.85),
  "stake": monto apostado como número,
  "potential_win": ganancia potencial como número,
  "bet_date": "YYYY-MM-DD" o null,
  "match_date": "YYYY-MM-DD" o null,
  "platform": "nombre de la plataforma (Betsson, 1xBet, etc)",
  "tournament": "nombre del torneo si es visible",
  "status": "pending",
  "confidence": número del 0 al 100
}

Notas importantes:
- Si "is_valid_bet" es false, pon null en los campos de la apuesta.
- Equipos CS2 comunes: Natus Vincere, FAZE, Astralis, paiN, ENCE, Cloud9, Heroic, Vitality, Spirit, Mouz, G2, etc.
- Equipos Dota2 comunes: Team Spirit, Team Liquid, OG, Tundra, PSG.LGD, BetBoom, Gaimin Gladiators, Falcons, Xtreme, etc.
- El status inicial DEBE ser siempre "pending".
- No incluyas texto explicativo, SOLO el objeto JSON.`;

async function getWorkingModel(genAI) {
  const models = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'];
  for (const m of models) {
    try {
      const model = genAI.getGenerativeModel({ model: m });
      return { model, name: m };
    } catch (e) {}
  }
  return { model: genAI.getGenerativeModel({ model: 'gemini-3.6-flash' }), name: 'gemini-3.6-flash' };
}

function parseRetryDelay(errMessage) {
  const match = errMessage.match(/retryDelay['":\s]+([0-9]+)/);
  if (match) return parseInt(match[1]) * 1000 + 2000;
  return 30000;
}

/**
 * Analiza una imagen de apuesta con Gemini Vision.
 */
async function analyzeBetImage(imagePath, keyAttempt = 0) {
  const keys = getApiKeys();
  if (keyAttempt >= keys.length && keys.length > 0 && exhaustedKeys.size >= keys.length) {
    console.warn('⛔ [Gemini] Todas las API keys disponibles han alcanzado su cuota diaria.');
    return {
      success: false,
      is_valid_bet: false,
      quota_exhausted: true,
      reason: 'Todas las API keys de Gemini tienen cuota agotada.',
      data: { game: 'Unknown', status: 'pending', confidence: 0 },
    };
  }

  let active;
  try {
    active = getActiveClient();
  } catch (e) {
    return { success: false, is_valid_bet: false, error: e.message, data: { game: 'Unknown', status: 'pending' } };
  }

  try {
    const { model } = await getWorkingModel(active.genAI);
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString('base64');

    const result = await model.generateContent([
      EXTRACTION_PROMPT,
      { inlineData: { data: base64Image, mimeType: 'image/jpeg' } },
    ]);

    const response = await result.response;
    const text = response.text().trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No se encontró JSON en la respuesta de Gemini');

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.is_valid_bet === false) {
      return { success: false, is_valid_bet: false, reason: parsed.invalid_reason || 'No es un ticket de apuesta', data: parsed };
    }

    if (parsed.stake && parsed.odds && !parsed.potential_win) {
      parsed.potential_win = parseFloat((parsed.stake * parsed.odds).toFixed(2));
    }

    parsed.status = 'pending';
    return { success: true, is_valid_bet: true, data: parsed, raw: text };

  } catch (err) {
    if (err.message.includes('429')) {
      const isDaily = err.message.includes('PerDay') || err.message.includes('limit: 0');

      if (isDaily || keys.length > 1) {
        rotateToNextKey(active.key);
        if (keyAttempt + 1 < keys.length) {
          console.log(`🔄 [Gemini] Probando con API Key #${currentKeyIndex + 1}...`);
          return analyzeBetImage(imagePath, keyAttempt + 1);
        }
      }

      const waitMs = parseRetryDelay(err.message);
      console.log(`⏳ [Gemini RPM 429] Esperando ${Math.round(waitMs / 1000)}s antes de reintentar...`);
      await new Promise(r => setTimeout(r, waitMs));
      return analyzeBetImage(imagePath, keyAttempt + 1);
    }

    console.error('❌ Error en Gemini:', err.message.substring(0, 120));
    return {
      success: false,
      is_valid_bet: false,
      error: err.message,
      data: { game: 'Unknown', status: 'pending', confidence: 0 },
    };
  }
}

async function analyzeBetImageFromBase64(base64, mimeType = 'image/jpeg') {
  let active;
  try {
    active = getActiveClient();
  } catch (e) {
    return { success: false, is_valid_bet: false, error: e.message, data: { game: 'Unknown', status: 'pending' } };
  }

  try {
    const { model } = await getWorkingModel(active.genAI);
    const result = await model.generateContent([
      EXTRACTION_PROMPT,
      { inlineData: { data: base64, mimeType } },
    ]);

    const response = await result.response;
    const text = response.text().trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON en respuesta');

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.is_valid_bet === false) {
      return { success: false, is_valid_bet: false, reason: parsed.invalid_reason, data: parsed };
    }

    parsed.status = 'pending';
    return { success: true, is_valid_bet: true, data: parsed, raw: text };
  } catch (err) {
    return { success: false, is_valid_bet: false, error: err.message, data: { game: 'Unknown', status: 'pending' } };
  }
}

module.exports = {
  analyzeBetImage,
  analyzeBetImageFromBase64,
  isDailyQuotaExhausted: () => apiKeys.length > 0 && exhaustedKeys.size >= apiKeys.length,
};
