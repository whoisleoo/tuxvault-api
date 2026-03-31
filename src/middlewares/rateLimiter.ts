import rateLimit from 'express-rate-limit';


export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: "Muitas tentativas de login, aguarde antes de tentar novamente." },
    standardHeaders: true,
    legacyHeaders: false

})