import { BaileysService } from './baileys'
import { TelegramService } from './telegram'
import { Database } from '../database/sqlite'
import { RelayEvent } from '../types'
import { config } from '../config'
import fs from 'fs/promises'
import path from 'path'

/**
 * Puente entre WhatsApp secundario y el bot externo de Telegram.
 */
export class BridgeService {
  private baileys: BaileysService
  private telegram: TelegramService
  private db: Database
  private relayTargets: Map<string, string> = new Map()
  private lockedWhatsAppJid: string | null = null

  constructor(baileys: BaileysService, telegram: TelegramService, db: Database) {
    this.baileys = baileys
    this.telegram = telegram
    this.db = db

    this.setupListeners()
    void this.loadRelayState()
  }

  /**
   * Configurar listeners de ambos servicios
   */
  private setupListeners(): void {
    this.baileys.on('message', async (m: any) => {
      try {
        await this.handleWhatsAppMessage(m)
      } catch (error) {
        console.error('❌ Error procesando mensaje de WhatsApp:', error)
      }
    })

    this.telegram.on('message', async (m: any) => {
      try {
        await this.handleTelegramMessage(m)
      } catch (error) {
        console.error('❌ Error procesando mensaje de Telegram:', error)
      }
    })
  }

  /**
   * Procesar mensaje desde WhatsApp
   */
  private async handleWhatsAppMessage(m: any): Promise<void> {
    const { messages } = m
    const botKey = config.telegramRelayBotUsername.toLowerCase()

    for (const msg of messages) {
      if (msg.key.fromMe) {
        continue
      }

      // Soportar tanto LID como formato antiguo
      let whatsappJid = msg.key.remoteJid as string | undefined
      
      // Si es un LID, intentar usar remoteJidAlt (formato antiguo)
      if (whatsappJid?.endsWith('@lid') && msg.key.remoteJidAlt) {
        whatsappJid = msg.key.remoteJidAlt
      }

      if (!whatsappJid || (!whatsappJid.endsWith('@s.whatsapp.net') && !whatsappJid.endsWith('@lid'))) {
        continue
      }

      if (!this.lockedWhatsAppJid) {
        this.lockedWhatsAppJid = whatsappJid
        await this.saveRelayState(whatsappJid)
        console.log(`🔒 Relay bloqueado en ${whatsappJid}`)
      } else if (this.lockedWhatsAppJid !== whatsappJid) {
        continue
      }

      let messageText = ''
      let isAudio = false

      if (msg.message?.conversation) {
        messageText = msg.message.conversation
      } else if (msg.message?.extendedTextMessage?.text) {
        messageText = msg.message.extendedTextMessage.text
      } else if (msg.message?.imageMessage?.caption) {
        messageText = msg.message.imageMessage.caption
      } else if (msg.message?.videoMessage?.caption) {
        messageText = msg.message.videoMessage.caption
      } else if (msg.message?.audioMessage || msg.message?.ptt) {
        isAudio = true
        messageText = '🎙️ Audio'
      } else {
        continue
      }

      try {
        this.relayTargets.set(botKey, whatsappJid)

        // Si es audio, intentar descargar y enviar el archivo
        if (isAudio) {
          try {
            const audioPath = await this.downloadAudioFromWhatsApp(msg)
            if (audioPath) {
              await this.telegram.sendAudio(audioPath)
              await fs.unlink(audioPath).catch(() => {})
            } else {
              await this.telegram.sendMessage('🎙️ Audio recibido en WhatsApp')
            }
          } catch (error) {
            console.error(`❌ Error con audio:`, error)
            await this.telegram.sendMessage('🎙️ Audio recibido en WhatsApp')
          }
        } else {
          console.log(`📲 WhatsApp: ${messageText}`)
          await this.telegram.sendMessage(messageText)
        }

        await this.db.logMessage({
          fromPlatform: 'whatsapp',
          toPlatform: 'telegram',
          sender: whatsappJid,
          content: messageText
        })
      } catch (error) {
        console.error('❌ Error al relayar desde WhatsApp:', error)
      }
    }
  }

  /**
   * Descargar audio desde WhatsApp
   */
  private async downloadAudioFromWhatsApp(msg: any): Promise<string | null> {
    try {
      // @ts-ignore
      const { downloadContentFromMessage } = await import('@whiskeysockets/baileys')
      
      const audioMessage = msg.message?.audioMessage || msg.message?.ptt
      if (!audioMessage?.url) {
        return null
      }

      const stream = await downloadContentFromMessage(audioMessage, 'audio')
      const chunks: any[] = []

      return new Promise((resolve, reject) => {
        stream.on('data', (chunk: any) => chunks.push(chunk))
        stream.on('error', (error: any) => reject(error))
        stream.on('end', async () => {
          try {
            const buffer = Buffer.concat(chunks)
            const tempDir = path.join(__dirname, '../../data/temp')
            await fs.mkdir(tempDir, { recursive: true })

            const tempFilePath = path.join(tempDir, `audio_${Date.now()}.ogg`)
            await fs.writeFile(tempFilePath, buffer)

            resolve(tempFilePath)
          } catch (error) {
            reject(error)
          }
        })
      })
    } catch (error) {
      return null
    }
  }

  /**
   * Procesar mensaje desde Telegram (respuesta del bot externo)
   */
  private async handleTelegramMessage(m: any): Promise<void> {
    const relayEvent = m as RelayEvent
    const botKey = (relayEvent.telegramChat || config.telegramRelayBotUsername).toLowerCase()
    const whatsappJid = this.relayTargets.get(botKey) || this.lockedWhatsAppJid

    if (!whatsappJid) {
      console.log('⚠️ No hay chat de WhatsApp destino')
      return
    }

    try {
      // Si hay media (imagen, video, documento)
      if (relayEvent.media) {
        console.log('📸 Telegram envió media, descargando...')
        const mediaPath = await this.telegram.downloadMedia(relayEvent.media)
        
        if (mediaPath) {
          // Enviar imagen a WhatsApp
          await this.baileys.sendImage(whatsappJid, mediaPath, relayEvent.text || undefined)
          
          // Limpiar archivo temporal
          await fs.unlink(mediaPath).catch(() => {})
          
          const caption = relayEvent.text ? `${relayEvent.text}` : '📸 Imagen'
          console.log(`📸 Imagen relayada a WhatsApp: ${caption}`)
          
          await this.db.logMessage({
            fromPlatform: 'telegram',
            toPlatform: 'whatsapp',
            sender: botKey,
            content: `[IMAGEN] ${relayEvent.text || 'Sin texto'}`
          })
        } else {
          console.error('❌ No se pudo descargar la media de Telegram')
          if (relayEvent.text) {
            // Enviar al menos el texto si la media falló
            await this.baileys.sendMessage(whatsappJid, relayEvent.text)
            await this.db.logMessage({
              fromPlatform: 'telegram',
              toPlatform: 'whatsapp',
              sender: botKey,
              content: relayEvent.text
            })
          }
        }
      } else if (relayEvent.text) {
        // Solo texto
        console.log(`💬 Telegram → WhatsApp: ${relayEvent.text.substring(0, 50)}...`)
        await this.baileys.sendMessage(whatsappJid, relayEvent.text)

        await this.db.logMessage({
          fromPlatform: 'telegram',
          toPlatform: 'whatsapp',
          sender: botKey,
          content: relayEvent.text
        })
      }
    } catch (error) {
      console.error('❌ Error al enviar a WhatsApp:', error)
    }
  }

  private async loadRelayState(): Promise<void> {
    try {
      const raw = await fs.readFile(config.relayStatePath, 'utf8')
      const parsed = JSON.parse(raw) as { whatsappJid?: string }
      if (parsed.whatsappJid) {
        this.lockedWhatsAppJid = parsed.whatsappJid
        this.relayTargets.set(config.telegramRelayBotUsername.toLowerCase(), parsed.whatsappJid)
        console.log(`🔁 Relay restaurado para ${parsed.whatsappJid}`)
      }
    } catch {
      // No hay estado previo
    }
  }

  private async saveRelayState(whatsappJid: string): Promise<void> {
    await fs.mkdir(path.dirname(config.relayStatePath), { recursive: true })
    await fs.writeFile(
      config.relayStatePath,
      JSON.stringify({ whatsappJid, botUsername: config.telegramRelayBotUsername }, null, 2),
      'utf8'
    )
  }

  getStatus(): { lockedWhatsAppJid: string | null; relayTargets: number; relayStatePath: string } {
    return {
      lockedWhatsAppJid: this.lockedWhatsAppJid,
      relayTargets: this.relayTargets.size,
      relayStatePath: config.relayStatePath
    }
  }
}
