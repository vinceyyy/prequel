/**
 * Centralized logging system with configurable log levels.
 *
 * Provides structured logging with different levels (DEBUG, INFO, WARN, ERROR)
 * and environment-based configuration to control verbosity.
 *
 * Features:
 * - Structured JSON output for CloudWatch Logs Insights
 * - Component-based child loggers
 * - Request ID tracking for distributed tracing
 * - Automatic redaction of sensitive fields
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
  requestId?: string
  [key: string]: unknown
}

// Fields that should be redacted in logs
const SENSITIVE_FIELDS = [
  'password',
  'passcode',
  'token',
  'apiKey',
  'secret',
  'authorization',
]

class Logger {
  private currentLevel: LogLevel
  private prefix: string
  private useJson: boolean

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

    this.prefix = process.env.PROJECT_PREFIX || 'prequel'
    // Use JSON format in production for CloudWatch Logs Insights
    this.useJson = process.env.NODE_ENV === 'production'
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.currentLevel
  }

  /**
   * Redact sensitive values from context
   */
  private redactSensitive(context: LogContext): LogContext {
    const redacted: LogContext = {}
    for (const [key, value] of Object.entries(context)) {
      const lowerKey = key.toLowerCase()
      if (SENSITIVE_FIELDS.some(f => lowerKey.includes(f))) {
        redacted[key] = '[REDACTED]'
      } else {
        redacted[key] = value
      }
    }
    return redacted
  }

  private formatMessage(
    level: string,
    message: string,
    context?: LogContext
  ): string {
    const timestamp = new Date().toISOString()
    const safeContext = context ? this.redactSensitive(context) : undefined

    // JSON format for production (CloudWatch Logs Insights)
    if (this.useJson) {
      return JSON.stringify({
        timestamp,
        level,
        service: this.prefix,
        component: safeContext?.component,
        message,
        ...safeContext,
      })
    }

    // Human-readable format for development
    let formatted = `${timestamp} [${this.prefix}] [${level}]`

    if (safeContext?.component) {
      formatted += ` [${safeContext.component}]`
    }

    formatted += ` ${message}`

    // Add context details if provided
    if (safeContext) {
      const contextStr = Object.entries(safeContext)
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
    childLogger.useJson = this.useJson

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
