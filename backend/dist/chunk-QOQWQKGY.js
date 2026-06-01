// src/lib/logger.ts
var SENSITIVE_FIELDS = [
  "password",
  "passcode",
  "token",
  "apiKey",
  "secret",
  "authorization"
];
var Logger = class _Logger {
  currentLevel;
  prefix;
  useJson;
  constructor() {
    const envLevel = process.env.LOG_LEVEL?.toLowerCase() || "info";
    switch (envLevel) {
      case "debug":
        this.currentLevel = 0 /* DEBUG */;
        break;
      case "info":
        this.currentLevel = 1 /* INFO */;
        break;
      case "warn":
        this.currentLevel = 2 /* WARN */;
        break;
      case "error":
        this.currentLevel = 3 /* ERROR */;
        break;
      default:
        this.currentLevel = 1 /* INFO */;
    }
    this.prefix = process.env.PROJECT_PREFIX || "prequel";
    this.useJson = process.env.NODE_ENV === "production";
  }
  shouldLog(level) {
    return level >= this.currentLevel;
  }
  /**
   * Redact sensitive values from context
   */
  redactSensitive(context) {
    const redacted = {};
    for (const [key, value] of Object.entries(context)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_FIELDS.some((f) => lowerKey.includes(f))) {
        redacted[key] = "[REDACTED]";
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }
  formatMessage(level, message, context) {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const safeContext = context ? this.redactSensitive(context) : void 0;
    if (this.useJson) {
      return JSON.stringify({
        timestamp,
        level,
        service: this.prefix,
        component: safeContext?.component,
        message,
        ...safeContext
      });
    }
    let formatted = `${timestamp} [${this.prefix}] [${level}]`;
    if (safeContext?.component) {
      formatted += ` [${safeContext.component}]`;
    }
    formatted += ` ${message}`;
    if (safeContext) {
      const contextStr = Object.entries(safeContext).filter(([key]) => key !== "component").map(([key, value]) => `${key}=${value}`).join(" ");
      if (contextStr) {
        formatted += ` (${contextStr})`;
      }
    }
    return formatted;
  }
  debug(message, context) {
    if (this.shouldLog(0 /* DEBUG */)) {
      console.log(this.formatMessage("DEBUG", message, context));
    }
  }
  info(message, context) {
    if (this.shouldLog(1 /* INFO */)) {
      console.log(this.formatMessage("INFO", message, context));
    }
  }
  warn(message, context) {
    if (this.shouldLog(2 /* WARN */)) {
      console.warn(this.formatMessage("WARN", message, context));
    }
  }
  error(message, context) {
    if (this.shouldLog(3 /* ERROR */)) {
      console.error(this.formatMessage("ERROR", message, context));
    }
  }
  /**
   * Create a child logger with pre-set context
   */
  child(context) {
    const childLogger = new _Logger();
    childLogger.currentLevel = this.currentLevel;
    childLogger.prefix = this.prefix;
    childLogger.useJson = this.useJson;
    const originalDebug = childLogger.debug.bind(childLogger);
    const originalInfo = childLogger.info.bind(childLogger);
    const originalWarn = childLogger.warn.bind(childLogger);
    const originalError = childLogger.error.bind(childLogger);
    childLogger.debug = (message, additionalContext) => {
      originalDebug(message, { ...context, ...additionalContext });
    };
    childLogger.info = (message, additionalContext) => {
      originalInfo(message, { ...context, ...additionalContext });
    };
    childLogger.warn = (message, additionalContext) => {
      originalWarn(message, { ...context, ...additionalContext });
    };
    childLogger.error = (message, additionalContext) => {
      originalError(message, { ...context, ...additionalContext });
    };
    return childLogger;
  }
};
var logger = new Logger();
var schedulerLogger = logger.child({ component: "scheduler" });
var operationsLogger = logger.child({ component: "operations" });
var terraformLogger = logger.child({ component: "terraform" });
var authLogger = logger.child({ component: "auth" });

export {
  logger,
  schedulerLogger,
  operationsLogger,
  authLogger
};
//# sourceMappingURL=chunk-QOQWQKGY.js.map