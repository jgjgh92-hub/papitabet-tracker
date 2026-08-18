require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const fs = require('fs');
const path = require('path');

const API_ID = parseInt(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const ENV_PATH = path.join(__dirname, '..', '.env');

(async () => {
  console.log('\n🔐 PapitaBET Tracker — Configuración de Telegram\n');
  console.log('Este script te conecta a Telegram para leer el canal @PapitaBET\n');

  const session = new StringSession('');
  const client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text('📱 Tu número de teléfono (ej: +549xxxxxxxxxx): '),
    password: async () => await input.text('🔑 Contraseña 2FA (deja vacío si no tienes): '),
    phoneCode: async () => await input.text('📨 Código que te llegó por Telegram: '),
    onError: (err) => console.error('❌ Error:', err),
  });

  const sessionString = client.session.save();
  console.log('\n✅ Sesión creada correctamente!\n');

  // Guardar sesión en .env
  let envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  if (envContent.includes('TELEGRAM_SESSION=')) {
    envContent = envContent.replace(/TELEGRAM_SESSION=.*/, `TELEGRAM_SESSION=${sessionString}`);
  } else {
    envContent += `\nTELEGRAM_SESSION=${sessionString}`;
  }
  fs.writeFileSync(ENV_PATH, envContent);
  console.log('✅ Sesión guardada en .env\n');

  // Probar acceso al canal
  try {
    const channel = await client.getEntity('PapitaBET');
    console.log(`✅ Canal encontrado: ${channel.title}`);
    console.log('🎉 Todo listo! Ahora puedes correr: npm run dev\n');
  } catch (e) {
    console.log('⚠️ Advertencia: No se pudo verificar el canal, pero la sesión fue guardada.');
  }

  await client.disconnect();
  process.exit(0);
})();
