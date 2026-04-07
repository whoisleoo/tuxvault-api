import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { users } from '../db/schema.js';
import { db } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { sambaUser } from '../services/sambaUser.js';
import { requireAdmin } from '../middlewares/requireAdmin.js';
import { logger } from '../config/logger.js';



const user: Router = Router();


/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Lista todos os usuários Samba
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: Lista de usuários
 *       401:
 *         description: Não autenticado
 *       403:
 *         description: Sem permissão de admin
 */
user.get('/', requireAdmin, async (req: Request, res: Response) => {
    try{        
        const sambaUsers = await sambaUser();

        return res.status(200).json({
            sambaUsers
        })

} catch(err) {
    if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues })
    }
    logger.error(err, 'Erro ao encontrar usuários.');
    res.status(500).json({ error: "Erro interno do servidor." })
}

});



/**
 * @swagger
 * /api/users/{username}:
 *   get:
 *     summary: Retorna dados de um usuário pelo username
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Dados do usuário
 *       404:
 *         description: Usuário não encontrado
 */
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
    logger.error(err, 'Erro ao encontrar usuário.');
    res.status(500).json({ error: "Erro interno do servidor." })
}

});



/**
 * @swagger
 * /api/users/{username}/role:
 *   patch:
 *     summary: Alterna o cargo do usuário entre user e admin
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Cargo alterado
 *       404:
 *         description: Usuário não encontrado
 */
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
    logger.error(err, 'Erro ao alterar cargo.');
    res.status(500).json({ error: "Erro interno do servidor." })
}

}); 






/**
 * @swagger
 * /api/users/{username}:
 *   delete:
 *     summary: Remove um usuário do sistema
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Usuário removido
 *       404:
 *         description: Usuário não encontrado
 */
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
    logger.error(err, 'Erro ao remover usuário.');
    res.status(500).json({ error: "Erro interno do servidor." })
}

}); 


export default user