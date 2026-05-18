# 🚀 GUÍA DE INICIO RÁPIDO

## Paso 1: Obtener credenciales

### 🤖 Telegram como usuario

1. Abre `https://my.telegram.org`
2. Inicia sesión con tu número
3. Obtén tu **API ID** y **API HASH**
   - Ejemplo: `123456` y `abcdef123456abcdef123456abcdef12`

### 👤 Tu número de Telegram

1. Ten a mano tu número con prefijo internacional
2. Ejemplo: `+34123456789`

## Paso 2: Configurar archivo .env

Edita `.env.local` o `.env`:

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

**⚠️ Importante:** El número de WhatsApp debe estar en **formato internacional** (+país + número sin 0 inicial)

Ejemplos:
- 🇪🇸 España: `+34123456789`
- 🇲🇽 México: `+525512345678`
- 🇦🇷 Argentina: `+541134567890`

## Paso 3: Instalar dependencias

```bash
npm install
```

## Paso 4: Ejecutar en desarrollo

```bash
npm run dev
```

Deberías ver:

```
🚀 Iniciando relay WhatsApp ↔ Telegram

✅ Configuración validada

🗄️  Inicializando base de datos...
✅ Conectado a SQLite en: ./data/wapi.db

🔧 Inicializando servicios...

📡 Conectando servicios...

🔄 Iniciando conexión a WhatsApp...
📱 Escanea este código QR con tu teléfono WhatsApp:
```

**Un código QR aparecerá en tu terminal.**

## Paso 5: Conectar WhatsApp

1. **Abre WhatsApp en tu teléfono**
2. **Escanea el código QR** que aparece en tu terminal
3. **Espera a que se conecte** (debería decir "✅ WhatsApp conectado exitosamente")

## Paso 6: Iniciar sesión en Telegram

1. La primera vez, el programa te pedirá el login de Telegram en la terminal
2. Si ya existe `./data/telegram.session`, no pedirá login otra vez
3. Abre el bot externo desde esa cuenta de Telegram

## Paso 7: Fijar el único chat permitido

Envía un mensaje desde el chat de WhatsApp que quieres usar como relay.
Ese chat quedará guardado en `./data/relay_state.json` y los demás serán ignorados.

```
Hola, esto inicia el relay
```

Después, cualquier respuesta del bot de Telegram volverá a ese mismo chat de WhatsApp.

## ✨ ¡Listo!

Ahora puedes:

📱 **En WhatsApp:** Recibir las respuestas del bot de Telegram
💬 **En Telegram:** Escribir al bot externo desde tu cuenta real

Prueba escribiendo un mensaje en WhatsApp:

```
Hola, esto es una prueba
```

Debería quedar fijado como el único chat relay y su respuesta volverá a ese mismo chat.

## 🆘 Troubleshooting

### El código QR no aparece

- **Solución:** Intenta ajustar el tamaño de tu terminal a 120x40 caracteres como mínimo

### El relay se quedó con el chat equivocado

- **Solución:** Borra `./data/relay_state.json` y vuelve a enviar el primer mensaje desde el chat correcto

### Mensajes no llegan

1. Verifica que WhatsApp y Telegram estén conectados
2. Comprueba que `./data/telegram.session` exista
3. Confirma que el bot externo responde manualmente desde Telegram

### Desconexión frecuente

- Aumenta el timeout en el config
- Verifica tu conexión a internet
- Intenta reconectar escaneando el QR de nuevo

## 📚 Comandos disponibles

No hay comandos propios de bot en este modo.

## 💡 Tips

- Mantén este proceso ejecutándose en background (usa `nohup` o `screen` en Linux/Mac)
- Para producción, usa `npm run build && npm start`
- La BD se crea automáticamente en `./data/wapi.db`
- Las credenciales de WhatsApp se guardan en `./auth_info/`
- La sesión de Telegram se guarda en `./data/telegram.session`

---

¿Preguntas? Revisa el [README.md](./README.md) completo.
