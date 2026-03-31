import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { auditLog } from '../db/schema.js';
import { db } from '../db/index.js'
import { eq, isNull, and } from 'drizzle-orm'
import { sambaUser } from '../services/sambaUser.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireAdmin } from '../middlewares/requireAdmin.js';




const audit: Router = Router();


audit.get('/', requireAdmin, async (req: Request, res: Response) => {

    try{        
        const id = req.query.id as string | undefined;

        let result;

        if(!id){
            result = await db.select().from(auditLog);
        }else{
            result = await db.select().from(auditLog).where(eq(auditLog.userId, id));
        }


        return res.status(200).json({
            result
        })

} catch(err) {
    if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues })
    }
    res.status(500).json({ error: "Erro interno do servidor." })
}

});










export default audit