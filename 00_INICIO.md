# 🎉 BIENVENIDA - LEE ESTO PRIMERO

Este proyecto ya no usa un bot de Telegram propio. Usa tu cuenta de Telegram para hablar con un bot externo, mientras WhatsApp actúa como relay.

## Qué hace

- WhatsApp secundario recibe tu mensaje.
- Ese chat se fija como el único relay permitido.
- El mensaje se envía al bot externo de Telegram desde tu cuenta.
- La respuesta del bot vuelve al mismo chat de WhatsApp.

## Lo que necesitas

1. Tu API ID y API HASH de Telegram desde `my.telegram.org`.
2. El username del bot externo con el que ya hablas.
3. Tu número de WhatsApp secundario.

## Configuración rápida

Edita `wapi/.env.local` y completa:

```env
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=abcdef123456abcdef123456abcdef12
TELEGRAM_RELAY_BOT_USERNAME=mi_bot
TELEGRAM_SESSION_PATH=./data/telegram.session
RELAY_STATE_PATH=./data/relay_state.json
TELEGRAM_PHONE_NUMBER=+34123456789
WHATSAPP_PHONE_NUMBER=+34123456789
DATABASE_PATH=./data/wapi.db
PORT=3000
NODE_ENV=development
```

## Arranque

```bash
npm install
npm run build
npm run dev
```

La primera vez Telegram puede pedir login en terminal. Después reutiliza `./data/telegram.session`.

## Dónde mirar

1. `QUICKSTART.md`
2. `README.md`
3. `ARCHITECTURE.md`
4. `MAINTENANCE.md`

## Nota importante

Si quieres cambiar el chat fijo del relay, borra `./data/relay_state.json` y vuelve a escribir desde el chat correcto.
