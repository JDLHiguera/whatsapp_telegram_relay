import sqlite3 from 'sqlite3'
import path from 'path'
import { UserMapping, MessageLog } from '../types'

export class Database {
  private db: sqlite3.Database
  private dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Error abriendo BD:', err)
      } else {
        console.log('✅ Conectado a SQLite en:', dbPath)
      }
    })
  }

  /**
   * Inicializar tablas
   */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        // Tabla de mapeos usuario
        this.db.run(`
          CREATE TABLE IF NOT EXISTS user_mappings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            whatsappNumber TEXT NOT NULL UNIQUE,
            whatsappJid TEXT NOT NULL UNIQUE,
            telegramChatId INTEGER NOT NULL UNIQUE,
            name TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `)

        // Tabla de logs de mensajes
        this.db.run(`
          CREATE TABLE IF NOT EXISTS message_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fromPlatform TEXT NOT NULL CHECK(fromPlatform IN ('whatsapp', 'telegram')),
            toPlatform TEXT NOT NULL CHECK(toPlatform IN ('whatsapp', 'telegram')),
            sender TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            userMappingId INTEGER,
            FOREIGN KEY (userMappingId) REFERENCES user_mappings(id)
          )
        `)

        this.db.run(
          `CREATE INDEX IF NOT EXISTS idx_user_mappings_whatsapp ON user_mappings(whatsappNumber)`,
          () => {
            this.db.run(
              `CREATE INDEX IF NOT EXISTS idx_user_mappings_telegram ON user_mappings(telegramChatId)`,
              () => {
                resolve()
              }
            )
          }
        )
      })
    })
  }

  /**
   * Obtener mapeo por número de WhatsApp
   */
  async getUserByWhatsApp(whatsappNumber: string): Promise<UserMapping | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM user_mappings WHERE whatsappNumber = ?',
        [whatsappNumber],
        (err, row: any) => {
          if (err) reject(err)
          else resolve(row || null)
        }
      )
    })
  }

  /**
   * Obtener mapeo por chat de Telegram
   */
  async getUserByTelegram(telegramChatId: number): Promise<UserMapping | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM user_mappings WHERE telegramChatId = ?',
        [telegramChatId],
        (err, row: any) => {
          if (err) reject(err)
          else resolve(row || null)
        }
      )
    })
  }

  /**
   * Crear nuevo mapeo de usuario
   */
  async createUserMapping(mapping: UserMapping): Promise<UserMapping> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO user_mappings (whatsappNumber, whatsappJid, telegramChatId, name)
         VALUES (?, ?, ?, ?)`,
        [mapping.whatsappNumber, mapping.whatsappJid, mapping.telegramChatId, mapping.name],
        function (err) {
          if (err) reject(err)
          else {
            mapping.id = this.lastID
            resolve(mapping)
          }
        }
      )
    })
  }

  /**
   * Obtener todos los mapeos
   */
  async getAllUserMappings(): Promise<UserMapping[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM user_mappings ORDER BY createdAt DESC',
        (err, rows: any[]) => {
          if (err) reject(err)
          else resolve(rows || [])
        }
      )
    })
  }

  /**
   * Registrar mensaje en log
   */
  async logMessage(log: MessageLog): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO message_logs (fromPlatform, toPlatform, sender, content, userMappingId)
         VALUES (?, ?, ?, ?, ?)`,
        [log.fromPlatform, log.toPlatform, log.sender, log.content, log.userMappingId],
        (err) => {
          if (err) reject(err)
          else resolve()
        }
      )
    })
  }

  /**
   * Cerrar conexión
   */
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err)
        else {
          console.log('🔌 Conexión a BD cerrada')
          resolve()
        }
      })
    })
  }
}
