import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import path from 'path'
import { EventEmitter } from 'events'
// @ts-ignore
import qrcode from 'qrcode-terminal'
import { config } from '../config'

export class BaileysService extends EventEmitter {
  private sock: any
  private isConnected = false
  private isAuthenticated = false

  constructor() {
    super()
  }

  /**
   * Conectar a WhatsApp
   */
  async connect(): Promise<void> {
    console.log('🔄 Iniciando conexión a WhatsApp...')

    try {
      const { state, saveCreds } = await useMultiFileAuthState(
        path.join(__dirname, '../../auth_info')
      )

      const sock = makeWASocket({
        auth: state,
        browser: ['Ubuntu', 'Chrome', '21.0'],
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldIgnoreJid: (jid: string) => false
      })

      // Evento: actualización de conexión
      sock.ev.on('connection.update', (update: any) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
          console.log('\n📱 Escanea este código QR con tu teléfono WhatsApp:\n')
          qrcode.generate(qr, { small: true })
          console.log('\n')
          this.emit('qr', qr)
        }

        if (connection === 'connecting') {
          console.log('⏳ Conectando...')
          this.emit('reconnecting')
        } else if (connection === 'open') {
          console.log('✅ WhatsApp conectado exitosamente')
          this.isConnected = true
          this.isAuthenticated = true
          this.emit('connected')
        } else if (connection === 'close') {
          const shouldReconnect =
            (lastDisconnect?.error as Boom)?.output?.statusCode !==
            DisconnectReason.loggedOut

          console.log('❌ Desconectado de WhatsApp:', lastDisconnect?.error)
          this.emit('disconnected', {
            error: lastDisconnect?.error,
            shouldReconnect
          })

          if (shouldReconnect) {
            console.log('🔄 Reconectando...')
            this.isConnected = false
            setTimeout(() => this.connect(), 3000)
          } else {
            console.log('⚠️ Sesión cerrada. Por favor, vuelve a conectar.')
            this.isConnected = false
            this.isAuthenticated = false
            this.emit('logout')
          }
        }
      })

      // Evento: actualización de credenciales
      sock.ev.on('creds.update', saveCreds)

      // Evento: recepción de mensajes
      sock.ev.on('messages.upsert', async (m: any) => {
        this.emit('message', m)
      })

      // Evento: actualización de estado de mensajes
      sock.ev.on('messages.update', (m: any) => {
        this.emit('message-update', m)
      })

      this.sock = sock

      // Esperar a que se establezca la conexión
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.isConnected) {
            clearInterval(checkInterval)
            resolve(null)
          }
        }, 1000)
      })
    } catch (error) {
      console.error('❌ Error al conectar a WhatsApp:', error)
      throw error
    }
  }

  /**
   * Enviar mensaje de texto
   */
  async sendMessage(
    jid: string,
    text: string,
    options: { quotedMessage?: any } = {}
  ): Promise<any> {
    if (!this.sock) {
      throw new Error('WhatsApp no está conectado')
    }

    try {
      const message = await this.sock.sendMessage(
        jid,
        { text },
        { quoted: options.quotedMessage }
      )
      return message
    } catch (error) {
      console.error('Error al enviar mensaje:', error)
      throw error
    }
  }

  /**
   * Obtener información de un número
   */
  async checkNumberExists(number: string): Promise<boolean> {
    if (!this.sock) {
      throw new Error('WhatsApp no está conectado')
    }

    try {
      const [result] = await this.sock.onWhatsApp(number)
      return result?.exists || false
    } catch (error) {
      console.error('Error al verificar número:', error)
      return false
    }
  }

  /**
   * Obtener estado de conexión
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      isAuthenticated: this.isAuthenticated
    }
  }

  /**
   * Desconectar
   */
  async disconnect(): Promise<void> {
    if (this.sock) {
      await this.sock.end()
      this.isConnected = false
      this.isAuthenticated = false
      console.log('🔌 WhatsApp desconectado')
    }
  }
}
