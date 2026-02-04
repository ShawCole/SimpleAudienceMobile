export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function format(level: LogLevel, message: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] [selenium:${level}] ${message}`;
}

export const logger = {
  info(message: string) {
    console.log(format('info', message));
  },
  warn(message: string) {
    console.warn(format('warn', message));
  },
  error(message: string, error?: unknown) {
    console.error(format('error', message));
    if (error) {
      console.error(error);
    }
  },
  debug(message: string) {
    if (process.env.DEBUG_SNiffer === 'true') {
      console.debug(format('debug', message));
    }
  },
};
