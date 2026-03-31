import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { users } from '../db/schema.js';
import { db } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { sambaUser } from '../services/sambaUser.js';
import { requireAdmin } from '../middlewares/requireAdmin.js';




const user: Router = Router();


user.get('/', requireAdmin, async (req: Request, res: Response) => {
    try{        
       const users = await sambaUser();

        return res.status(200).json({
            users
        })

} catch(err) {
    if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues })
    }
    res.status(500).json({ error: "Erro interno do servidor." })
}

});



user.get('/:username', requireAdmin, async (req: Request, res: Response) => {
    try{        
        const username = req.params['username'] as string;
        const result = await db.select().from(users).where((eq(users.username, username)));

        if(!result[0]){
            return res.status(404).json({
                error: "Usuário com esse nome não encontrado."
            })
        }

        return res.status(200).json({
            user: result[0]
        })

} catch(err) {
    if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues })
    }
    res.status(500).json({ error: "Erro interno do servidor." })
}

});



user.patch('/:username/role', requireAdmin, async (req: Request, res: Response) => {
    try{        
        const username = req.params['username'] as string;
        const result = await db.select().from(users).where((eq(users.username, username)));

        if(!result[0]){
            return res.status(404).json({
                error: "Usuário com esse nome não encontrado."
            })
        }
    
        const switchRole = result[0].role === 'admin' ? 'user' : 'admin';
        

        const [roleswitcher] = await db.update(users).set({ role: switchRole }).where(eq(users.username, username)).returning();

        return res.status(200).json({
            roleswitcher
        })


} catch(err) {
    if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues })
    }
    res.status(500).json({ error: "Erro interno do servidor." })
}

}); 






user.delete('/:username', requireAdmin, async (req: Request, res: Response) => {
    try{        
        const username = req.params['username'] as string;
        const result = await db.select().from(users).where((eq(users.username, username)));

        if(!result[0]){
            return res.status(404).json({
                error: "Usuário com esse nome não encontrado."
            })
        }
        
        await db.delete(users).where(eq(users.username, username));

        

        return res.status(200).json({
            message: `${username} foi removido com sucesso.`
        })


} catch(err) {
    if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues })
    }
    res.status(500).json({ error: "Erro interno do servidor." })
}

}); 



export default user