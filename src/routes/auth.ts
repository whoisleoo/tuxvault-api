import { Request, Response, NextFunction, Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js'
import { pendingTwoFa, users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { sambaAuth } from '../services/sambaAuth.js';
import { sendOtp } from '../services/mailer.js';


const auth: Router = Router();

const userSchema = z.object({
    username: z.string(),
    password: z.string(),
})

auth.post('/login', async (req: Request, res: Response) => {
    
    try{
        const userIp = req.ip ?? null;
        const result = userSchema.safeParse(req.body);

        if(!result.success){
            return res.status(400).json({
                message: "Oops! Ocorreu um erro na tentativa de login."
            })
        }

        const { username, password } = result.data;

        const resultAuth = await sambaAuth(username, password);

        if(resultAuth === null){
            return res.status(401).json({
                error: "Usuário sem permissão."
            })
        }
        const role = resultAuth.role;

        await db.insert(users).values({ username, role}).onConflictDoUpdate({ target: users.username, set: { lastLogin: new Date()}
        });

        const requestOtp = await sendOtp(username);

        const [pending] = await db.insert(pendingTwoFa).values({
            username: username,
            otpHash: requestOtp,
            ipAddress: userIp,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000)
        }).returning();


        if(!pending){
            return res.status(500).json({
                error: "Erro interno do servidor."
            })
        }
        

        return res.status(200).json({
            pendingId: pending.id
        })

    }catch(err){
        res.status(500).json({
            error: "Erro interno do servidor."
        })
    }

})

