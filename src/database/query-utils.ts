/**
 * Módulo de utilidades para consultas de BD
 * Aquí se pueden agregar funciones adicionales para trabajar con la BD
 */

import { Database } from '../database/sqlite'

export class QueryUtils {
  constructor(private db: Database) {}

  /**
   * Obtener todas las conversaciones de un usuario
   */
  async getConversationHistory(mappingId: number, limit: number = 50): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db['db'].all(
        `
        SELECT * FROM message_logs 
        WHERE userMappingId = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
        `,
        [mappingId, limit],
        (err, rows) => {
          if (err) reject(err)
          else resolve(rows || [])
        }
      )
    })
  }

  /**
   * Obtener estadísticas de mensajes
   */
  async getMessageStats(mappingId: number): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db['db'].get(
        `
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN fromPlatform = 'whatsapp' THEN 1 ELSE 0 END) as from_whatsapp,
          SUM(CASE WHEN fromPlatform = 'telegram' THEN 1 ELSE 0 END) as from_telegram,
          MAX(timestamp) as last_message
        FROM message_logs
        WHERE userMappingId = ?
        `,
        [mappingId],
        (err, row) => {
          if (err) reject(err)
          else resolve(row || {})
        }
      )
    })
  }

  /**
   * Obtener usuario más activo
   */
  async getMostActiveUser(): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db['db'].get(
        `
        SELECT 
          um.id,
          um.whatsappNumber,
          um.telegramChatId,
          COUNT(ml.id) as message_count
        FROM user_mappings um
        LEFT JOIN message_logs ml ON um.id = ml.userMappingId
        GROUP BY um.id
        ORDER BY message_count DESC
        LIMIT 1
        `,
        (err, row) => {
          if (err) reject(err)
          else resolve(row || null)
        }
      )
    })
  }
}
