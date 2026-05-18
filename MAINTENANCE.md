# 🛠️ MANTENIMIENTO Y TRUCOS

## 🔍 Monitoreo

### Ver logs en tiempo real

```bash
# En desarrollo
npm run dev

# Ver últimas 100 líneas de logs
tail -f app.log | head -100
```

### Monitorear procesos

```bash
# Ver procesos Node.js ejecutándose
ps aux | grep node

# Ver memoria y CPU
top -p <PID>
```

## 🔧 Troubleshooting avanzado

### Base de datos corrupta

Si la BD se corrompe o tiene bloqueos:

```bash
# Opción 1: Eliminar y recrear
rm -f data/wapi.db data/wapi.db-wal data/wapi.db-shm
npm run dev  # Se creará nueva

# Opción 2: Respaldar y empezar de nuevo
cp data/wapi.db data/wapi.db.backup
rm -f data/wapi.db data/wapi.db-wal data/wapi.db-shm
```

### Sesión de WhatsApp expirada

Si el código QR no funciona o la sesión expira:

```bash
# Eliminar credenciales guardadas
rm -rf auth_info/*

# Reiniciar y escanear QR de nuevo
npm run dev
```

### Sesión de Telegram repetida

Si Telegram vuelve a pedir login en cada arranque:

```bash
# Verifica que el archivo exista y no esté vacío
ls data/telegram.session

# Borra solo si quieres forzar una nueva sesión
rm -f data/telegram.session
npm run dev
```

Si la sesión está correcta, GramJS debe reutilizarla sin pedir código otra vez.

### Relay fijo a un solo chat

Si quieres cambiar el chat único permitido:

```bash
rm -f data/relay_state.json
npm run dev
```

El primer chat de WhatsApp que escriba volverá a fijarse como relay.

### Bot no responde en Telegram

1. Verifica que la sesión de Telegram existe:
```bash
ls data/telegram.session
```

2. Reinicia el relay:
```bash
npm run dev
```

3. Verifica que el bot externo responde desde la cuenta de Telegram logueada:
```bash
echo "envía un mensaje manual al bot desde Telegram"
```

## 📊 Inspeccionar la base de datos

### Usando SQLite CLI

```bash
# Instalar sqlite3 si no lo tienes
# Windows: Descargar desde https://www.sqlite.org/download.html
# Linux: apt-get install sqlite3

# Abrir la BD
sqlite3 data/wapi.db

# Ver tablas
.tables

# Ver estructura de tabla
.schema user_mappings
.schema message_logs

# Ver todos los usuarios
SELECT * FROM user_mappings;

# Ver últimos 10 mensajes
SELECT * FROM message_logs ORDER BY timestamp DESC LIMIT 10;

# Contar mensajes por usuario
SELECT 
  um.whatsappNumber, 
  COUNT(*) as count 
FROM user_mappings um 
LEFT JOIN message_logs ml ON um.id = ml.userMappingId 
GROUP BY um.id;

# Exportar a CSV
.mode csv
.output mensajes.csv
SELECT * FROM message_logs;
.quit
```

### Node.js CLI

```javascript
// Crear un script `inspect-db.js`
const sqlite3 = require('sqlite3')
const db = new sqlite3.Database('data/wapi.db')

// Ver todos los usuarios
db.all('SELECT * FROM user_mappings', (err, rows) => {
  console.log('Usuarios:', rows)
  db.close()
})
```

## 🚀 Deployment

### Linux con systemd

Crear archivo `/etc/systemd/system/wapi.service`:

```ini
[Unit]
Description=WhatsApp-Telegram Bridge
After=network.target

[Service]
Type=simple
User=nobody
WorkingDirectory=/home/user/wapi
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Luego:
```bash
sudo systemctl enable wapi
sudo systemctl start wapi
sudo systemctl status wapi
```

### Docker

Crear `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist

CMD ["node", "dist/index.js"]
```

Construir y correr:
```bash
docker build -t wapi .
docker run -d \
  -e TELEGRAM_BOT_TOKEN=xxx \
  -e TELEGRAM_ADMIN_ID=xxx \
  -e WHATSAPP_PHONE_NUMBER=xxx \
  -v wapi-data:/app/data \
  -v wapi-auth:/app/auth_info \
  wapi
```

### PM2 (Gestor de procesos)

```bash
# Instalar PM2
npm install -g pm2

# Crear archivo `ecosystem.config.js`
module.exports = {
  apps: [{
    name: 'wapi',
    script: 'dist/index.js',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production'
    }
  }]
}

# Iniciar
pm2 start ecosystem.config.js

# Ver logs
pm2 logs wapi

# Detener
pm2 stop wapi

# Reiniciar
pm2 restart wapi

# Estado
pm2 status
```

## 📈 Optimizaciones

### Rendimiento

1. **Cache de historial**: 
   ```typescript
   // En bridge.ts
   const cache = new Map()
   ```

2. **Batch de mensajes**:
   ```typescript
   // Guardar múltiples mensajes a la vez
   await db.batchLogMessages([msg1, msg2, msg3])
   ```

3. **Compresión de logs**:
   ```bash
   # Comprimir logs antiguos
   gzip data/wapi*.log
   ```

### Seguridad

1. **Rate limiting**:
   ```typescript
   // Limitar mensajes por usuario
   const userLimits = new Map()
   const MAX_MSGS_PER_MINUTE = 30
   ```

2. **Validación de entrada**:
   ```typescript
   // Sanitizar mensajes
   message = message.substring(0, 4096) // Límite de Telegram
   ```

3. **Logs de auditoría**:
   ```typescript
   // Registrar todas las acciones
   await logAuditEvent(userId, action, details)
   ```

## 🔐 Backups

### Automatizar backups

Script `backup.sh`:

```bash
#!/bin/bash

BACKUP_DIR="./backups"
mkdir -p $BACKUP_DIR

TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Backup de BD
cp data/wapi.db $BACKUP_DIR/wapi_${TIMESTAMP}.db

# Backup de credenciales (encriptadas idealmente)
tar -czf $BACKUP_DIR/auth_${TIMESTAMP}.tar.gz auth_info/

# Eliminar backups antiguos (más de 30 días)
find $BACKUP_DIR -type f -mtime +30 -delete

echo "Backup completado: $TIMESTAMP"
```

Ejecutar cada 6 horas:
```bash
crontab -e
# Agregar: 0 */6 * * * /path/to/backup.sh
```

## 📝 Logs

### Rotación de logs

```bash
# Instalar logrotate
sudo apt-get install logrotate

# Crear `/etc/logrotate.d/wapi`
/var/log/wapi.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 nobody nobody
}
```

## 🐛 Debug mode

Activar debug verbose:

```bash
# En .env
NODE_ENV=development
DEBUG=baileys:*,telegraf:*

npm run dev
```

## 📞 Contactos útiles

- **Baileys Issues**: https://github.com/WhiskeySockets/Baileys/issues
- **Telegraf Issues**: https://github.com/telegraf/telegraf/issues
- **SQLite Docs**: https://www.sqlite.org/docs.html
- **Node.js Docs**: https://nodejs.org/docs/

---

¿Necesitas ayuda con algo específico?
