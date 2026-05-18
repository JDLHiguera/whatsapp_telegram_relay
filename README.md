# 🌐 Relay WhatsApp-Telegram con Baileys + GramJS

Conecta un WhatsApp secundario con una conversación existente en Telegram usando Baileys para WhatsApp y GramJS para entrar con tu cuenta de Telegram.
El relay queda fijado a un solo chat de WhatsApp y reutiliza la sesión de Telegram para evitar logins repetidos.

## 📋 Requisitos

- Node.js 18+ 
- NPM o Yarn
- Tu cuenta de Telegram y acceso a my.telegram.org
- El username del bot externo de Telegram con el que ya hablas
- Un número de WhatsApp

## 🚀 Instalación

### 1. Clonar el repositorio y instalar dependencias

```bash
cd wapi
npm install
```

### 2. Configurar variables de entorno

Copia `.env.example` a `.env` y completa los valores:

```bash
cp .env.example .env
```

**Edita `.env`:**

```env
# API de Telegram
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=abcdef123456abcdef123456abcdef12

# Usuario del bot externo de Telegram
TELEGRAM_RELAY_BOT_USERNAME=mi_bot

# Sesión de Telegram (se crea al primer login)
TELEGRAM_SESSION_PATH=./data/telegram.session

# Estado del único chat de WhatsApp permitido
RELAY_STATE_PATH=./data/relay_state.json
# Tu número para login inicial en Telegram
TELEGRAM_PHONE_NUMBER=+34123456789

# Tu número de WhatsApp (formato internacional)
WHATSAPP_PHONE_NUMBER=+34123456789

# Ruta de la base de datos
DATABASE_PATH=./data/wapi.db

# Puerto del servidor
PORT=3000

# Entorno
NODE_ENV=development
```

## ▶️ Ejecutar

### Desarrollo (con hot reload)

```bash
npm run dev
```

### Producción

```bash
npm run build
npm start
```

### Docker / Unraid

Puedes ejecutar el relay como servicio en segundo plano con Docker Compose:

```bash
docker compose up -d --build
```

Para Unraid, monta como persistentes estos directorios del contenedor:

- `/app/auth_info` para la sesión de WhatsApp
- `/app/data` para SQLite, logs y estado runtime

El `docker-compose.yml` ya incluye `restart: unless-stopped`, así que Docker reiniciará el contenedor automáticamente si el proceso cae o si el servidor se reinicia.

Si quieres moverlo a una ruta típica de Unraid, coloca el repositorio dentro de tu carpeta de `appdata` y deja el `docker-compose.yml` tal cual, o cambia los volúmenes por rutas absolutas del estilo `/mnt/user/appdata/wapi/...`.

Variables útiles para Docker:

```env
TELEGRAM_ALERT_BOT_TOKEN=123456:bot_token_here
TELEGRAM_ALERT_SUBSCRIBERS_PATH=./data/alert_subscribers.json
LOG_FILE_PATH=./data/server.log
RUNTIME_STATE_PATH=./data/runtime_state.json
```

## 🔗 Uso

### En Telegram

1. Inicia sesión con tu cuenta de Telegram cuando el programa lo pida en terminal.
2. Abre el bot externo desde esa cuenta y deja la conversación lista.
3. Envía un mensaje desde WhatsApp al número secundario.
4. El mensaje se reenviará al bot y su respuesta volverá a WhatsApp.

### Comandos disponibles

No hay comandos de bot propios en este modo; Telegram se usa como cliente de usuario para hablar con el bot externo.

## 🗄️ Base de Datos

Se usa SQLite para almacenar logs de mensajes intercambiados. La relación activa del relay se mantiene en memoria y en `./data/relay_state.json`.

La base de datos se crea automáticamente en `./data/wapi.db`

## 🧱 Archivos de despliegue

- [Dockerfile](Dockerfile)
- [docker-compose.yml](docker-compose.yml)
- [.dockerignore](.dockerignore)

## 📁 Estructura del proyecto

```
wapi/
├── src/
│   ├── index.ts              # Punto de entrada
│   ├── config.ts             # Configuración
│   ├── types.ts              # Tipos de TypeScript
│   ├── database/
│   │   └── sqlite.ts         # Servicio de BD
│   ├── services/
│   │   ├── baileys.ts        # Servicio de WhatsApp
│   │   ├── telegram.ts       # Servicio de Telegram
│   │   └── bridge.ts         # Puente entre ambos
│   └── modules/              # Módulos adicionales
├── auth_info/                # Credenciales de Baileys
├── data/                     # Archivos de datos
├── dist/                     # Código compilado
├── package.json
├── tsconfig.json
├── .env.example
└── .gitignore
```

## 🔐 Seguridad

- Las credenciales de WhatsApp se guardan localmente en `auth_info/`
- El token del bot de Telegram se lee de variables de entorno
- Los mapeos de usuarios se almacenan en la BD SQLite
- **Nunca** hagas commit de `.env` o `auth_info/`

## ⚠️ Advertencias

- **Términos de Servicio**: WhatsApp puede bloquear cuentas que usen automatización masiva
- **Rate Limiting**: Implementa límites de velocidad para evitar baneos
- **Privacidad**: Asegúrate de cumplir con regulaciones de privacidad
- **Responsabilidad**: Este es un proyecto personal. Úsalo bajo tu propia responsabilidad

## 🐛 Troubleshooting

### "No QR code appearing"
- Asegúrate de que la terminal soporta emojis y colores
- Intenta con `--force-color` o ajusta la configuración de terminal

### "Message not sending"
- Verifica que ambas conexiones estén activas (`/status`)
- Comprueba que el número esté en formato internacional (+34...)
- Asegúrate de que el número existe en WhatsApp

### "Database locked"
- Cierra otras instancias del bot
- Borra `wapi.db-wal` y `wapi.db-shm` si existen

## 📚 Recursos

- [Baileys Documentation](https://baileys.wiki/)
- [GramJS Documentation](https://gram.js.org/)
- [SQLite3 Node.js](https://github.com/mapbox/node-sqlite3)

## 📄 Licencia

MIT

## 👨‍💻 Contribuciones

Las contribuciones son bienvenidas. Por favor:

1. Fork el proyecto
2. Crea una rama (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request
