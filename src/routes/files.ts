import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { files, auditLog } from '../db/schema.js';
import { db } from '../db/index.js'
import { eq, isNull, and } from 'drizzle-orm'
import { upload } from '../config/multer.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import * as path from 'path';
import { mkdir } from 'fs/promises';
import { createReadStream } from 'fs';
import { promises as fsp } from 'fs';
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


        if(!newFile){
            return res.status(500).json({
                error: "Erro interno do servidor."
            })
        }

        await db.insert(auditLog).values({
            userId: req.session.userId,
            action: 'upload',
            fileId: newFile.id,
            fileName: newFile.name,
            filePath: newFile.path,
            ipAddress: req.ip ?? null
        });

    


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



        if(!newFolder){
            return res.status(500).json({
                error: "Erro interno do servidor."
            })
        }

        await db.insert(auditLog).values({
            userId: req.session.userId,
            action: 'create_folder',
            fileId: newFolder.id,
            fileName: newFolder.name,
            filePath: newFolder.path,
            ipAddress: req.ip ?? null
        });

    




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

     if(!record){
        return res.status(500).json({
            error: "Erro interno do servidor."
        })
    }

    await db.insert(auditLog).values({
        userId: req.session.userId,
        action: 'download',
        fileId: record.id,
        fileName: record.name,
        filePath: record.path,
        ipAddress: req.ip ?? null
    });




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
            return res.status(400).json({
                error: "Esse arquivo já está na lixeira."
            })
         }


        const [trashed] = await db.update(files).set({ inTrash: true, trashedAt: new Date( )}).where(eq(files.id, id)).returning();

        if(!trashed){
            return res.status(500).json({
                error: "Erro interno do servidor."
            })
        }

        await db.insert(auditLog).values({
            userId: req.session.userId,
            action: 'trash',
            fileId: trashed.id,
            fileName: trashed.name,
            filePath: trashed.path,
            ipAddress: req.ip ?? null
        });

    


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
                error: "Arquivo não encontrado."
            })
        }

        const searchFile = await db.select().from(files).where(eq(files.id, id));


        if(!searchFile[0]){
            return res.status(404).json({
                error: "Esse arquivo não existe ou está incorreto."
            })
        }

        if(searchFile[0].inTrash){
            return res.status(400).json({
                error: "Esse arquivo está na lixeira."
            })
         }

        const parentId = searchFile[0].parentId;
        const existing = parentId ? await db.select().from(files).where(and(eq(files.parentId, parentId), eq(files.name, name))) : await db.select().from(files).where(and(isNull(files.parentId), eq(files.name, name)));

        if(existing[0]){
            return res.status(409).json({
                error: "Já existe um arquivo com esse nome."
            })
        }
        
        const [rename] = await db.update(files).set({ name: name }).where(eq(files.id, id)).returning();

        if(!rename){
            return res.status(500).json({
                error: "Erro interno do servidor."
            })
        }

        await db.insert(auditLog).values({
            userId: req.session.userId,
            action: 'rename',
            fileId: rename.id,
            fileName: rename.name,
            filePath: rename.path,
            ipAddress: req.ip ?? null
        });

    


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




file.get('/trash', requireAuth, async (req: Request, res: Response) => {
    try{    
        const result = await db.select().from(files).where(eq(files.inTrash, true));


        return res.status(200).json(result);

} catch(err) {
    if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues })
    }
    res.status(500).json({ error: "Erro interno do servidor." })
}

});




file.delete('/trash/:id/permanent', requireAuth, async (req: Request, res: Response) => {
    try{    
        const id = req.params['id'] as string;
        const result = await db.select().from(files).where(and(eq(files.id, id), eq(files.inTrash, true)));

        if(!result[0]){
            return res.status(404).json({
                error: "Não foi possivel encontrar esse arquivo."
            })
        }

        await fsp.unlink(result[0].path);

        await db.delete(files).where(eq(files.id, id));


        await db.insert(auditLog).values({
            userId: req.session.userId,
            action: 'deleted',
            fileId: result[0].id,
            fileName: result[0].name,
            filePath: result[0].path,
            ipAddress: req.ip ?? null
        });

    


        return res.status(200).json({ 
            message: "Arquivo deletado permanentemente." 
        });


} catch(err) {
    if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues })
    }
    res.status(500).json({ error: "Erro interno do servidor." })
}

});





file.patch('/trash/:id/restore', requireAuth, async (req: Request, res: Response) => {
    try{    
        const id = req.params['id'] as string;
        const result = await db.select().from(files).where(and(eq(files.id, id), eq(files.inTrash, true)));

        if(!result[0]){
            return res.status(404).json({
                error: "Não foi possivel encontrar esse arquivo."
            })
        }


        const [restored] = await db.update(files).set({ inTrash: false, trashedAt: null}).where(eq(files.id, id)).returning();


        if(!restored){
            return res.status(500).json({
                error: "Erro interno do servidor."
            })
        }

        await db.insert(auditLog).values({
            userId: req.session.userId,
            action: 'restore',
            fileId: restored.id,
            fileName: restored.name,
            filePath: restored.path,
            ipAddress: req.ip ?? null
        });

    

        return res.status(200).json({ 
            restored
        });


} catch(err) {
    if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues })
    }
    res.status(500).json({ error: "Erro interno do servidor." })
}

});


export default file