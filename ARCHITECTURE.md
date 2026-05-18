# 🏗️ ARQUITECTURA DEL PROYECTO

## Diagrama de flujo general

```
┌──────────────────────────────────────────────────────────┐
│           USUARIOS DE WHATSAPP                            │
│  (solo el chat fijado como relay)                         │
└────────────────────┬─────────────────────────────────────┘
                     │ SMS/Mensajes
                     ▼
┌──────────────────────────────────────────────────────────┐
│          SERVICIO BAILEYS (WhatsApp Web)                  │
│                                                           │
│  - Conecta usando WebSocket                             │
│  - Escanea código QR                                    │
│  - Recibe mensajes en evento 'messages.upsert'         │
│  - Envía mensajes via 'sendMessage(jid, content)'      │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ├─────────────┐
                     │ Emite evento│
                     ▼             │
┌──────────────────────────────────────────────────────────┐
│            PUENTE (Bridge Service)                        │
│                                                           │
│  - Escucha eventos de WhatsApp                          │
│  - Bloquea el relay a un solo chat de WhatsApp         │
│  - Reenvía a Telegram                                  │
│  - Reenvía respuestas de Telegram a ese mismo chat    │
└────────────────────┬─────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
┌─────────────────────────┐ ┌──────────────────────────────┐
│  BASE DE DATOS SQLITE   │ │  SERVICIO TELEGRAM            │
│                         │ │                               │
│ - user_mappings        │ │ - Conecta con cuenta de usua. │
│ - message_logs         │ │ - Reutiliza sesión guardada   │
│                         │ │ - Envía mensajes             │
└─────────────────────────┘ └──────────────────────────────┘
                                      │
                                      │ Mensajes
                                      ▼
                        ┌──────────────────────────┐
                        │  USUARIOS DE TELEGRAM    │
                        │  (Chat privado con el bot externo)                       │
                        └──────────────────────────┘
```

## Estructura de carpetas

```
wapi/
├── src/
│   ├── index.ts                    # 🎯 Punto de entrada principal
│   │
│   ├── config.ts                   # ⚙️ Configuración centralizada
│   │                                  - Carga .env
│   │                                  - Valida variables
│   │
│   ├── types.ts                    # 📋 Definiciones de tipos TypeScript
│   │                                  - UserMapping
│   │                                  - MessageLog
│   │                                  - Config
│   │
│   ├── services/                   # 🔧 Servicios principales
│   │   ├── baileys.ts              # 📱 Servicio de WhatsApp
│   │   │                              - Conecta a WhatsApp Web
│   │   │                              - Escanea QR
│   │   │                              - Escucha/envía mensajes
│   │   │
│   │   ├── telegram.ts             # 💬 Servicio de Telegram
│   │   │                              - Conecta bot
│   │   │                              - Maneja comandos
│   │   │                              - Escucha/envía mensajes
│   │   │
│   │   └── bridge.ts               # 🌉 Puente entre servicios
│   │                                  - Coordina ambos servicios
│   │                                  - Mapea usuarios
│   │                                  - Reenvía mensajes
│   │
│   ├── database/                   # 🗄️ Capa de datos
│   │   ├── sqlite.ts               # Base de datos SQLite
│   │   │                              - Crear tablas
│   │   │                              - CRUD de mappings
│   │   │                              - Logs de mensajes
│   │   │
│   │   └── query-utils.ts          # Utilidades de consulta
│   │                                  - Estadísticas
│   │                                  - Historial
│   │
│   └── modules/                    # 📦 Módulos futuros
│
├── dist/                           # 📦 Código compilado (generado)
├── auth_info/                      # 🔑 Credenciales de Baileys
│                                      ⚠️ NO SUBIR A GIT
│
├── data/                           # 💾 Datos
│   └── wapi.db                     # Base de datos SQLite
│
├── package.json                    # 📋 Dependencias
├── tsconfig.json                   # ⚙️ Configuración TypeScript
├── .env.example                    # 📝 Plantilla de variables
├── .env.local                      # 🔐 Configuración local
├── .gitignore                      # 🚫 Archivos ignorados por Git
├── README.md                       # 📖 Documentación completa
└── QUICKSTART.md                   # 🚀 Inicio rápido
```

## Flujo de datos - Paso a paso

### 📱 Cuando recibe un mensaje de WhatsApp

```
1. Usuario envía mensaje a +34123456789 en WhatsApp
   ↓
2. Baileys recibe evento 'messages.upsert'
   - msg.key.remoteJid = "34123456789@s.whatsapp.net"
   - msg.message.conversation = "Hola, ¿cómo estás?"
   ↓
3. Bridge.handleWhatsAppMessage() es llamado
   ↓
4. Si es el primer chat, el relay se fija y se guarda en `relay_state.json`
   ↓
5. El chat queda fijado como único relay permitido
   ↓
6. Envía a Telegram:
   - telegram.sendMessage("Hola, ¿cómo estás?")
   ↓
7. Registra en BD:
   - INSERT INTO message_logs (fromPlatform: 'whatsapp', ...)
   ↓
8. Usuario recibe en Telegram ✅
```

### 💬 Cuando recibe un mensaje de Telegram

```
1. Usuario envía mensaje al bot en Telegram
   ↓
2. Bot recibe evento 'message'
   - ctx.chat.id = 123456
   - ctx.message.text = "Hola desde Telegram"
   ↓
3. Bridge.handleTelegramMessage() es llamado con la respuesta del bot externo
   ↓
4. Usa el chat fijado en memoria / `relay_state.json`
   ↓
5. Encuentra: { whatsappJid: "34123456789@s.whatsapp.net" }
   ↓
6. Envía a WhatsApp el texto de respuesta del bot
   ↓
7. Registra en BD:
   - INSERT INTO message_logs (fromPlatform: 'telegram', ...)
   ↓
8. Usuario recibe en WhatsApp ✅
```

### 🔗 Cuando se fija el chat relay

```
1. Llega el primer mensaje desde un chat de WhatsApp
   ↓
2. BridgeService lo toma como chat único permitido
   ↓
3. Lo guarda en `relay_state.json`
   ↓
4. Los mensajes de otros chats se ignoran ✅
```

## Modelos de datos

### user_mappings

```sql
CREATE TABLE user_mappings (
  id INTEGER PRIMARY KEY,
  whatsappNumber TEXT NOT NULL UNIQUE,    -- "+34123456789"
  whatsappJid TEXT NOT NULL UNIQUE,       -- "34123456789@s.whatsapp.net"
  name TEXT,                              -- Nombre del usuario (opcional)
  createdAt DATETIME,                     -- Timestamp de creación
  updatedAt DATETIME                      -- Último update
)
```

### message_logs

```sql
CREATE TABLE message_logs (
  id INTEGER PRIMARY KEY,
  fromPlatform TEXT,                -- 'whatsapp' | 'telegram'
  toPlatform TEXT,                  -- 'whatsapp' | 'telegram'
  sender TEXT,                      -- Remitente
  content TEXT,                     -- Texto del mensaje
  timestamp DATETIME,               -- Cuando fue enviado
  userMappingId INTEGER (FK)        -- Relación con usuario
)
```

## Event Emitters

### BaileysService Events

- `connected` - Se conectó a WhatsApp
- `qr` - Código QR generado
- `message` - Nuevo mensaje recibido
- `message-update` - Actualización de mensaje
- `logout` - Sesión cerrada

### TelegramService Events

- `connected` - Bot conectado
- `message` - Nuevo mensaje recibido
- `command` - No usado en el relay actual

### BridgeService

- Escucha eventos de ambos servicios
- Coordina el flujo de mensajes
- Maneja lógica de mapeo

## Estado de conexión

```javascript
// Baileys
{
  isConnected: boolean,
  isAuthenticated: boolean
}

// Telegram
{
  isConnected: boolean,
   botUsername: string
   sessionPath: string
}
```

## Manejo de errores

### Niveles de error

1. **Crítico**: Detiene la aplicación
   - Error al cargar config
   - Error al iniciar BD
   - Error fatal de conexión

2. **Error**: Se registra pero continúa
   - Error al enviar mensaje
   - Usuario no encontrado
   - Número inválido

3. **Warning**: Solo se registra
   - Número sin mapeo
   - Conversión de formato
   - Reconexión

## Flujo de ciclo de vida

```
START
  │
  ├─► Validar config
  │     └─► Error → EXIT
  │
  ├─► Inicializar BD
  │     └─► Error → EXIT
  │
  ├─► Inicializar Baileys
  │     └─► Escanear QR → Conectar
  │
  ├─► Inicializar Telegram
  │     └─► Conectar bot
  │
  ├─► Configurar Bridge
  │     └─► Escuchar eventos
  │
  ├─► Esperando eventos
  │     ├─► Mensaje WA → Reenviar a TG
  │     ├─► Mensaje TG → Reenviar a WA
  │     └─► Comando TG → Procesar
  │
  ├─► Señal SIGINT/SIGTERM
  │
  ├─► Limpiar:
  │     ├─► Desconectar Baileys
  │     ├─► Desconectar Telegram
  │     └─► Cerrar BD
  │
  └─► EXIT
```

---

¿Necesitas más detalles sobre algún componente específico?
