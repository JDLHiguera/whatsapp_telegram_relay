import { EventEmitter } from 'events'
import fs from 'fs/promises'
import path from 'path'
import readline from 'readline'
import { TelegramClient } from 'telegram'
import { NewMessage } from 'telegram/events'
import { StringSession } from 'telegram/sessions'
import { config } from '../config'
import { RelayEvent, TelegramConnection } from '../types'

export class TelegramService extends EventEmitter {
  private client: TelegramClient | null = null
  private isConnected = false
  private relayBotUsername = ''

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
   * Manejar mensajes entrantes del bot externo
   */
  private async handleIncomingTelegramMessage(event: any): Promise<void> {
    try {
      if (!event?.message || !event.isPrivate) {
        return
      }

      const sender = await event.message.getSender().catch(() => null)
      const senderUsername = (sender as any)?.username?.toLowerCase()

      if (senderUsername !== this.relayBotUsername) {
        return
      }

      const text = String(event.message.message || event.message.text || '').trim()
      if (!text) {
        return
      }

      const relayEvent: RelayEvent = {
        telegramChat: this.relayBotUsername,
        text,
        messageId: event.message.id
      }

      this.emit('message', relayEvent)
    } catch (error) {
      console.error('Error procesando mensaje entrante de Telegram:', error)
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
