/**
 * MobileLogger — structured logger for the JabbelPin mobile app.
 *
 * Rules:
 * - Never use console.log directly in the app — always use MobileLogger
 * - In test environment: all methods are no-ops (zero noise in test output)
 * - In development: logs to console with structured JSON
 * - In production: structured JSON (ready for remote log shipping)
 *
 * NEVER log: audio payload bytes, JWT tokens, or PII
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogContext = Record<string, unknown>;

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
}

const isTest = process.env['NODE_ENV'] === 'test';
const isDev = process.env['NODE_ENV'] === 'development' || __DEV__;

function formatEntry(level: LogLevel, context: LogContext | string, message?: string): LogEntry {
  if (typeof context === 'string') {
    return {
      level,
      message: context,
      timestamp: new Date().toISOString(),
    };
  }
  return {
    level,
    message: message ?? '',
    timestamp: new Date().toISOString(),
    context,
  };
}

function emit(entry: LogEntry): void {
  if (isTest) return; // Silent in tests

  const output = JSON.stringify(entry);

  if (isDev) {
    // eslint-disable-next-line no-console -- MobileLogger is the ONLY place console is used
    const consoleFn = entry.level === 'error'
      ? console.error
      : entry.level === 'warn'
        ? console.warn
        : console.log;
    consoleFn(`[${entry.level.toUpperCase()}] ${entry.message}`, entry.context ?? '');
  } else {
    // Production: structured JSON to stdout for log aggregation
    // eslint-disable-next-line no-console -- intentional production logging
    console.log(output);
  }
}

export class MobileLogger {
  private readonly component: string;

  constructor(component: string) {
    this.component = component;
  }

  debug(contextOrMessage: LogContext | string, message?: string): void {
    const entry = formatEntry('debug', contextOrMessage, message);
    emit({ ...entry, context: { ...entry.context, component: this.component } });
  }

  info(contextOrMessage: LogContext | string, message?: string): void {
    const entry = formatEntry('info', contextOrMessage, message);
    emit({ ...entry, context: { ...entry.context, component: this.component } });
  }

  warn(contextOrMessage: LogContext | string, message?: string): void {
    const entry = formatEntry('warn', contextOrMessage, message);
    emit({ ...entry, context: { ...entry.context, component: this.component } });
  }

  error(contextOrMessage: LogContext | string, message?: string): void {
    const entry = formatEntry('error', contextOrMessage, message);
    emit({ ...entry, context: { ...entry.context, component: this.component } });
  }
}

// Declare __DEV__ for TypeScript (injected by Metro)
declare const __DEV__: boolean;
