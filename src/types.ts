/**
 * Tipos compartidos de la aplicación
 */

export interface UserMapping {
  id?: number
  whatsappNumber: string
  whatsappJid: string
  telegramChatId?: number
  name?: string
  createdAt?: string
  updatedAt?: string
}

export interface MessageLog {
  id?: number
  fromPlatform: 'whatsapp' | 'telegram'
  toPlatform: 'whatsapp' | 'telegram'
  sender: string
  content: string
  timestamp?: string
  userMappingId?: number
}

export interface Config {
  telegramApiId: number
  telegramApiHash: string
  telegramRelayBotUsername: string
  telegramSessionPath: string
  relayStatePath: string
  telegramPhoneNumber?: string
  whatsappPhoneNumber: string
  alertBotToken?: string
  alertBotAdminChatId?: number
  alertBotSubscribersPath: string
  logFilePath: string
  runtimeStatePath: string
  databasePath: string
  port: number
  nodeEnv: 'development' | 'production'
}

export interface BaileyConnection {
  isConnected: boolean
  isAuthenticated: boolean
  isConnecting?: boolean
  lastUpdate?: Date
}

export interface TelegramConnection {
  isConnected: boolean
  botUsername?: string
  sessionPath?: string
}

export interface AlertBotConnection {
  isEnabled: boolean
  isConnected: boolean
  botUsername?: string
  subscriberCount: number
  subscribersPath?: string
  logFilePath?: string
}

export interface RelayEvent {
  whatsappJid?: string
  telegramChat?: string
  text: string
  messageId?: number
  media?: any  // GramJS message object con photo/video/document
}
