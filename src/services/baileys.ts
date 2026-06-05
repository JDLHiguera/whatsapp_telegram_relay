import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import path from 'path'
import fs from 'fs/promises'
import { EventEmitter } from 'events'
// @ts-ignore
import qrcode from 'qrcode-terminal'

export class BaileysService extends EventEmitter {
  private sock: any
  private isConnected = false
  private isAuthenticated = false
  private isConnecting = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private suppressNextClose = false
  private readonly authPath = path.join(__dirname, '../../auth_info')

  constructor() {
    super()
  }

  /**
   * Conectar a WhatsApp.
   */
  async connect(): Promise<void> {
    if (this.isConnecting) {
      return
    }

    this.isConnecting = true
    console.log('Iniciando conexion a WhatsApp...')

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authPath)

      const sock = makeWASocket({
        auth: state,
        browser: ['Ubuntu', 'Chrome', '21.0'],
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldIgnoreJid: (_jid: string) => false
      })

      this.sock = sock

      sock.ev.on('connection.update', (update: any) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
          console.log('\nEscanea este codigo QR con tu telefono WhatsApp:\n')
          qrcode.generate(qr, { small: true })
          console.log('\n')
          this.emit('qr', qr)
        }

        if (connection === 'connecting') {
          console.log('Conectando...')
          this.emit('reconnecting')
          return
        }

        if (connection === 'open') {
          console.log('WhatsApp conectado exitosamente')
          this.isConnected = true
          this.isAuthenticated = true
          this.isConnecting = false
          this.emit('connected')
          return
        }

        if (connection === 'close') {
          if (this.suppressNextClose) {
            this.suppressNextClose = false
            this.isConnected = false
            this.isConnecting = false
            return
          }

          const error = lastDisconnect?.error
          const shouldReconnect =
            (error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
          const authExpired = this.isAuthExpiredError(error)

          console.log('Desconectado de WhatsApp:', error)
          this.isConnected = false
          this.isConnecting = false

          this.emit('disconnected', {
            error,
            shouldReconnect,
            authExpired
          })

          if (shouldReconnect) {
            console.log('Reconectando...')
            this.reconnectTimer = setTimeout(() => {
              this.reconnectTimer = null
              void this.connect()
            }, 3000)
          } else {
            console.log('Sesion cerrada. Hay que autenticar WhatsApp de nuevo.')
            this.isAuthenticated = false
            this.emit('logout')
          }
        }
      })

      sock.ev.on('creds.update', saveCreds)

      sock.ev.on('messages.upsert', async (m: any) => {
        this.emit('message', m)
      })

      sock.ev.on('messages.update', (m: any) => {
        this.emit('message-update', m)
      })

      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.isConnected || (!this.isConnecting && !this.isAuthenticated)) {
            clearInterval(checkInterval)
            resolve(null)
          }
        }, 1000)
      })
    } catch (error) {
      console.error('Error al conectar a WhatsApp:', error)
      this.isConnecting = false
      throw error
    }
  }

  /**
   * Borra las credenciales locales y fuerza un login nuevo con QR.
   */
  async resetAuthAndReconnect(): Promise<void> {
    console.log('Reiniciando autenticacion de WhatsApp...')

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    await this.disconnect().catch(() => undefined)
    await this.sleep(500)
    await this.clearAuthDirectory()

    this.sock = null
    this.isConnected = false
    this.isAuthenticated = false
    this.isConnecting = false

    await this.connect()
  }

  async sendMessage(
    jid: string,
    text: string,
    options: { quotedMessage?: any } = {}
  ): Promise<any> {
    if (!this.sock) {
      throw new Error('WhatsApp no esta conectado')
    }

    try {
      return await this.sock.sendMessage(
        jid,
        { text },
        { quoted: options.quotedMessage }
      )
    } catch (error) {
      console.error('Error al enviar mensaje:', error)
      throw error
    }
  }

  async sendImage(jid: string, imagePath: string, caption?: string): Promise<any> {
    if (!this.sock) {
      throw new Error('WhatsApp no esta conectado')
    }

    try {
      const imageBuffer = await fs.readFile(imagePath)

      return await this.sock.sendMessage(jid, {
        image: imageBuffer,
        caption: caption || undefined
      })
    } catch (error) {
      console.error('Error al enviar imagen:', error)
      throw error
    }
  }

  async checkNumberExists(number: string): Promise<boolean> {
    if (!this.sock) {
      throw new Error('WhatsApp no esta conectado')
    }

    try {
      const [result] = await this.sock.onWhatsApp(number)
      return result?.exists || false
    } catch (error) {
      console.error('Error al verificar numero:', error)
      return false
    }
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      isAuthenticated: this.isAuthenticated,
      isConnecting: this.isConnecting
    }
  }

  async disconnect(): Promise<void> {
    if (this.sock) {
      this.suppressNextClose = true
      await this.sock.end()
      this.sock = null
    }

    this.isConnected = false
    this.isAuthenticated = false
    this.isConnecting = false
    console.log('WhatsApp desconectado')
  }

  private isAuthExpiredError(error: any): boolean {
    const statusCode = error?.output?.statusCode
    const reason = String(error?.data?.reason || '').toLowerCase()
    return statusCode === 401 || reason === '401'
  }

  private async clearAuthDirectory(): Promise<void> {
    await fs.mkdir(this.authPath, { recursive: true })

    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const entries = await fs.readdir(this.authPath, { withFileTypes: true })

        await Promise.all(entries.map(async (entry) => {
          const entryPath = path.join(this.authPath, entry.name)
          await fs.rm(entryPath, { recursive: true, force: true })
        }))

        return
      } catch (error: any) {
        if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error?.code) || attempt === 5) {
          throw error
        }

        await this.sleep(500 * attempt)
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
