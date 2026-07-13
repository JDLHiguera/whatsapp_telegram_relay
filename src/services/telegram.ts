import { EventEmitter } from 'events'
import fs from 'fs/promises'
import path from 'path'
import readline from 'readline'
import { Api, TelegramClient } from 'telegram'
import { NewMessage, Raw } from 'telegram/events'
import { StringSession } from 'telegram/sessions'
import { config } from '../config'
import { RelayEvent, TelegramConnection } from '../types'

export class TelegramService extends EventEmitter {
  private client: TelegramClient | null = null
  private isConnected = false
  private relayBotUsername = ''
  private relayBotUserId = ''

  constructor() {
    super()
  }

  /**
   * Inicializar cliente de usuario de Telegram
   */
  async connect(): Promise<void> {
    console.log('🔄 Iniciando cliente de Telegram...')

    try {
      this.relayBotUsername = config.telegramRelayBotUsername.replace(/^@/, '').toLowerCase()
      const session = await this.loadSession()

      this.client = new TelegramClient(
        new StringSession(session),
        config.telegramApiId,
        config.telegramApiHash,
        { connectionRetries: 5 }
      )

      await this.client.start({
        phoneNumber: async () => {
          if (config.telegramPhoneNumber) {
            return config.telegramPhoneNumber
          }
          return await this.prompt('Telegram phone number: ')
        },
        password: async () => await this.prompt('Telegram 2FA password (if any): '),
        phoneCode: async () => await this.prompt('Telegram code: '),
        onError: (err) => console.error('Telegram login error:', err)
      })

      await this.saveSession()

      this.client.addEventHandler(
        async (event: any) => {
          await this.handleIncomingTelegramMessage(event)
        },
        new NewMessage({ incoming: true })
      )

      const relayBot = await this.client.getEntity(this.relayBotUsername)
      this.relayBotUserId = String((relayBot as any).id)

      this.client.addEventHandler(
        (update: Api.UpdateUserTyping) => {
          if (String(update.userId) !== this.relayBotUserId) {
            return
          }

          this.emit('typing', update.action instanceof Api.SendMessageTypingAction)
        },
        new Raw({ types: [Api.UpdateUserTyping] })
      )

      this.isConnected = true
      console.log(`✅ Telegram conectado. Relay activo con @${this.relayBotUsername}`)
      this.emit('connected')
    } catch (error) {
      console.error('❌ Error al conectar Telegram:', error)
      this.emit('disconnected', { error })
      throw error
    }
  }

  /**
   * Enviar mensaje al bot de Telegram
   */
  async sendMessage(text: string): Promise<any> {
    if (!this.isConnected || !this.client) {
      throw new Error('Telegram no está conectado')
    }

    try {
      return await this.client.sendMessage(this.relayBotUsername, { message: text })
    } catch (error) {
      console.error('Error al enviar mensaje a Telegram:', error)
      throw error
    }
  }

  /**
   * Enviar audio al bot de Telegram
   */
  async sendAudio(audioPath: string, caption?: string): Promise<any> {
    if (!this.isConnected || !this.client) {
      throw new Error('Telegram no está conectado')
    }

    try {
      const payload: any = {
        file: audioPath
      }
      
      // Solo incluir caption si está proporcionado
      if (caption) {
        payload.caption = caption
      }

      // @ts-ignore
      return await this.client.sendFile(this.relayBotUsername, payload)
    } catch (error) {
      console.error('Error al enviar audio a Telegram:', error)
      throw error
    }
  }

  /**
   * Enviar cualquier archivo (imagen, video, documento) al bot de Telegram
   */
  async sendFile(filePath: string, caption?: string): Promise<any> {
    if (!this.isConnected || !this.client) {
      throw new Error('Telegram no está conectado')
    }

    try {
      const payload: any = {
        file: filePath
      }
      
      if (caption) {
        payload.caption = caption
      }

      // @ts-ignore
      return await this.client.sendFile(this.relayBotUsername, payload)
    } catch (error) {
      console.error('Error al enviar archivo a Telegram:', error)
      throw error
    }
  }

  /**
   * Manejar mensajes entrantes del bot externo
   */
  private async handleIncomingTelegramMessage(event: any): Promise<void> {
    try {
      if (!event?.message || !event.isPrivate) {
        return
      }

      const sender = await event.message.getSender().catch(() => null)
      const senderUsername = (sender as any)?.username?.toLowerCase()
      const senderId = event.message.senderId?.toString()

      const isFromRelayBot = 
        (senderUsername && senderUsername === this.relayBotUsername) ||
        (senderId && senderId === '8509073799') // ID del bot como fallback

      if (!isFromRelayBot) {
        return
      }

      let text = String(event.message.message || event.message.text || '').trim()
      
      // Soporte para RichMessage (mensajes enriquecidos nuevos de Telegram Layer 228+)
      if (!text && event.message.richMessage) {
        text = extractRichMessageText(event.message.richMessage)
      }
      
      // Detectar si hay media (imagen, video, documento)
      let hasMedia = event.message.photo || event.message.video || event.message.document
      if (!hasMedia && event.message.richMessage) {
        const rm = event.message.richMessage
        hasMedia = (rm.photos && rm.photos.length > 0) || (rm.documents && rm.documents.length > 0)
      }
      
      // Si no hay texto ni media, ignorar
      if (!text && !hasMedia) {
        return
      }

      const relayEvent: RelayEvent = {
        telegramChat: this.relayBotUsername,
        text,
        messageId: event.message.id,
        media: hasMedia ? event.message : undefined
      }

      this.emit('message', relayEvent)
    } catch (error) {
      console.error('Error procesando mensaje entrante de Telegram:', error)
    }
  }

  /**
   * Descargar media desde Telegram y guardarla localmente
   */
  async downloadMedia(message: any): Promise<string | null> {
    if (!this.isConnected || !this.client) {
      return null
    }

    try {
      const tempDir = path.join(__dirname, '../../data/temp')
      await fs.mkdir(tempDir, { recursive: true })
      
      // Determinar extensión según tipo de media
      let extension = 'bin'
      if (message.photo) {
        extension = 'jpg'
      } else if (message.video) {
        extension = 'mp4'
      } else if (message.document) {
        extension = message.document.mimeType?.split('/')[1] || 'bin'
      }
      
      const tempFilePath = path.join(tempDir, `media_${Date.now()}.${extension}`)
      
      // Usar downloadFile con media del mensaje
      // @ts-ignore
      const buffer = await this.client.downloadFile(message.media)
      
      if (!buffer) {
        console.error('❌ Buffer vacío al descargar media de Telegram')
        return null
      }
      
      await fs.writeFile(tempFilePath, buffer)
      
      console.log(`✅ Media descargada: ${tempFilePath}`)
      return tempFilePath
    } catch (error) {
      console.error('❌ Error descargando media de Telegram:', error)
      return null
    }
  }

  /**
   * Obtener estado de conexión
   */
  getStatus(): TelegramConnection {
    return {
      isConnected: this.isConnected,
      botUsername: this.relayBotUsername,
      sessionPath: config.telegramSessionPath
    }
  }

  private async loadSession(): Promise<string> {
    try {
      const session = await fs.readFile(config.telegramSessionPath, 'utf8')
      return session.trim()
    } catch {
      return ''
    }
  }

  private async saveSession(): Promise<void> {
    if (!this.client) {
      return
    }

    await fs.mkdir(path.dirname(config.telegramSessionPath), { recursive: true })
    const savedSession = this.client.session.save() as unknown as string
    await fs.writeFile(config.telegramSessionPath, savedSession, 'utf8')
  }

  private prompt(question: string): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close()
        resolve(answer.trim())
      })
    })
  }

  /**
   * Desconectar
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.saveSession().catch(() => undefined)
      await this.client.disconnect()
      this.isConnected = false
      this.emit('disconnected')
      console.log('🔌 Telegram desconectado')
    }
  }
}

/**
 * Extrae texto plano de la estructura RichMessage (mensajes enriquecidos con bloques)
 */
function extractRichMessageText(richMessage: any): string {
  if (!richMessage || !Array.isArray(richMessage.blocks)) {
    return ''
  }

  const texts: string[] = []
  for (const block of richMessage.blocks) {
    if (block) {
      if (block.text) {
        if (typeof block.text === 'string') {
          texts.push(block.text)
        } else if (typeof block.text === 'object' && typeof block.text.text === 'string') {
          texts.push(block.text.text)
        }
      }
    }
  }
  return texts.join('\n').trim()
}
