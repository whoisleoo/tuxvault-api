import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { files, auditLog } from '../db/schema.js';
import { db } from '../db/index.js'
import { eq, isNull, and, inArray } from 'drizzle-orm'
import { upload } from '../config/multer.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import * as path from 'path';
import { mkdir} from 'fs/promises';
import { createReadStream } from 'fs';
import { promises as fsp } from 'fs';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getStorageInfo } from '../services/storage.js';
import archiver from 'archiver';
import { getStorageFolder } from '../services/folderStorage.js';





const uploadBodySchema = z.object({
    parentId: z.string().uuid().optional()
  });

  const folderSchema = z.object({
    name: z.string().min(1).max(255).refine((val) => !/(\/|\\|\.\.)/.test(val),{ message: "Nome de pasta inválido." }),
    parentId: z.string().uuid().optional()
})


const renameSchema = z.object({
    name: z.string().min(1).max(255).refine((val) => !/(\/|\\|\.\.)/.test(val),{ message: "Nome inválido." }),
})

const file: Router = Router();


file.get('/', requireAuth, async (req: Request, res: Response) => {
    try{    
        const parentId = req.query.parentId as string | undefined;

        let result;


        if(!parentId){
            result = await db.select().from(files).where(and(isNull(files.parentId), eq(files.inTrash, false), eq(files.ownerUsername, req.session.username!)))
        }else{
            result = await db.select().from(files).where(and(eq(files.parentId, parentId), eq(files.inTrash, false), eq(files.ownerUsername, req.session.username!)))
        }

        return res.status(200).json(result);

} catch(err) {
    if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues })
    }
    logger.error(err, 'Erro ao procurar arquivos.');
    res.status(500).json({ error: "Erro interno do servidor." })
}

});





file.post('/upload', requireAuth, upload.array('file', 20), async (req: Request, res: Response) => {
    try{    
        const uploadedFiles = req.files as Express.Multer.File[];

        if(!uploadedFiles || uploadedFiles.length === 0){
            return res.status(400).json({
                error: "Nenhum arquivo fornecido."
            })
        }

        const { parentId } = uploadBodySchema.parse(req.body);

        if(parentId){
            const parentFolder = await db.select().from(files).where(and(eq(files.id, parentId), eq(files.ownerUsername, req.session.username!)));

            if(!parentFolder[0]){
                return res.status(404).json({ error: "Pasta de destino não encontrada." })
            }

            if(!parentFolder[0].isDirectory){
                return res.status(404).json({ error: "O destino não é uma pasta." })
            }
        }

        const { used, total } = await getStorageInfo(req.session.username!);
        const incomingSize = uploadedFiles.reduce((acc, f) => acc + f.size, 0);

        if(used + incomingSize > total){
            return res.status(507).json({
                error: "Armazenamento insuficiente."
            })
        }



        
        const fileNames = uploadedFiles.map(f => Buffer.from(f.originalname, 'latin1').toString('utf8'));



        const existingFiles = parentId ? await db.select({ name: files.name }).from(files).where(and(eq(files.parentId, parentId), inArray(files.name, fileNames)))
        : await db.select({ name: files.name }).from(files).where(and(isNull(files.parentId), inArray(files.name, fileNames)));

        const existingNames = new Set(existingFiles.map(f => f.name));


        const results = [];
        for(const f of uploadedFiles) {
            const originalname = Buffer.from(f.originalname, 'latin1').toString('utf-8');
            if(existingNames.has(originalname)) continue

            const extensionName = originalname.split('.').pop() ?? null;
            const [newFile] = await db.insert(files).values({
                name: originalname,
                path: f.path,
                parentId: parentId ?? null,
                isDirectory: false,
                size: f.size,
                mimeType: f.mimetype,
                extension: extensionName,
                ownerUsername: req.session.username!
            }).returning();

            if(newFile) {
                results.push(newFile);
                await db.insert(auditLog).values({
                    userId: req.session.userId,
                    action: 'upload',
                    fileId: newFile.id,
                    fileName: newFile.name,
                    filePath: newFile.path,
                    ipAddress: req.ip ?? null
                });
            }
        }

        if(!results[0]){
            return res.status(500).json({
                error: "Erro interno do servidor."
            })
        }

    


        return res.status(201).json({
            files: results
        })



    } catch(err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.issues })
        }
        logger.error(err, 'Erro ao fazer upload de arquivo.');
        res.status(500).json({ error: "Erro interno do servidor." })
    }

}); 





file.post('/folder', requireAuth, async (req: Request, res: Response) => {
    try{    
        const BASE_PATH = env.VAULT_PATH


        const { name, parentId } = folderSchema.parse(req.body);

        let folderPath: string


        if(parentId){
            const parentFolder = await db.select().from(files).where(and(eq(files.id, parentId), eq(files.ownerUsername, req.session.username!)));

            if(!parentFolder[0]){
                return res.status(404).json({error: "Pasta de destino não encontrada."})
            }

            
            if(!parentFolder[0].isDirectory){
                return res.status(404).json({error: "O destino não é uma pasta."})
            }

            const existing = await db.select().from(files).where(and(eq(files.parentId, parentId), eq(files.name, name)));
            

            if(existing[0]){
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
        logger.error(err, 'Erro ao criar uma pasta.');
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


     const searchFile = await db.select().from(files).where(and(eq(files.id, id), eq(files.ownerUsername, req.session.username!)))
     
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
     res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(record.name)}`);
     res.setHeader('Content-Length', record.size ?? 0);

     const stream = createReadStream(record.path);

     stream.on('error', (err) => {
        logger.error(err, "Erro ao fazer stream do arquivo.")
        if(!res.headersSent){
            res.status(500).json({
                error: "Erro ao transmitir o arquivo."
            })
        }
        
     })



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









file.get('/download-zip/:id', requireAuth, async (req: Request, res: Response) => {
    try{    
     const id = req.params['id'] as string;

     if(!id){
        return res.status(404).json({
            error: "Arquivo não informado."
        })
     }


     const searchFile = await db.select().from(files).where(and(eq(files.id, id), eq(files.ownerUsername, req.session.username!)))
     
     if(!searchFile[0]){
        return res.status(404).json({
            error: "Esse arquivo não existe ou está incorreto."
        })
     }

     if(!searchFile[0].isDirectory){
        return res.status(400).json({
            error: "Esse item não é uma pasta."
        })
     }

     const record = searchFile[0];

     const archive = archiver('zip', { zlib: { level: 9 }});
     archive.on('error', (err) =>{
        logger.error(err, 'Erro ao criar pasta ZIP');
        if(!res.headersSent) res.status(500).json({ error: "Erro ao criar ZIP"})
     })



    await db.insert(auditLog).values({
        userId: req.session.userId,
        action: 'download_zip',
        fileId: record.id,
        fileName: record.name,
        filePath: record.path,
        ipAddress: req.ip ?? null
    });


    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(record.name)}.zip`);

    archive.pipe(res);
    archive.directory(record.path, false);
     await archive.finalize();



    } catch(err) {  
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.issues })
        }
        res.status(500).json({ error: "Erro interno do servidor." })
    }

});









file.get('/preview/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const id = req.params['id'] as string;

        const searchFile = await db.select().from(files).where(and(eq(files.id, id), eq(files.ownerUsername, req.session.username!)));

        if(!searchFile[0]){
            return res.status(404).json({ error: "Esse arquivo não existe ou está incorreto." })
        }

        if(searchFile[0].isDirectory){
            return res.status(400).json({ error: "Não é possível visualizar uma pasta." })
        }

        const range = req.headers.range;
        const record = searchFile[0];
        const fileSize = record.size ?? 0;

        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', record.mimeType ?? 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(record.name)}`);
        res.setHeader('Content-Length', record.size ?? 0);


        if(range){
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0]!, 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;


            if(start >= fileSize || end >= fileSize){
                res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
                return res.end();
            }

            const chunkSize = (end - start ) + 1;
            const stream = createReadStream(record.path, { start, end });

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Content-Length': chunkSize,
            })

            stream.on('error', (err) => {
                logger.error(err, 'Erro ao fazer stream do preview.');
                if (!res.headersSent) res.status(500).json({ error: "Erro ao transmitir o arquivo." });
            });

            stream.pipe(res)

        }else{
            const stream = createReadStream(record.path);
            
            stream.on('error', (err) => {
                logger.error(err, 'Erro ao fazer stream do preview.');
                if (!res.headersSent) res.status(500).json({ error: "Erro ao transmitir o arquivo." });
            });

            stream.pipe(res);
        
        }


       

    } catch(err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.issues })
        }
        logger.error(err, 'Erro ao visualizar arquivo.');
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
    
    
         const searchFile = await db.select().from(files).where(and(eq(files.id, id), eq(files.ownerUsername, req.session.username!)))

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


        const [trashed] = await db.update(files).set({ inTrash: true, trashedAt: new Date( ), updatedAt: new Date()}).where(eq(files.id, id)).returning();

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
        logger.error(err, 'Erro ao tentar mover para lixeira.');
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

        const searchFile = await db.select().from(files).where(and(eq(files.id, id), eq(files.ownerUsername, req.session.username!)))


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
        
        const [rename] = await db.update(files).set({ name: name, updatedAt: new Date() }).where(eq(files.id, id)).returning();

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
        logger.error(err, 'Erro ao renomear o arquivo.');
        res.status(500).json({ error: "Erro interno do servidor." })
    }

});




file.get('/favorites', requireAuth, async (req: Request, res: Response) => {
    try {
        const result = await db.select().from(files).where(
            and(eq(files.ownerUsername, req.session.username!), eq(files.favorited, true), eq(files.inTrash, false))
        );
        return res.status(200).json(result);
    } catch (err) {
        logger.error(err, 'Erro ao buscar favoritos.');
        res.status(500).json({ error: "Erro interno do servidor." });
    }
});


file.get('/trash', requireAuth, async (req: Request, res: Response) => {
    try{    
        const result = await db.select().from(files).where(and(eq(files.inTrash, true), eq(files.ownerUsername, req.session.username!)));


        return res.status(200).json(result);

} catch(err) {
    if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues })
    }
    logger.error(err, 'Erro ao mover para lixeira.');
    res.status(500).json({ error: "Erro interno do servidor." })
}

});




file.delete('/trash/:id/permanent', requireAuth, async (req: Request, res: Response) => {
    try{    
        const id = req.params['id'] as string;
        const result = await db.select().from(files).where(and(eq(files.id, id), eq(files.inTrash, true), eq(files.ownerUsername, req.session.username!)));

        if(!result[0]){
            return res.status(404).json({
                error: "Não foi possivel encontrar esse arquivo."
            })
        }

        await db.insert(auditLog).values({
            userId: req.session.userId,
            action: 'deleted',
            fileId: result[0].id,
            fileName: result[0].name,
            filePath: result[0].path,
            ipAddress: req.ip ?? null
        });

        if (result[0].isDirectory) {
            await fsp.rm(result[0].path, { recursive: true, force: true });
        } else {
            await fsp.unlink(result[0].path);
        }

        await db.delete(files).where(eq(files.id, id));

    


        return res.status(200).json({ 
            message: "Arquivo deletado permanentemente." 
        });


} catch(err) {
    if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues })
    }
    logger.error(err, 'Erro ao deletar permanentemente o arquivo.');
    res.status(500).json({ error: "Erro interno do servidor." })
}

});





file.patch('/trash/:id/restore', requireAuth, async (req: Request, res: Response) => {
    try{    
        const id = req.params['id'] as string;
        const result = await db.select().from(files).where(and(eq(files.id, id), eq(files.inTrash, true), eq(files.ownerUsername, req.session.username!)));

        if(!result[0]){
            return res.status(404).json({
                error: "Não foi possivel encontrar esse arquivo."
            })
        }


        const [restored] = await db.update(files).set({ inTrash: false, trashedAt: null, updatedAt: new Date()}).where(eq(files.id, id)).returning();


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
    logger.error(err, 'Erro ao restaurar arquivo.');
    res.status(500).json({ error: "Erro interno do servidor." })
}

});




const favoriteSchema = z.object({
    favorited: z.boolean()
})

file.patch('/:id/favorite', requireAuth, async (req: Request, res: Response) => {
    try {
        const id = req.params['id'] as string;
        const { favorited } = favoriteSchema.parse(req.body);

        const searchFile = await db.select().from(files).where(
            and(eq(files.id, id), eq(files.ownerUsername, req.session.username!), eq(files.inTrash, false))
        );

        if (!searchFile[0]) {
            return res.status(404).json({ error: "Arquivo não encontrado." });
        }

        const [updated] = await db.update(files).set({ favorited, updatedAt: new Date() }).where(eq(files.id, id)).returning();

        if (!updated) {
            return res.status(500).json({ error: "Erro interno do servidor." });
        }

        return res.status(200).json({ favorited: updated.favorited });

    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.issues });
        }
        logger.error(err, 'Erro ao favoritar arquivo.');
        res.status(500).json({ error: "Erro interno do servidor." });
    }
});



file.get('/storage', requireAuth, async (req: Request, res: Response) => {
    try {
        const storage = await getStorageInfo(req.session.username!);

        return res.status(200).json({
            storage
        })

      
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.issues });
        }
        logger.error(err, 'Erro ao encontrar armazenamento.');
        res.status(500).json({ error: "Erro interno do servidor." });
    }
});





file.post('/upload-folder', requireAuth, upload.array('file', 500), async (req: Request, res: Response) => {
    try {
        const uploadedFiles = req.files as Express.Multer.File[];
        const rawPaths = req.body['paths[]'];
        const relativePaths: string[] = Array.isArray(rawPaths) ? rawPaths : [rawPaths];

        if (!uploadedFiles || uploadedFiles.length === 0) {
            return res.status(400).json({ error: "Nenhum arquivo fornecido." });
        }

        if (!relativePaths || relativePaths.length !== uploadedFiles.length) {
            return res.status(400).json({ error: "Paths dos arquivos não informados corretamente"});
        }

        const { parentId } = uploadBodySchema.parse(req.body);

        let basePath = env.VAULT_PATH;
        let baseParentId: string | null = parentId ?? null;

        if (parentId) {
            const parentFolder = await db.select().from(files).where(and(eq(files.id, parentId), eq(files.ownerUsername, req.session.username!)));
            if (!parentFolder[0]) return res.status(404).json({ error: "Pasta de destino não encontrada." });
            if (!parentFolder[0].isDirectory) return res.status(400).json({ error: "O destino não é uma pasta." });
            basePath = parentFolder[0].path;
        }

        const { used, total } = await getStorageInfo(req.session.username!);
        const incomingSize = uploadedFiles.reduce((acc, f) => acc + f.size, 0);
        if (used + incomingSize > total) {
            return res.status(507).json({ error: "Armazenamento insuficiente." });
        }

        for (const p of relativePaths) {
            if (/(\.\.[\\/])|(^[\\/])/.test(p)) {
                return res.status(400).json({ error: "Path inválido detectado." });
            }
        }


        const folderIdMap = new Map<string, { id: string; path: string }>();

        const allDirs = [...new Set(
            relativePaths.map(p => path.dirname(p)).filter(d => d !== '.'))].sort((a, b) => a.split('/').length - b.split('/').length);

        for (const dir of allDirs) {
            const parts = dir.split('/');
            let currentParentId: string | null = baseParentId;
            let currentBasePath = basePath;

            for (let i = 0; i < parts.length; i++) {
                const segment = parts[i]!;
                const segmentKey = parts.slice(0, i + 1).join('/');

                if (folderIdMap.has(segmentKey)) {
                    const cached = folderIdMap.get(segmentKey)!;
                    currentBasePath = cached.path;
                    currentParentId = cached.id;
                    continue;
                }

                const folderPath = path.join(currentBasePath, segment);
                await mkdir(folderPath, { recursive: true });

                const existingInDb = currentParentId
                    ? await db.select().from(files).where(and(eq(files.parentId, currentParentId), eq(files.name, segment)))
                    : await db.select().from(files).where(and(isNull(files.parentId), eq(files.name, segment)));

                let folderId: string;

                if (existingInDb[0]) {
                    folderId = existingInDb[0].id;
                } else {
                    const [newFolder] = await db.insert(files).values({
                        name: segment,
                        path: folderPath,
                        parentId: currentParentId,
                        isDirectory: true,
                        ownerUsername: req.session.username!
                    }).returning();
                    folderId = newFolder!.id;
                }

                folderIdMap.set(segmentKey, { id: folderId, path: folderPath });
                currentParentId = folderId;
                currentBasePath = folderPath;
            }
        }


        const results = [];
        for (let i = 0; i < uploadedFiles.length; i++) {
            const f = uploadedFiles[i]!;
            const relativePath = relativePaths[i]!;
            const originalname = Buffer.from(f.originalname, 'latin1').toString('utf8');
            const dir = path.dirname(relativePath);
            const fileParentId = dir === '.' ? baseParentId : (folderIdMap.get(dir)?.id ?? baseParentId);
            const extensionName = originalname.split('.').pop() ?? null;

            const [newFile] = await db.insert(files).values({
                name: originalname,
                path: f.path,
                parentId: fileParentId,
                isDirectory: false,
                size: f.size,
                mimeType: f.mimetype,
                extension: extensionName,
                ownerUsername: req.session.username!
            }).returning();


            if (newFile) {
                results.push(newFile);
                await db.insert(auditLog).values({
                    userId: req.session.userId,
                    action: 'upload',
                    fileId: newFile.id,
                    fileName: newFile.name,
                    filePath: newFile.path,
                    ipAddress: req.ip ?? null
                });
            }
        }

        return res.status(201).json({ files: results });

    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.issues });
        }
        logger.error(err, 'Erro ao fazer upload de pasta.');
        res.status(500).json({ error: "Erro interno do servidor." });
    }
});


file.get('/folders/:id/size', requireAuth, async (req: Request, res: Response) => {
    const id = req.params['id'] as string;
    const username = req.session.username!

    try {
        const size = await getStorageFolder(id, username)
        
        return res.json({ size })



    
    } catch (err) {
        logger.error(err, 'Erro ao calcular tamanho da pasta.')
        return res.status(500).json({ error: 'Erro interno do servidor.' })
    }
})


export default file