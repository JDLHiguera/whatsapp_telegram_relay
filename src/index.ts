import { config, validateConfig } from './config'
import { BaileysService } from './services/baileys'
import { TelegramService } from './services/telegram'
import { BridgeService } from './services/bridge'
import { Database } from './database/sqlite'
import { AlertBotService } from './services/alert-bot'
import { installFileLogger } from './services/logger'
import fs from 'fs/promises'

let db: Database
let baileys: BaileysService
let telegram: TelegramService
let bridge: BridgeService
let alertBot: AlertBotService | null = null
let shuttingDown = false
let whatsappHasConnected = false
let whatsappNeedsRecoveryNotice = false

/**
 * Función principal de inicialización
 */
async function main(): Promise<void> {
  await installFileLogger(config.logFilePath)
  console.log('🚀 Iniciando relay WhatsApp ↔ Telegram\n')

  const hadUncleanShutdown = await checkPreviousRunState()

  // Validar configuración
  const validation = validateConfig()
  if (!validation.valid) {
    console.error('❌ Errores de configuración:')
    validation.errors.forEach((err) => console.error(`   - ${err}`))
    console.error('\n📝 Por favor, configura las variables de entorno en .env')
    process.exit(1)
  }

  console.log('✅ Configuración validada\n')

  try {
    // Inicializar base de datos
    console.log('🗄️  Inicializando base de datos...')
    db = new Database(config.databasePath)
    await db.init()

    // Inicializar servicios
    console.log('\n🔧 Inicializando servicios...\n')

    baileys = new BaileysService()
    telegram = new TelegramService()
    bridge = new BridgeService(baileys, telegram, db)
    alertBot = new AlertBotService({
      token: config.alertBotToken,
      adminChatId: config.alertBotAdminChatId,
      relayResetHandler: () => bridge.resetRelayState(),
      whatsappReconnectHandler: () => baileys.resetAuthAndReconnect(),
      subscribersPath: config.alertBotSubscribersPath,
      logFilePath: config.logFilePath,
      statusProvider: buildStatusSnapshot
    })

    baileys.on('connected', () => {
      if (!whatsappHasConnected) {
        whatsappHasConnected = true
        void alertBot?.notify('WhatsApp conectado', 'La sesión de WhatsApp quedó activa y lista para relay.', 'info')
        return
      }

      if (whatsappNeedsRecoveryNotice) {
        whatsappNeedsRecoveryNotice = false
        void alertBot?.notify(
          'WhatsApp reconectado',
          'La sesión volvió a quedar activa después de requerir intervención.',
          'info'
        )
      }
    })

    baileys.on('qr', (qr: string) => {
      console.log('📱 Nuevo código QR generado, enviando a suscriptores...')
      alertBot?.storeQR(qr)
      void alertBot?.sendQRPhoto()
    })

    baileys.on('disconnected', (info: any) => {
      const message = info?.shouldReconnect
        ? 'WhatsApp perdió conexión y está intentando reconectar.'
        : 'WhatsApp se desconectó y necesita re-autenticación.'

      // Los cortes que Baileys puede recuperar solo se registran en consola.
      // Telegram se reserva para estados que requieren intervención humana.
      if (info?.shouldReconnect) {
        return
      }

      whatsappNeedsRecoveryNotice = true

      if (info?.authExpired) {
        void alertBot?.notifyWhatsAppAuthRequired(
          'Baileys recibio un 401 Unauthorized. La sesion local de WhatsApp parece caducada o revocada.'
        )
        return
      }

      void alertBot?.notify('WhatsApp desconectado', message, 'error')
    })

    telegram.on('connected', () => {
      void alertBot?.notify('Telegram conectado', 'La sesión de Telegram quedó activa y lista para relay.', 'info')
    })

    telegram.on('disconnected', (info: any) => {
      const message = info?.error
        ? `Telegram dejó de responder o cerró la sesión.\n${String(info.error)}`
        : 'Telegram se desconectó.'
      void alertBot?.notify('Telegram desconectado', message, 'error')
    })

    await alertBot.connect()

    // Conectar servicios
    console.log('📡 Conectando servicios...\n')
    await Promise.all([baileys.connect(), telegram.connect()])

    if (hadUncleanShutdown) {
      await alertBot.notify(
        'Arranque tras caída inesperada',
        'El proceso anterior no se cerró de forma limpia. Revisa si WhatsApp o Telegram necesitan reconexión.',
        'warning'
      )
    }

    console.log('\n✨ ¡Sistema completamente iniciado!\n')

    // Mostrar instrucciones
    console.log('📋 Próximos pasos:')
    console.log('   1. Escanea el código QR de WhatsApp en tu terminal')
    console.log('   2. Si es la primera vez, completa el login de Telegram en la terminal')
    console.log(`   3. Abre el bot @${config.telegramRelayBotUsername} desde tu cuenta de Telegram`) 
    console.log('   4. Envía un mensaje desde WhatsApp al número secundario para iniciar el relay')
    console.log('   5. Las respuestas del bot volverán a ese mismo chat de WhatsApp\n')

    void alertBot?.notify(
      'Sistema iniciado',
      'Relay WhatsApp ↔ Telegram listo. Puedes abrir /menu en el bot de alertas para ver estado y logs.',
      'info'
    )
  } catch (error) {
    console.error('❌ Error durante la inicialización:', error)
    await cleanup()
    process.exit(1)
  }
}

/**
 * Función de limpieza
 */
async function cleanup(): Promise<void> {
  if (shuttingDown) {
    return
  }
  shuttingDown = true

  console.log('\n🛑 Deteniendo servicios...')

  try {
    await writeRuntimeState({
      status: 'stopped-cleanly',
      stoppedAt: new Date().toISOString()
    })

    if (alertBot?.getStatus().isConnected) {
      await alertBot.notify(
        'Cierre limpio del servidor',
        'Se recibió una orden de parada. WhatsApp y Telegram se están cerrando de forma controlada.',
        'warning'
      )
    }

    if (alertBot) await alertBot.shutdown()
    if (baileys) await baileys.disconnect()
    if (telegram) await telegram.disconnect()
    if (db) await db.close()
  } catch (error) {
    console.error('❌ Error durante la limpieza:', error)
  }

  console.log('✅ Servicios detenidos')
}

async function checkPreviousRunState(): Promise<boolean> {
  try {
    const raw = await fs.readFile(config.runtimeStatePath, 'utf8')
    const parsed = JSON.parse(raw) as { status?: string }
    return parsed.status === 'running'
  } catch {
    return false
  }
}

async function writeRuntimeState(state: Record<string, unknown>): Promise<void> {
  try {
    const { dirname } = await import('path')
    await fs.mkdir(dirname(config.runtimeStatePath), { recursive: true })
    await fs.writeFile(config.runtimeStatePath, JSON.stringify(state, null, 2), 'utf8')
  } catch {
    // El estado runtime es auxiliar; no bloqueamos por fallos aquí
  }
}

function buildStatusSnapshot(): string {
  const baileysStatus = baileys?.getStatus()
  const telegramStatus = telegram?.getStatus()
  const bridgeStatus = bridge?.getStatus()
  const alertStatus = alertBot?.getStatus()

  const lines = [
    `WhatsApp: ${baileysStatus?.isConnected ? 'conectado' : baileysStatus?.isConnecting ? 'conectando' : 'desconectado'}`,
    `Telegram: ${telegramStatus?.isConnected ? 'conectado' : 'desconectado'}`,
    `Relay: ${bridgeStatus?.lockedWhatsAppJid || 'sin chat fijado'}`,
    `Alertas: ${alertStatus?.isEnabled ? `activas (${alertStatus.subscriberCount} suscriptores)` : 'desactivadas'}`,
    `Log: ${alertStatus?.logFilePath || config.logFilePath}`,
    `Telegram relay bot: @${config.telegramRelayBotUsername}`
  ]

  return lines.join('\n')
}

// Manejar señales de interrupción
process.on('SIGINT', async () => {
  console.log('\n')
  if (alertBot?.getStatus().isConnected) {
    await alertBot.notify('Parada manual', 'Se recibió Ctrl+C. El servidor se cerrará de forma controlada.', 'warning')
  }
  await cleanup()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\n')
  if (alertBot?.getStatus().isConnected) {
    await alertBot.notify('Parada por señal', 'Se recibió SIGTERM. El servidor se cerrará de forma controlada.', 'warning')
  }
  await cleanup()
  process.exit(0)
})

process.on('uncaughtException', async (error) => {
  console.error('❌ Excepción no capturada:', error)
  if (alertBot?.getStatus().isConnected) {
    await alertBot.notify('Caída inesperada', `El proceso lanzó una excepción no capturada: ${String(error)}`, 'error')
  }
  await cleanup()
  process.exit(1)
})

process.on('unhandledRejection', async (reason, promise) => {
  console.error('❌ Promesa rechazada no manejada:', reason)
  if (alertBot?.getStatus().isConnected) {
    await alertBot.notify('Caída inesperada', `Se detectó una promesa rechazada no manejada: ${String(reason)}`, 'error')
  }
  await cleanup()
  process.exit(1)
})

// Iniciar aplicación
main()
