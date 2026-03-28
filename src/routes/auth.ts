import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js'
import { pendingTwoFa, users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { sambaAuth } from '../services/sambaAuth.js';
import { sendOtp } from '../services/mailer.js';
import { createHash } from 'crypto';



const auth: Router = Router();

const userSchema = z.object({   
    username: z.string().min(1, "O nome de usuário é obrigatório.").trim(),
    password: z.string().min(1, "A senha é obrigatória").max(30, "A senha pode ter no máximo 30 caracteres."),
})


const verifySchema = z.object({
    pendingId: z.uuid(),
    otp: z.string().length(6)
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



auth.get('/approve/:id', async (req: Request, res: Response) => {
    try{
    const id = req.params['id'] as string;

    if(!id){
        return res.status(400).json({
            error: "ID do usuário não informado."
        })
    }


    const searchPending = await db.select().from(pendingTwoFa).where(eq(pendingTwoFa.id, id))

    if(!searchPending[0]){
        return res.status(401).json({
            error: "Não existe nenhuma pendencia de verificação para esse usuário."
        })
    }

    if(searchPending[0].expiresAt < new Date()){
        return res.status(410).json({
            error: "Código expirado."
        })
    }

    await db.update(pendingTwoFa).set({ approved: true }).where(eq(pendingTwoFa.id, id));

    return res.status(200).json({
        message: "Usuário aprovado."
    })

}catch(err){
    res.status(500).json({
        error: "Erro interno do servidor."
    })
}

});






auth.post('/verify', async (req: Request, res: Response) => {
    const result = verifySchema.safeParse(req.body);

    if(!result.success){
        return res.status(400).json({
            message: "OOPS! Ocorreu um erro na tentativa de verificação."
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
            return res.status(410).json({
                error: "Código expirado."
            })
        }


        if(!searchPending[0].approved){
            return res.status(403).json({
                message: "Sua verificação ainda não foi aprovada."
            })
        }

        const hashOtp = createHash('sha256').update(otp).digest('hex');

        if(searchPending[0].otpHash !== hashOtp){
            return res.status(401).json({
                message: "Código inválido."
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
        res.status(500).json({
            error: "Erro interno do servidor."
        })
    }
 


});


auth.post('/logout', async (req: Request, res: Response) => {
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
        return res.status(500).json({
            message: "Erro interno do servidor."
        })
    }

    
});