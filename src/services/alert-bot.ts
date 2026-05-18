import TelegramBot from 'node-telegram-bot-api'
import fs from 'fs/promises'
import path from 'path'
import { AlertBotConnection } from '../types'
import { readLogTail } from './logger'

interface StatusProvider {
  (): Promise<string> | string
}

interface AlertBotOptions {
  token?: string
  subscribersPath: string
  logFilePath: string
  statusProvider: StatusProvider
}

type AlertLevel = 'info' | 'warning' | 'error'

type DashboardSection = 'main' | 'status' | 'logs' | 'help'

export class AlertBotService {
  private bot: TelegramBot | null = null
  private readonly token?: string
  private readonly subscribersPath: string
  private readonly logFilePath: string
  private readonly statusProvider: StatusProvider
  private readonly subscribers = new Set<string>()
  private readonly enabled: boolean

  constructor(options: AlertBotOptions) {
    this.token = options.token?.trim()
    this.subscribersPath = options.subscribersPath
    this.logFilePath = options.logFilePath
    this.statusProvider = options.statusProvider
    this.enabled = Boolean(this.token)
  }

  async connect(): Promise<void> {
    await this.loadSubscribers()

    if (!this.enabled || !this.token) {
      console.log('ℹ️ Bot de alertas desactivado: falta TELEGRAM_ALERT_BOT_TOKEN')
      return
    }

    this.bot = new TelegramBot(this.token, { polling: true })

    this.bot.on('polling_error', (error) => {
      console.error('❌ Error de polling del bot de alertas:', error)
    })

    this.bot.on('callback_query', async (query) => {
      await this.handleCallback(query)
    })

    this.bot.on('message', async (message) => {
      await this.handleMessage(message)
    })

    await this.sendWelcomeToSubscribers()
    console.log(`✅ Bot de alertas conectado. Suscriptores: ${this.subscribers.size}`)
  }

  getStatus(): AlertBotConnection {
    return {
      isEnabled: this.enabled,
      isConnected: Boolean(this.bot),
      subscriberCount: this.subscribers.size,
      logFilePath: this.logFilePath,
      subscribersPath: this.subscribersPath
    }
  }

  async notify(title: string, body: string, level: AlertLevel = 'info'): Promise<void> {
    if (!this.bot || this.subscribers.size === 0) {
      return
    }

    const emoji = level === 'error' ? '🚨' : level === 'warning' ? '⚠️' : 'ℹ️'
    const text = `<b>${emoji} ${this.escapeHtml(title)}</b>\n\n${this.escapeHtml(body)}`

    await this.broadcast(text, { parse_mode: 'HTML' })
  }

  async shutdown(): Promise<void> {
    if (this.bot) {
      await this.bot.stopPolling()
      this.bot = null
    }
  }

  private async handleMessage(message: TelegramBot.Message): Promise<void> {
    if (!message.text) {
      return
    }

    const chatId = message.chat.id
    const text = message.text.trim().toLowerCase()

    if (text === '/start' || text === '/menu' || text === '/panel') {
      await this.subscribe(chatId)
      await this.renderDashboard(chatId, 'main')
      return
    }

    if (this.matches(text, ['estado', 'status'])) {
      await this.renderDashboard(chatId, 'status')
      return
    }

    if (this.matches(text, ['logs', 'logs recientes', 'ver logs'])) {
      await this.renderDashboard(chatId, 'logs')
      return
    }

    if (this.matches(text, ['suscribirme', 'alertas on', 'activar alertas'])) {
      await this.subscribe(chatId)
      await this.renderDashboard(chatId, 'main', '✅ Alertas activadas para este chat.')
      return
    }

    if (this.matches(text, ['desuscribirme', 'alertas off', 'desactivar alertas'])) {
      await this.unsubscribe(chatId)
      await this.reply(chatId, '✅ Alertas desactivadas para este chat.')
      return
    }

    if (this.matches(text, ['ayuda', 'help'])) {
      await this.renderDashboard(chatId, 'help')
      return
    }

    if (this.matches(text, ['refrescar', 'refresh'])) {
      await this.renderDashboard(chatId, 'main')
    }
  }

  private async handleCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id
    const data = query.data || ''

    if (!chatId) {
      return
    }

    await this.bot?.answerCallbackQuery(query.id)

    if (data === 'dashboard:main') {
      await this.subscribe(chatId)
      await this.renderDashboard(chatId, 'main', undefined, query.message?.message_id)
      return
    }

    if (data === 'dashboard:status') {
      await this.renderDashboard(chatId, 'status', undefined, query.message?.message_id)
      return
    }

    if (data === 'dashboard:logs') {
      await this.renderDashboard(chatId, 'logs', undefined, query.message?.message_id)
      return
    }

    if (data === 'dashboard:help') {
      await this.renderDashboard(chatId, 'help', undefined, query.message?.message_id)
      return
    }

    if (data === 'alerts:on') {
      await this.subscribe(chatId)
      await this.renderDashboard(chatId, 'main', '✅ Alertas activadas.', query.message?.message_id)
      return
    }

    if (data === 'alerts:off') {
      await this.unsubscribe(chatId)
      await this.reply(chatId, '✅ Alertas desactivadas para este chat.')
      return
    }

    if (data === 'dashboard:refresh') {
      await this.renderDashboard(chatId, 'main', undefined, query.message?.message_id)
    }
  }

  private async renderDashboard(
    chatId: number,
    section: DashboardSection,
    notice?: string,
    messageId?: number
  ): Promise<void> {
    const text = await this.buildDashboardText(chatId, section, notice)
    const options = this.buildDashboardKeyboard(chatId, section)

    if (messageId) {
      try {
        await this.bot?.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          ...options
        })
        return
      } catch {
        // Si editar falla, seguimos con un mensaje nuevo
      }
    }

    await this.reply(chatId, text, {
      parse_mode: 'HTML',
      ...options
    })
  }

  private async buildDashboardText(chatId: number, section: DashboardSection, notice?: string): Promise<string> {
    const status = await this.statusProvider()
    const heading = '🧭 <b>WAPI Control Center</b>'
    const subtitle = 'Panel de alertas, estado y logs en un solo lugar.'
    const noticeBlock = notice ? `\n\n${this.escapeHtml(notice)}` : ''
    const chatAlertsEnabled = this.isSubscribed(chatId)
    const chatAlertsLine = chatAlertsEnabled
      ? '🟢 <b>Alertas en este chat</b>: activadas'
      : '⚪ <b>Alertas en este chat</b>: desactivadas'

    if (section === 'status') {
      return [
        heading,
        subtitle,
        noticeBlock,
        '',
        chatAlertsLine,
        '',
        '📊 <b>Estado actual</b>',
        `<pre>${this.escapeHtml(status)}</pre>`
      ].join('\n')
    }

    if (section === 'logs') {
      const logs = await readLogTail(this.logFilePath, 30)
      return [
        heading,
        subtitle,
        noticeBlock,
        '',
        chatAlertsLine,
        '',
        '🧾 <b>Últimos logs del servidor</b>',
        `<pre>${this.escapeHtml(logs)}</pre>`
      ].join('\n')
    }

    if (section === 'help') {
      return [
        heading,
        subtitle,
        noticeBlock,
        '',
        chatAlertsLine,
        '',
        '📝 <b>Qué puedes hacer aquí</b>',
        '• Ver estado del relay y de las conexiones',
        '• Revisar los últimos logs del servidor',
        '• Activar o desactivar alertas',
        '• Recibir avisos si WhatsApp o Telegram caen'
      ].join('\n')
    }

    return [
      heading,
      subtitle,
      noticeBlock,
      '',
      chatAlertsLine,
      `👥 <b>Suscriptores</b>: ${this.subscribers.size}`,
      '',
      this.formatStatusSummary(status)
    ].join('\n')
  }

  private buildDashboardKeyboard(chatId: number, section: DashboardSection): Record<string, unknown> {
    const subscribed = this.isSubscribed(chatId)
    return {
      reply_markup: {
        inline_keyboard: [
          [
            { text: section === 'main' ? '• Inicio' : 'Inicio', callback_data: 'dashboard:main' },
            { text: 'Estado', callback_data: 'dashboard:status' },
            { text: 'Logs', callback_data: 'dashboard:logs' }
          ],
          [
            { text: subscribed ? '✅ Alertas activas' : 'Activar alertas', callback_data: 'alerts:on' },
            { text: subscribed ? 'Desactivar alertas' : '⚪ Alertas apagadas', callback_data: 'alerts:off' }
          ],
          [
            { text: 'Refrescar', callback_data: 'dashboard:refresh' },
            { text: 'Ayuda', callback_data: 'dashboard:help' }
          ]
        ]
      }
    }
  }

  private formatStatusSummary(status: string): string {
    const normalized = status.toLowerCase()
    const whatsapp = normalized.includes('whatsapp: conectado') ? '🟢 WhatsApp conectado' : '🔴 WhatsApp desconectado'
    const telegram = normalized.includes('telegram: conectado') ? '🟢 Telegram conectado' : '🔴 Telegram desconectado'
    const relay = normalized.includes('relay: sin chat fijado') ? '🟠 Relay sin chat fijo' : '🟢 Relay con chat fijado'
    const alerts = normalized.includes('alertas: activas') ? '🟢 Alertas activas' : '⚪ Alertas desactivadas'

    return [whatsapp, telegram, relay, alerts].join('\n')
  }

  private async sendWelcomeToSubscribers(): Promise<void> {
    if (!this.bot || this.subscribers.size === 0) {
      return
    }

    await this.broadcast(
      '<b>✅ Bot de alertas activo</b>\n\nAbre <code>/start</code> para ver el panel o usa los botones inline.',
      { parse_mode: 'HTML' }
    )
  }

  private async subscribe(chatId: number): Promise<void> {
    const key = chatId.toString()
    if (!this.subscribers.has(key)) {
      this.subscribers.add(key)
      await this.saveSubscribers()
      console.info(`🔔 Alertas activadas para el chat ${chatId}`)
    }
  }

  private async unsubscribe(chatId: number): Promise<void> {
    const key = chatId.toString()
    if (this.subscribers.delete(key)) {
      await this.saveSubscribers()
      console.info(`🔕 Alertas desactivadas para el chat ${chatId}`)
    }
  }

  private async broadcast(text: string, options: any = {}): Promise<void> {
    if (!this.bot) {
      return
    }

    for (const chatId of this.subscribers) {
      try {
        await this.bot.sendMessage(Number(chatId), text, options)
      } catch (error) {
        console.error(`❌ Error enviando alerta a ${chatId}:`, error)
      }
    }
  }

  private async reply(chatId: number, text: string, options: Record<string, unknown> = {}): Promise<void> {
    if (!this.bot) {
      return
    }

    await this.bot.sendMessage(chatId, text, options)
  }

  private matches(text: string, values: string[]): boolean {
    return values.some((value) => text === value.toLowerCase() || text === `/${value.toLowerCase()}`)
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  private async loadSubscribers(): Promise<void> {
    try {
      const raw = await fs.readFile(this.subscribersPath, 'utf8')
      const parsed = JSON.parse(raw) as { subscribers?: string[] }
      for (const subscriber of parsed.subscribers || []) {
        this.subscribers.add(subscriber)
      }
    } catch {
      // Sin suscriptores todavía
    }
  }

  private async saveSubscribers(): Promise<void> {
    await fs.mkdir(path.dirname(this.subscribersPath), { recursive: true })
    await fs.writeFile(
      this.subscribersPath,
      JSON.stringify({ subscribers: [...this.subscribers] }, null, 2),
      'utf8'
    )
  }

  private isSubscribed(chatId: number): boolean {
    return this.subscribers.has(chatId.toString())
  }
}