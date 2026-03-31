import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { auditLog } from '../db/schema.js';
import { db } from '../db/index.js'
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireAdmin } from '../middlewares/requireAdmin.js';
import { logger } from '../config/logger.js';




const audit: Router = Router();


audit.get('/', requireAdmin, async (req: Request, res: Response) => {
    try{       
        const limit = parseInt(req.query.limit as string) || 50;
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