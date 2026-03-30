import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { files } from '../db/schema.js';
import { db } from '../db/index.js'
import { eq, isNull, and } from 'drizzle-orm'
import { upload } from '../config/multer.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import * as path from 'path';
import { mkdir } from 'fs/promises';
import { createReadStream, rename } from 'fs';
import { env } from '../config/env.js';



const uploadBodySchema = z.object({
    parentId: z.string().uuid().optional()
  });

  const folderSchema = z.object({
    name: z.string().min(1).max(255),
    parentId: z.string().uuid().optional()
})


const renameSchema = z.object({
    name: z.string().min(1).max(255),
})

const file: Router = Router();


file.get('/', requireAuth, async (req: Request, res: Response) => {
    try{    
        const parentId = req.query.parentId as string | undefined;

        let result;


        if(!parentId){
            result = await db.select().from(files).where(and(isNull(files.parentId), eq(files.inTrash, false)))
        }else{
            result = await db.select().from(files).where(and(eq(files.parentId, parentId), eq(files.inTrash, false)))
        }

        return res.status(200).json(result);

} catch(err) {
    if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues })
    }
    res.status(500).json({ error: "Erro interno do servidor." })
}

});





file.post('/upload', requireAuth, upload.single('file'), async (req: Request, res: Response) => {
    try{    

        if(!req.file){
            return res.status(400).json({
                error: "Nenhum arquivo fornecido."
            })
        }

        const { parentId } = uploadBodySchema.parse(req.body);
        const extensionName = req.file.originalname.split('.').pop() ?? null;

        if(parentId){
            const parentFolder = await db.select().from(files).where((eq(files.id, parentId)));

            if(!parentFolder[0]){
                return res.status(404).json({error: "Pasta de destino não encontrada."})
            }

            
            if(!parentFolder[0].isDirectory){
                return res.status(404).json({error: "O destino não é uma pasta."})
            }

            const existing = await db.select().from(files).where(eq(files.parentId, parentId));

            const alreadyExists = existing.find(f => f.name === req.file!.originalname)


            if(alreadyExists){
                return res.status(409).json({
                    error: "Já existe um arquivo com esse nome."
                })
            }

        }


      

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



    } catch(err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.issues })
        }
        res.status(500).json({ error: "Erro interno do servidor." })
    }

});





file.post('/folder', requireAuth, async (req: Request, res: Response) => {
    try{    
        const BASE_PATH = env.VAULT_PATH


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




    } catch(err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.issues })
        }
        res.status(500).json({ error: "Erro interno do servidor." })
    }

});









file.get('/download/:id', requireAuth, async (req: Request, res: Response) => {
    try{    
     const id = req.params['id'] as string;

     if(!id){
        return res.status(404).json({
            error: "Arquivo não informado."
        })
     }


     const searchFile = await db.select().from(files).where(eq(files.id, id));
     
     if(!searchFile[0]){
        return res.status(404).json({
            error: "Esse arquivo não existe ou está incorreto."
        })
     }

     if(searchFile[0].isDirectory){
        return res.status(400).json({
            error: "Não é possivel baixar a pasta."
        })
     }

     const record = searchFile[0];

     res.setHeader('Content-Type', record.mimeType ?? 'application/octet-stream');
     res.setHeader('Content-Disposition', `attachment; filename="${record.name}"`)
     res.setHeader('Content-Length', record.size ?? 0);

     const stream = createReadStream(record.path);

     stream.on('error', () => {
        res.status(404).json({
            error: "Arquivo não encontrado no disco."
        })
     })


     stream.pipe(res);

 
    } catch(err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.issues })
        }
        res.status(500).json({ error: "Erro interno do servidor." })
    }

});








file.delete('/trash/:id', requireAuth, async (req: Request, res: Response) => {
    try{    
        const id = req.params['id'] as string;

        if(!id){
            return res.status(404).json({
                error: "Arquivo não informado."
            })
         }
    
    
         const searchFile = await db.select().from(files).where(eq(files.id, id));

         if(!searchFile[0]){
            return res.status(404).json({
                error: "Esse arquivo não existe ou está incorreto."
            })
         }

         if(searchFile[0].inTrash){
            return res.status(409).json({
                error: "Esse arquivo já está na lixeira."
            })
         }


        const [trashed] = await db.update(files).set({ inTrash: true, trashedAt: new Date( )}).where(eq(files.id, id)).returning();

         return res.status(200).json({
            trashed
         })

 
    } catch(err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.issues })
        }
        res.status(500).json({ error: "Erro interno do servidor." })
    }

});





file.patch('/rename/:id', requireAuth, async (req: Request, res: Response) => {
    try{    
        const id = req.params['id'] as string;
        const { name } = renameSchema.parse(req.body);


        if(!id){
            return res.status(404).json({
                message: "Arquivo não encontrado."
            })
        }

        const searchFile = await db.select().from(files).where(eq(files.id, id));


        if(!searchFile[0]){
            return res.status(404).json({
                error: "Esse arquivo não existe ou está incorreto."
            })
        }

        const existing = await db.select().from(files).where(eq(files.id, id));

        const alreadyExists = existing.find(f => f.name === name);

        if(!alreadyExists){
            return res.status(404).json({
                error: "Já existe um arquivo com esse nome."
            })
        }
        
        const [rename] = await db.update(files).set({ name: name }).where(eq(files.id, id)).returning();

        return res.status(200).json({
            rename
        })



 
    } catch(err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.issues })
        }
        res.status(500).json({ error: "Erro interno do servidor." })
    }

});



export default file