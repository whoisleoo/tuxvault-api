import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { users } from '../db/schema.js';
import { db } from '../db/index.js'
import { eq, isNull, and } from 'drizzle-orm'
import { upload } from '../config/multer.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import * as path from 'path';
import { mkdir } from 'fs/promises';
import { createReadStream } from 'fs';
import { promises as fsp } from 'fs';
import { env } from '../config/env.js';
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







export default user