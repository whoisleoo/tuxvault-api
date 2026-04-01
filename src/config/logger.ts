import pino from 'pino';
import { env } from './env.js';


export const logger = pino(
    env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}
);