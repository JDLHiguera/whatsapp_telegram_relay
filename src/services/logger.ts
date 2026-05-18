import fs from 'fs/promises'
import path from 'path'
import util from 'util'

let installed = false
let logFilePath = ''

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console)
}

export async function installFileLogger(filePath: string): Promise<void> {
  logFilePath = filePath

  await fs.mkdir(path.dirname(filePath), { recursive: true })

  if (installed) {
    return
  }

  const wrap = (level: 'info' | 'warn' | 'error' | 'debug', writer: (...args: any[]) => void) => {
    return (...args: any[]) => {
      writer(...args)
      void appendLog(level, args)
    }
  }

  console.log = wrap('info', originalConsole.log)
  console.info = wrap('info', originalConsole.info)
  console.warn = wrap('warn', originalConsole.warn)
  console.error = wrap('error', originalConsole.error)
  console.debug = wrap('debug', originalConsole.debug)

  installed = true
}

export async function appendLog(level: 'info' | 'warn' | 'error' | 'debug', args: any[]): Promise<void> {
  if (!logFilePath) {
    return
  }

  const timestamp = new Date().toISOString()
  const message = util.format(...args)
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`

  try {
    await fs.appendFile(logFilePath, line, 'utf8')
  } catch {
    // No bloqueamos el proceso si el log falla
  }
}

export async function readLogTail(filePath: string, lines = 40): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf8')
    const allLines = content.split(/\r?\n/).filter(Boolean)
    const tail = allLines.slice(-lines)
    return tail.join('\n') || 'Sin entradas en el log todavía.'
  } catch {
    return 'No hay archivo de log disponible todavía.'
  }
}