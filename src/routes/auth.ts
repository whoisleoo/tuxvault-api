import { Request, Response, NextFunction, Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js'
import { pendingTwoFa, users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { sambaAuth } from '../services/sambaAuth.js';


const auth: Router = Router();

const userSchema = z.object({
    username: z.string(),
    password: z.string()
})

auth.post('/login', async (req: Request, res: Response) => {
    
    try{
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

    }catch(err){

    }

    


})

