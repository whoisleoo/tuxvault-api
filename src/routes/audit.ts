import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { auditLog, users } from '../db/schema.js';
import { db } from '../db/index.js'
import { requireAdmin } from '../middlewares/requireAdmin.js';
import { logger } from '../config/logger.js';
import { eq, desc, count, and, ilike } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';




const audit: Router = Router();


/**
 * @swagger
 * /api/audit:
 *   get:
 *     summary: Lista registros de auditoria
 *     tags: [Audit]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           maximum: 100
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Lista de logs de auditoria
 *       401:
 *         description: Não autenticado
 *       403:
 *         description: Sem permissão de admin
 */
audit.get('/', requireAdmin, async (req: Request, res: Response) => {
    try{       
        const limit = Math.min(parseInt(req.query.limit  as string) || 25, 100);
        const offset = parseInt(req.query.offset as string) || 0;
        const username = (req.query.username as string)?.trim() || undefined;
        const action = (req.query.action   as string)?.trim() || undefined;

        const conditions: SQL[] = [];
        if (username) conditions.push(ilike(users.username, `%${username}%`));
        if (action) conditions.push(eq(auditLog.action, action));
        const where = conditions.length > 0 ? and(...conditions) : undefined;

        /*
        *
        *     Tenho que investigar o porque ele tá marcando como erro.
        *     Verificar existencia não funcionou, nem marcar o tipo.
        * 
        *     TODO: Adicionar cronometro pra deletar registro de auditoria pra
        *      não estrapolar o banco.
        */
        const totalResult = await db.select({ total: count() }).from(auditLog)
            .leftJoin(users, eq(auditLog.userId, users.id)).where(where);
        const total = totalResult[0]?.total ?? 0;





        const result = await db.select({ id: auditLog.id, action: auditLog.action, fileName: auditLog.fileName, filePath: auditLog.filePath, extra: auditLog.extra, createdAt: auditLog.createdAt, username: users.username }).from(auditLog).leftJoin(users, eq(auditLog.userId, users.id)).where(where).orderBy(desc(auditLog.createdAt)).limit(limit).offset(offset);


        return res.status(200).json({ 
            result, total
         })

} catch(err) {
    if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues })
    }
    logger.error(err, 'Erro ao procurar registros.');
    res.status(500).json({ error: "Erro interno do servidor." });
}

})


export default audit