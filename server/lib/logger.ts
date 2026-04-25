import pino from 'pino';
import { isProduction } from '../config.ts';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  transport: !isProduction
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: { pid: process.pid },
  formatters: {
    level: (label) => ({ level: label }),
  },
});
