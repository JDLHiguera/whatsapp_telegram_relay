import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

// Cargar variables de entorno (.env.local tiene prioridad)
dotenv.config({ path: ['.env.local', '.env'] })

import { Config } from './types'

export const config: Config = {
  telegramApiId: parseInt(process.env.TELEGRAM_API_ID || '0'),
  telegramApiHash: process.env.TELEGRAM_API_HASH || '',
  telegramRelayBotUsername: (process.env.TELEGRAM_RELAY_BOT_USERNAME || '').replace(/^@/, ''),
  telegramSessionPath: process.env.TELEGRAM_SESSION_PATH || path.join(__dirname, '../data/telegram.session'),
  relayStatePath: process.env.RELAY_STATE_PATH || path.join(__dirname, '../data/relay_state.json'),
  telegramPhoneNumber: process.env.TELEGRAM_PHONE_NUMBER || undefined,
  whatsappPhoneNumber: process.env.WHATSAPP_PHONE_NUMBER || '',
  alertBotToken: process.env.TELEGRAM_ALERT_BOT_TOKEN || undefined,
  alertBotSubscribersPath: process.env.TELEGRAM_ALERT_SUBSCRIBERS_PATH || path.join(__dirname, '../data/alert_subscribers.json'),
  logFilePath: process.env.LOG_FILE_PATH || path.join(__dirname, '../data/server.log'),
  runtimeStatePath: process.env.RUNTIME_STATE_PATH || path.join(__dirname, '../data/runtime_state.json'),
  databasePath: process.env.DATABASE_PATH || path.join(__dirname, '../data/wapi.db'),
  port: parseInt(process.env.PORT || '3000'),
  nodeEnv: (process.env.NODE_ENV as 'development' | 'production') || 'development'
}

// Validaciones
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!config.telegramApiId || config.telegramApiId === 0) {
    errors.push('TELEGRAM_API_ID no está configurado')
  }

  if (!config.telegramApiHash) {
    errors.push('TELEGRAM_API_HASH no está configurado')
  }

  if (!config.telegramRelayBotUsername) {
    errors.push('TELEGRAM_RELAY_BOT_USERNAME no está configurado')
  }

  if (!config.whatsappPhoneNumber) {
    errors.push('WHATSAPP_PHONE_NUMBER no está configurado')
  }

  if (config.logFilePath && !path.isAbsolute(config.logFilePath)) {
    try {
      const dir = path.dirname(config.logFilePath)
      if (dir) {
        fs.mkdirSync(dir, { recursive: true })
      }
    } catch {
      // Se creará al escribir el log
    }
  }

  if (config.relayStatePath && !path.isAbsolute(config.relayStatePath)) {
    try {
      const dir = path.dirname(config.relayStatePath)
      if (dir) {
        fs.mkdirSync(dir, { recursive: true })
      }
    } catch {
      // Se creará al guardar el estado
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}
