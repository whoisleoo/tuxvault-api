import multer from 'multer'
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { files } from '../db/schema.js';
import { db } from '../db/index.js'
import { eq, isNull } from 'drizzle-orm'
import { upload } from '../config/multer.js';





const file: Router = Router();


file.get('/api/files', async (req: Request, res: Response) => {
    try{    
        const parentId = req.query.parentId as string | undefined;

        let result;


        if(!parentId){
            result = await db.select().from(files).where(isNull(files.parentId))
        }else{
            result = await db.select().from(files).where((eq(files.parentId, parentId)))
        }

        return res.status(200).json(result);

}catch(err){
    res.status(500).json({
        error: "Erro interno do servidor."
    })
}

});





file.post('/api/files/upload', upload.single('file'), async (req: Request, res: Response) => {
    try{    
        

}catch(err){
    res.status(500).json({
        error: "Erro interno do servidor."
    })
}

});