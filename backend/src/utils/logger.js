import winston from 'winston';
import { env } from '../config/env.js';

const { combine, timestamp, printf, colorize, errors, splat, json } = winston.format;

const devFormat = printf(({ level, message, timestamp: ts, stack, ...rest }) => {
  const meta = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
  return `${ts} ${level} ${stack || message}${meta}`;
});

export const logger = winston.createLogger({
  level: env.isProd ? 'info' : 'debug',
  format: env.isProd
    ? combine(timestamp(), errors({ stack: true }), splat(), json())
    : combine(colorize(), timestamp({ format: 'HH:mm:ss' }), errors({ stack: true }), splat(), devFormat),
  transports: [new winston.transports.Console()],
});
