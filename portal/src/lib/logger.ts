/**
 * Centralized logging system with configurable log levels.
 *
 * Provides structured logging with different levels (DEBUG, INFO, WARN, ERROR)
 * and environment-based configuration to control verbosity.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogContext {
  component?: string
  operation?: string
  interviewId?: string
  operationId?: string
  [key: string]: unknown
}

class Logger {
  private currentLevel: LogLevel
  private prefix: string

  constructor() {
    // Set log level based on environment
    const envLevel = process.env.LOG_LEVEL?.toLowerCase() || 'info'

    switch (envLevel) {
      case 'debug':
        this.currentLevel = LogLevel.DEBUG
        break
      case 'info':
        this.currentLevel = LogLevel.INFO
        break
      case 'warn':
        this.currentLevel = LogLevel.WARN
        break
      case 'error':
        this.currentLevel = LogLevel.ERROR
        break
      default:
        this.currentLevel = LogLevel.INFO
    }

    this.prefix = `[${process.env.PROJECT_PREFIX || 'prequel'}]`
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.currentLevel
  }

  private formatMessage(
    level: string,
    message: string,
    context?: LogContext
  ): string {
    const timestamp = new Date().toISOString()
    let formatted = `${timestamp} ${this.prefix} [${level}]`

    if (context?.component) {
      formatted += ` [${context.component}]`
    }

    formatted += ` ${message}`

    // Add context details if provided
    if (context) {
      const contextStr = Object.entries(context)
        .filter(([key]) => key !== 'component')
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')

      if (contextStr) {
        formatted += ` (${contextStr})`
      }
    }

    return formatted
  }

  debug(message: string, context?: LogContext) {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(this.formatMessage('DEBUG', message, context))
    }
  }

  info(message: string, context?: LogContext) {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(this.formatMessage('INFO', message, context))
    }
  }

  warn(message: string, context?: LogContext) {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage('WARN', message, context))
    }
  }

  error(message: string, context?: LogContext) {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage('ERROR', message, context))
    }
  }

  /**
   * Create a child logger with pre-set context
   */
  child(context: LogContext): Logger {
    const childLogger = new Logger()
    childLogger.currentLevel = this.currentLevel
    childLogger.prefix = this.prefix

    // Override methods to include context
    const originalDebug = childLogger.debug.bind(childLogger)
    const originalInfo = childLogger.info.bind(childLogger)
    const originalWarn = childLogger.warn.bind(childLogger)
    const originalError = childLogger.error.bind(childLogger)

    childLogger.debug = (message: string, additionalContext?: LogContext) => {
      originalDebug(message, { ...context, ...additionalContext })
    }

    childLogger.info = (message: string, additionalContext?: LogContext) => {
      originalInfo(message, { ...context, ...additionalContext })
    }

    childLogger.warn = (message: string, additionalContext?: LogContext) => {
      originalWarn(message, { ...context, ...additionalContext })
    }

    childLogger.error = (message: string, additionalContext?: LogContext) => {
      originalError(message, { ...context, ...additionalContext })
    }

    return childLogger
  }
}

// Global logger instance
export const logger = new Logger()

// Component-specific loggers
export const schedulerLogger = logger.child({ component: 'scheduler' })
export const operationsLogger = logger.child({ component: 'operations' })
export const terraformLogger = logger.child({ component: 'terraform' })
export const authLogger = logger.child({ component: 'auth' })
