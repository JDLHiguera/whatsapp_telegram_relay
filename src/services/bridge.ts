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
  private typingExpiryTimer: ReturnType<typeof setTimeout> | null = null
  private typingGeneration = 0

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

    this.telegram.on('typing', (isTyping: boolean) => {
      const whatsappJid = this.lockedWhatsAppJid
      if (!whatsappJid) {
        return
      }

      if (isTyping) {
        this.startWhatsAppTyping(whatsappJid)
      } else {
        void this.stopWhatsAppTyping(whatsappJid)
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

      const messageContent = this.unwrapWhatsAppMessage(msg.message)
      let messageText = ''
      let isAudio = false
      let isImage = false
      let isVideo = false
      let isDocument = false

      if (messageContent?.conversation) {
        messageText = messageContent.conversation
      } else if (messageContent?.extendedTextMessage?.text) {
        messageText = messageContent.extendedTextMessage.text
      } else if (messageContent?.imageMessage) {
        isImage = true
        messageText = messageContent.imageMessage.caption || ''
      } else if (messageContent?.videoMessage) {
        isVideo = true
        messageText = messageContent.videoMessage.caption || ''
      } else if (messageContent?.documentMessage) {
        isDocument = true
        messageText = messageContent.documentMessage.title || messageContent.documentMessage.caption || '📄 Documento'
      } else if (messageContent?.audioMessage || messageContent?.ptt) {
        isAudio = true
        messageText = '🎙️ Audio'
      } else {
        continue
      }

      try {
        this.relayTargets.set(botKey, whatsappJid)

        const isMedia = isAudio || isImage || isVideo || isDocument

        // Si es multimedia, intentar descargar y enviar el archivo
        if (isMedia) {
          try {
            let type: 'image' | 'video' | 'audio' | 'document' = 'audio'
            if (isImage) type = 'image'
            else if (isVideo) type = 'video'
            else if (isDocument) type = 'document'

            console.log(`📸 Descargando multimedia (${type}) desde WhatsApp...`)
            const mediaPath = await this.downloadMediaFromWhatsApp(msg, type)
            
            if (mediaPath) {
              const caption = messageText && messageText !== '🎙️ Audio' ? messageText : undefined
              console.log(`📤 Enviando archivo ${type} a Telegram...`)
              await this.telegram.sendFile(mediaPath, caption)
              await fs.unlink(mediaPath).catch(() => {})
            } else {
              // Fallback a texto si falla la descarga
              await this.telegram.sendMessage(`[${type.toUpperCase()}] Recibido en WhatsApp: ${messageText}`)
            }
          } catch (error) {
            console.error(`❌ Error al relayar media (${isImage ? 'imagen' : isVideo ? 'video' : isAudio ? 'audio' : 'documento'}):`, error)
            await this.telegram.sendMessage(`[MEDIA] Recibido en WhatsApp: ${messageText}`)
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
   * Descargar cualquier archivo multimedia desde WhatsApp
   */
  private async downloadMediaFromWhatsApp(msg: any, type: 'image' | 'video' | 'audio' | 'document'): Promise<string | null> {
    try {
      // @ts-ignore
      const { downloadContentFromMessage } = await import('@whiskeysockets/baileys')
      
      const unwrapped = this.unwrapWhatsAppMessage(msg.message)
      let mediaMessage = unwrapped?.[`${type}Message`]
      if (type === 'audio' && !mediaMessage) {
        mediaMessage = unwrapped?.ptt
      }

      if (!mediaMessage?.url) {
        return null
      }

      const stream = await downloadContentFromMessage(mediaMessage, type)
      const chunks: any[] = []

      return new Promise((resolve, reject) => {
        stream.on('data', (chunk: any) => chunks.push(chunk))
        stream.on('error', (error: any) => reject(error))
        stream.on('end', async () => {
          try {
            const buffer = Buffer.concat(chunks)
            const tempDir = path.join(__dirname, '../../data/temp')
            await fs.mkdir(tempDir, { recursive: true })

            let ext = 'bin'
            if (type === 'image') ext = 'jpg'
            else if (type === 'video') ext = 'mp4'
            else if (type === 'audio') ext = 'ogg'
            else if (type === 'document') {
              const mime = mediaMessage.mimetype || ''
              ext = mime.split('/')[-1] || 'bin'
            }

            const tempFilePath = path.join(tempDir, `media_${type}_${Date.now()}.${ext}`)
            await fs.writeFile(tempFilePath, buffer)

            resolve(tempFilePath)
          } catch (error) {
            reject(error)
          }
        })
      })
    } catch (error) {
      console.error(`Error downloading ${type} from WhatsApp:`, error)
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
      await this.stopWhatsAppTyping(whatsappJid)

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

  private unwrapWhatsAppMessage(message: any): any {
    return message?.ephemeralMessage?.message
      || message?.viewOnceMessageV2?.message
      || message?.viewOnceMessage?.message
      || message
  }

  private startWhatsAppTyping(jid: string): number {
    const generation = ++this.typingGeneration

    void this.baileys.sendTyping(jid, true).catch(() => undefined)

    if (this.typingExpiryTimer) {
      clearTimeout(this.typingExpiryTimer)
    }

    this.typingExpiryTimer = setTimeout(() => {
      void this.stopWhatsAppTyping(jid, generation)
    }, 7000)

    return generation
  }

  private async stopWhatsAppTyping(jid: string, generation?: number): Promise<void> {
    if (generation !== undefined && generation !== this.typingGeneration) {
      return
    }

    this.typingGeneration++

    if (this.typingExpiryTimer) {
      clearTimeout(this.typingExpiryTimer)
      this.typingExpiryTimer = null
    }

    await this.baileys.sendTyping(jid, false).catch(() => undefined)
  }

  async resetRelayState(): Promise<void> {
    if (this.lockedWhatsAppJid) {
      await this.stopWhatsAppTyping(this.lockedWhatsAppJid)
    }

    this.lockedWhatsAppJid = null
    this.relayTargets.clear()

    try {
      await fs.unlink(config.relayStatePath)
    } catch {
      // Si no existe, no pasa nada
    }

    console.log('🧹 Relay reseteado: estado persistido eliminado y chat fijado limpiado')
  }
}
