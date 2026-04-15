import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js'
import { pendingTwoFa, users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { sambaAuth } from '../services/sambaAuth.js';
import { sendOtp } from '../services/mailer.js';
import { randomInt, createHash, randomBytes } from 'crypto';
import { loginLimiter, approveLimiter, verifyLimiter } from '../middlewares/rateLimiter.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { handleError } from '../utils/errorHandler.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { banIp } from '../middlewares/blacklistIp.js';


const auth: Router = Router();

const userSchema = z.object({   
    username: z.string().min(1, "O nome de usuário é obrigatório.").trim(),
    password: z.string().min(1, "A senha é obrigatória").max(30, "A senha pode ter no máximo 30 caracteres."),
})


const verifySchema = z.object({
    pendingId: z.string().uuid(),
    otp: z.string().length(6)
})

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Inicia o fluxo de login com autenticação 2FA
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *                 maxLength: 30
 *     responses:
 *       200:
 *         description: OTP enviado por e-mail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pendingId:
 *                   type: string
 *                   format: uuid
 *       401:
 *         description: Usuário sem permissão
 *       500:
 *         description: Erro interno
 */
auth.post('/login', loginLimiter, async (req: Request, res: Response) => {
    
    try{
        const userIp = req.ip ?? null;
        const result = userSchema.safeParse(req.body);

        if(!result.success){
            return res.status(400).json({
                error: "Oops! Ocorreu um erro na tentativa de login."
            })
        }

        const approveToken = randomBytes(32).toString('hex');
        const approveTokenHash = createHash('sha256').update(approveToken).digest('hex');
        const { username, password } = result.data;

        const resultAuth = await sambaAuth(username, password);

        if(resultAuth === null){
            return res.status(401).json({
                error: "Usuário sem permissão ou não existente."
            })
        }
        const role = resultAuth.role;

        await db.insert(users).values({ username, role}).onConflictDoUpdate({ target: users.username, set: { lastLogin: new Date()}
        });

        const otp = randomInt(100000, 999999).toString();
        const otpHash = createHash('sha256').update(otp).digest('hex');

        const [pending] = await db.insert(pendingTwoFa).values({
            username,
            otpHash,
            approveTokenHash,
            ipAddress: userIp,
            expiresAt: new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60 * 1000)
        }).returning();

        if(!pending){
            return res.status(500).json({
                error: "Erro interno do servidor."
            })
        }

        await sendOtp(username, otp, pending.id, approveToken, userIp ?? 'IP Desconhecido');    

        return res.status(200).json({
            pendingId: pending.id
        })

    }catch(err){
        return handleError(res, err, 'Erro ao realizar login.')
    }
})



/**
 * @swagger
 * /api/auth/approve/{id}:
 *   get:
 *     summary: Aprova o login via link enviado no e-mail
 *     tags: [Auth]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Usuário aprovado
 *       401:
 *         description: Token inválido ou sessão inexistente
 *       410:
 *         description: Código expirado
 */
auth.get('/approve/:id', approveLimiter, async (req: Request, res: Response) => {
    try{
    const id = req.params['id'] as string;
    const token = req.query.token as string;

    if(!token){
        return res.status(400).json({
            error: "Token não informado."
        })
    }

    if(!id){
        return res.status(400).json({
            error: "ID do usuário não informado."
        })
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');


    const searchPending = await db.select().from(pendingTwoFa).where(eq(pendingTwoFa.id, id))

    if(!searchPending[0]){
        return res.status(401).json({
            error: "Não existe nenhuma pendencia de verificação para esse usuário."
        })
    }

    if(searchPending[0].expiresAt < new Date()){
        await db.delete(pendingTwoFa).where(eq(pendingTwoFa.id, id))

        return res.status(410).json({
            error: "Código expirado."
        })
    }

    if (searchPending[0].approveTokenHash !== tokenHash) {
        return res.status(401).json({ error: "Token inválido."});
    }


    const [approved] = await db.update(pendingTwoFa).set({ approved: true, approveTokenHash: '' }).where(eq(pendingTwoFa.id, id)).returning();

    if(!approved){
        return res.redirect(`${env.APP_URL}/approve?status=error`)
    }

    return res.redirect(`${env.APP_URL}/approve?status=success`)

}catch(err){
    logger.error(err, 'Erro ao aprovar usuário.')
    return res.redirect(`${env.APP_URL}/approve?status=error`)
}

});






/**
 * @swagger
 * /api/auth/verify:
 *   post:
 *     summary: Verifica o OTP e cria a sessão
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pendingId, otp]
 *             properties:
 *               pendingId:
 *                 type: string
 *                 format: uuid
 *               otp:
 *                 type: string
 *                 minLength: 6
 *                 maxLength: 6
 *     responses:
 *       200:
 *         description: Login realizado com sucesso
 *       401:
 *         description: Código inválido
 *       403:
 *         description: Verificação ainda não aprovada
 *       410:
 *         description: Código expirado
 */
auth.post('/verify', verifyLimiter, async (req: Request, res: Response) => {
    const result = verifySchema.safeParse(req.body);

    if(!result.success){
        return res.status(401).json({
            error: "OOPS! Ocorreu um erro na tentativa de verificação."
        })
    }

    try{
        const { pendingId, otp } = result.data;

        const searchPending = await db.select().from(pendingTwoFa).where(eq(pendingTwoFa.id, pendingId))


        if(!searchPending[0]){
            return res.status(404).json({
                error: "Não existe nenhuma pendencia de verificação para esse usuário."
            })
        }

        if(searchPending[0].expiresAt < new Date()){
            await db.delete(pendingTwoFa).where(eq(pendingTwoFa.id, pendingId))


            return res.status(410).json({
                error: "Código expirado."
            })
        }


        if(!searchPending[0].approved){
            return res.status(403).json({
                error: "Sua verificação ainda não foi aprovada."
            })
        }

        const MAX_OTP_ATTEMPTS = 5;
        if (searchPending[0].otpAttempts >= MAX_OTP_ATTEMPTS) {
            await db.delete(pendingTwoFa).where(eq(pendingTwoFa.id, pendingId))

            return res.status(429).json({ error: "Muitas tentativas incorretas. Faça login novamente."})
        }


        const hashOtp = createHash('sha256').update(otp).digest('hex');

        if(searchPending[0].otpHash !== hashOtp){
            await db.update(pendingTwoFa).set({ otpAttempts: searchPending[0].otpAttempts + 1 }).where(eq(pendingTwoFa.id, pendingId))
            const remaining = MAX_OTP_ATTEMPTS - searchPending[0].otpAttempts - 1


            return res.status(401).json({
                message: remaining > 0 ? `Código inválido. ${remaining} tentativa(s) restante(s).` : "Código inválido."
            })
        }

        await db.delete(pendingTwoFa).where(eq(pendingTwoFa.id, pendingId))

        const userRecord = await db.select().from(users).where(eq(users.username, searchPending[0].username));

        if(!userRecord[0]){
            return res.status(500).json({
                error: "Erro interno do servidor."
            })
        }

        req.session.userId = userRecord[0].id as string;
        req.session.username = userRecord[0].username as string;
        req.session.role = userRecord[0].role as 'user' | 'admin';

        return res.status(200).json({
            message: "Login realizado com sucesso."
        })

    }catch(err){
        return handleError(res, err, 'Erro ao verificar entrada.')
    }
 


});


/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Encerra a sessão atual
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logout realizado
 *       500:
 *         description: Erro ao encerrar sessão
 */
auth.post('/logout', requireAuth, async (req: Request, res: Response) => {
    try{

        req.session.destroy((err) =>{
            if(err){
                return res.status(500).json({
                    error: "Erro ao encerrar sessão."
                })
            }
            return res.status(200).json({
                message: "Logout realizado com sucesso."
            })
        });


    }catch(err){
        return handleError(res, err, 'Erro ao realizar logout.')
    }

    
});


/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Retorna o usuário da sessão atual
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Dados do usuário
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     username:
 *                       type: string
 *                     role:
 *                       type: string
 *       401:
 *         description: Não autenticado
 */
/**
 * @swagger
 * /api/auth/honeypot:
 *   post:
 *     summary: Registra e bane o IP que tentou acessar o painel admin falso
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: IP banido
 */
auth.post('/honeypot', loginLimiter, async (req: Request, res: Response) => {
    const ip = req.ip
    if (ip) {
        banIp(ip, 'honeypot-admin').catch(err => logger.error(err, 'Erro ao banir IP via honeypot.'))
        logger.warn({ ip }, 'Honeypot /admin triggered — IP banido.')
    }
    return res.status(200).json({ message: 'ok' })
})


auth.get('/me', requireAuth, async (req: Request, res: Response) => {
    try{
        const username = req.session.username
        const role = req.session.role

        return res.status(200).json({
            user: {username, role}
        })

    }catch(err){
        return handleError(res, err, 'Erro ao buscar usuário.')
    }
})
  


export default auth;