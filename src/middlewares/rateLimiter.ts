import rateLimit from 'express-rate-limit';



/*
*     LEMBRETE:
*     Adicionar um env pra cuidar do windowMs e do Max de forma dinamica.
*     lembrar de formatar no env.ts
* 
*/

export const rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: "Muitas tentativas de login, aguarde antes de tentar novamente." },
    standardHeaders: true,
    legacyHeaders: false
})