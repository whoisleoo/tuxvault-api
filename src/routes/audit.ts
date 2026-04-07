import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { auditLog } from '../db/schema.js';
import { db } from '../db/index.js'
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireAdmin } from '../middlewares/requireAdmin.js';
import { logger } from '../config/logger.js';




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
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
        const offset = parseInt(req.query.offset as string) || 0; 


        const result = await db.select().from(auditLog).limit(limit).offset(offset).orderBy(auditLog.createdAt);

        return res.status(200).json({
            result
        })

} catch(err) {
    if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues })
    }
    logger.error(err, 'Erro ao procurar registros.');
    res.status(500).json({ error: "Erro interno do servidor." });
}

});






export default audit