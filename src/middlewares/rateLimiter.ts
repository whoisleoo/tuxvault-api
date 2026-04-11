import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

export const loginLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    max: env.RATE_LIMIT_MAX_ATTEMPTS,
    message: { error: "Muitas tentativas de login, aguarde antes de tentar novamente." },
    standardHeaders: true,
    legacyHeaders: false,
})

export const approveLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 20,
    message: { error: "Muitas tentativas, aguarde antes de tentar novamente." },
    standardHeaders: true,
    legacyHeaders: false,
})

export const verifyLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 5,
    message: { error: "Muitas tentativas de verificação, aguarde antes de tentar novamente." },
    standardHeaders: true,
    legacyHeaders: false,
})

export const rateLimiter = loginLimiter