import multer from 'multer'
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { files } from '../db/schema.js';
import { db } from '../db/index.js'
import { eq, isNull } from 'drizzle-orm'
import { upload } from '../config/multer.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import * as path from 'path';
import { mkdir } from 'fs/promises';



const uploadBodySchema = z.object({
    parentId: z.string().uuid().optional()
  });

  const folderSchema = z.object({
    name: z.string().min(1).max(255),
    parentId: z.string().uuid().optional()
})

const file: Router = Router();


file.get('/files', async (req: Request, res: Response) => {
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





file.post('/upload', requireAuth, upload.single('file'), async (req: Request, res: Response) => {
    try{    

        if(!req.file){
            return res.status(401).json({
                message: "Nenhum arquivo fornecido."
            })
        }

        const { parentId } = uploadBodySchema.parse(req.body);

        if(parentId){
            const parentFolder = await db.select().from(files).where((eq(files.id, parentId)));

            if(!parentFolder[0]){
                return res.status(404).json({error: "Pasta de destino não encontrada."})
            }

            
            if(!parentFolder[0].isDirectory){
                return res.status(404).json({error: "O destino não é uma pasta."})
            }

        }


        const extensionName = req.file.originalname.split('.').pop() ?? null;

        const [newFile] = await db.insert(files).values({
            name: req.file.originalname,
            path: req.file.path,
            parentId: parentId ?? null,
            isDirectory: false,
            size: req.file.size,
            mimeType: req.file.mimetype,
            extension: extensionName,
            ownerUsername: req.session.username!

        }).returning();


        return res.status(201).json({
            newFile
        })



}catch(err){
    res.status(500).json({
        error: "Erro interno do servidor."
    })
}

});





file.post('/folder', requireAuth, async (req: Request, res: Response) => {
    try{    
        const BASE_PATH = '/data/vault'

        const { name, parentId } = folderSchema.parse(req.body);

        // if(!name){
        //     return res.status(401).json({
        //         error: "Nome da pasta não informado."
        //     })
        // }

        let folderPath: string


        if(parentId){
            const parentFolder = await db.select().from(files).where((eq(files.id, parentId)));

            if(!parentFolder[0]){
                return res.status(404).json({error: "Pasta de destino não encontrada."})
            }

            
            if(!parentFolder[0].isDirectory){
                return res.status(404).json({error: "O destino não é uma pasta."})
            }

            const existing = await db.select().from(files).where(eq(files.parentId, parentId));

            const alreadyExists = existing.find(f => f.name === name);

            if(alreadyExists){
                return res.status(409).json({
                    error: "Já existe uma pasta com esse nome."
                })
            }


            folderPath = path.join(parentFolder[0].path, name);

    

            await mkdir(folderPath, { recursive: true});

            
        }else{
            folderPath = path.join(BASE_PATH, name);
        }

        await mkdir(folderPath, { recursive: true});


         




        const [newFolder] = await db.insert(files).values({
            name: name,
            path: folderPath,
            parentId: parentId ?? null,
            isDirectory: true,
            ownerUsername: req.session.username!

        }).returning();


        return res.status(201).json({
            newFolder
        })








     


}catch(err){
    res.status(500).json({
        error: "Erro interno do servidor."
    })
}

});