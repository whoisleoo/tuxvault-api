import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { files } from '../db/schema.js';
import { db } from '../db/index.js'
import { eq, isNull, and, inArray, sql } from 'drizzle-orm'
import { upload } from '../config/multer.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import * as path from 'path';
import { mkdir} from 'fs/promises';
import { promises as fsp } from 'fs';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getStorageInfo } from '../services/storage.js';
import archiver from 'archiver';
import { getStorageFolder } from '../services/folderStorage.js';
import { findOwned, validateParent, checkQuota, pipeFile, setDownloadHeaders, findDuplicate, uploadFolderService, generateCopyName, copyFolderService } from '../services/fileService.js';
import { audit } from '../services/auditHelper.js';
import { handleError } from '../utils/errorHandler.js';




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

const moveSchema = z.object({
    targetId: z.union([z.string().uuid(), z.null()])
})


const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i



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
    return handleError(res, err, 'Erro ao procurar arquivos.')
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

        if(parentId) await validateParent(parentId, req.session.username!)

        const incomingSize = uploadedFiles.reduce((acc, f) => acc + f.size, 0);
        try {
            await checkQuota(req.session.username!, incomingSize)
        } catch (quotaErr) {
            await Promise.allSettled(uploadedFiles.map(f => fsp.unlink(f.path)))
            throw quotaErr
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
                await audit(req, 'upload', newFile)
            }
        }

        if(!results.length){
            return res.status(409).json({
                error: "Todos os arquivos já existem no destino."
            })
        }




        return res.status(201).json({
            files: results
        })



    } catch(err) {
        return handleError(res, err, 'Erro ao fazer upload de arquivo.')
    }

}); 





file.post('/folder', requireAuth, async (req: Request, res: Response) => {
    try{    
        const BASE_PATH = env.VAULT_PATH


        const { name, parentId } = folderSchema.parse(req.body);

        let folderPath: string


        if(parentId){
            const parentFolder = await validateParent(parentId, req.session.username!)

            const existing = await findDuplicate(name, parentId);


            if(existing[0]){
                return res.status(409).json({
                    error: "Já existe uma pasta com esse nome."
                })
            }


            folderPath = path.join(parentFolder.path, name);

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

        await audit(req, 'create_folder', newFolder)




        return res.status(201).json({
            newFolder
        })




    } catch(err) {
        return handleError(res, err, 'Erro ao criar uma pasta.')
    }

});









file.get('/download/:id', requireAuth, async (req: Request, res: Response) => {
    try{
     const id = req.params['id'] as string;
     const record = await findOwned(id, req.session.username!)

     if(record.isDirectory){
        return res.status(400).json({
            error: "Não é possivel baixar a pasta."
        })
     }

     setDownloadHeaders(res, record)

    await audit(req, 'download', record)

     pipeFile(res, record.path);


    } catch(err) {
        return handleError(res, err, 'Erro ao baixar arquivo.')
    }

});









file.get('/download-zip/:id', requireAuth, async (req: Request, res: Response) => {
    try{
     const id = req.params['id'] as string;
     const record = await findOwned(id, req.session.username!)

     if(!record.isDirectory){
        return res.status(400).json({
            error: "Esse item não é uma pasta."
        })
     }

     const treeResult = await db.execute(sql`
        WITH RECURSIVE tree AS (
            SELECT id, name, path AS disk_path, is_directory, parent_id,
                   name::text AS rel_path
            FROM files
            WHERE id = ${id} AND owner_username = ${req.session.username!}
    
            UNION ALL
    
            SELECT f.id, f.name, f.path AS disk_path, f.is_directory, f.parent_id,
                   (tree.rel_path || '/' || f.name)::text AS rel_path
            FROM files f
            INNER JOIN tree ON f.parent_id = tree.id
            WHERE f.owner_username = ${req.session.username!}
        )
        SELECT disk_path, rel_path, is_directory FROM tree
    `);

     const archive = archiver('zip', { zlib: { level: 9 }});
     archive.on('error', (err) =>{
        logger.error(err, 'Erro ao criar pasta ZIP');
        if(!res.headersSent) res.status(500).json({ error: "Erro ao criar ZIP"})
     })

    await audit(req, 'download_zip', record)

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(record.name)}.zip`);

    type TreeRow = { disk_path: string; rel_path: string; is_directory: boolean }
    const rows    = treeResult.rows as TreeRow[]
    const files   = rows.filter(r => !r.is_directory)
    const dirs    = rows.filter(r =>  r.is_directory)
    
    const emptyDirs = dirs.filter(dir =>
       !files.some(f => f.rel_path.startsWith(dir.rel_path + '/'))
    )
    

    archive.pipe(res);
    
    for (const row of files) {
        archive.file(row.disk_path, { name: row.rel_path });
    }
    
    for (const dir of emptyDirs) {
        archive.append(Buffer.alloc(0), { name: dir.rel_path + '/' });
    }
    
    await archive.finalize();



    } catch(err) {
        return handleError(res, err, 'Erro ao baixar pasta ZIP.')
    }

});









file.get('/preview/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const id = req.params['id'] as string;
        const record = await findOwned(id, req.session.username!)

        if(record.isDirectory){
            return res.status(400).json({ error: "Não é possível visualizar uma pasta." })
        }

        const range = req.headers.range;
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
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Content-Length': chunkSize,
            })

            pipeFile(res, record.path, { start, end })

        }else{
            pipeFile(res, record.path)
        }


       

    } catch(err) {
        return handleError(res, err, 'Erro ao visualizar arquivo.')
    }
});








file.delete('/trash/:id', requireAuth, async (req: Request, res: Response) => {
    try{
        const id = req.params['id'] as string;
        const record = await findOwned(id, req.session.username!)

         if(record.inTrash){
            return res.status(400).json({
                error: "Esse arquivo já está na lixeira."
            })
         }


        const [trashed] = await db.update(files).set({ inTrash: true, trashedAt: new Date( ), updatedAt: new Date()}).where(eq(files.id, id)).returning();

        await audit(req, 'trash', trashed!)


         return res.status(200).json({
            trashed
         })


    } catch(err) {
        return handleError(res, err, 'Erro ao mover para lixeira.')
    }

});





file.patch('/rename/:id', requireAuth, async (req: Request, res: Response) => {
    try{
        const id = req.params['id'] as string;
        const { name } = renameSchema.parse(req.body);
        const record = await findOwned(id, req.session.username!)

        if(record.inTrash){
            return res.status(400).json({
                error: "Esse arquivo está na lixeira."
            })
         }

        const parentId = record.parentId;
        const existing = await findDuplicate(name, parentId);

        if(existing[0]){
            return res.status(409).json({
                error: "Já existe um arquivo com esse nome."
            })
        }

        const [rename] = await db.update(files).set({ name: name, updatedAt: new Date() }).where(eq(files.id, id)).returning();

        await audit(req, 'rename', rename!)


        return res.status(200).json({
            rename
        })


    } catch(err) {
        return handleError(res, err, 'Erro ao renomear o arquivo.')
    }

});




file.get('/favorites', requireAuth, async (req: Request, res: Response) => {
    try {
        const result = await db.select().from(files).where(
            and(eq(files.ownerUsername, req.session.username!), eq(files.favorited, true), eq(files.inTrash, false))
        );
        return res.status(200).json(result);
    } catch (err) {
        return handleError(res, err, 'Erro ao buscar favoritos.')
    }
});


file.get('/trash', requireAuth, async (req: Request, res: Response) => {
    try{    
        const result = await db.select().from(files).where(and(eq(files.inTrash, true), eq(files.ownerUsername, req.session.username!)));


        return res.status(200).json(result);

} catch(err) {
    return handleError(res, err, 'Erro ao listar lixeira.')
}

});




file.delete('/trash/:id/permanent', requireAuth, async (req: Request, res: Response) => {
    try{
        const id = req.params['id'] as string;
        const record = await findOwned(id, req.session.username!)

        if(!record.inTrash){
            return res.status(400).json({
                error: "Arquivo não está na lixeira."
            })
        }

        await audit(req, 'deleted', record)

        if (record.isDirectory) {
            await fsp.rm(record.path, { recursive: true, force: true });
        } else {
            await fsp.unlink(record.path);
        }

        await db.delete(files).where(eq(files.id, id));


        return res.status(200).json({
            message: "Arquivo deletado permanentemente."
        });


} catch(err) {
    return handleError(res, err, 'Erro ao deletar permanentemente o arquivo.')
}

});





file.patch('/trash/:id/restore', requireAuth, async (req: Request, res: Response) => {
    try{
        const id = req.params['id'] as string;
        const record = await findOwned(id, req.session.username!)

        if(!record.inTrash){
            return res.status(400).json({
                error: "Arquivo não está na lixeira."
            })
        }


        const [restored] = await db.update(files).set({ inTrash: false, trashedAt: null, updatedAt: new Date()}).where(eq(files.id, id)).returning();

        await audit(req, 'restore', restored!)


        return res.status(200).json({
            restored
        });


} catch(err) {
    return handleError(res, err, 'Erro ao restaurar arquivo.')
}

});




const favoriteSchema = z.object({
    favorited: z.boolean()
})

file.patch('/:id/favorite', requireAuth, async (req: Request, res: Response) => {
    try {
        const id = req.params['id'] as string;
        const { favorited } = favoriteSchema.parse(req.body);
        const record = await findOwned(id, req.session.username!)

        const [updated] = await db.update(files).set({ favorited, updatedAt: new Date() }).where(eq(files.id, id)).returning();

        return res.status(200).json({ favorited: updated!.favorited });

    } catch (err) {
        return handleError(res, err, 'Erro ao favoritar arquivo.')
    }
});



file.get('/storage', requireAuth, async (req: Request, res: Response) => {
    try {
        const storage = await getStorageInfo(req.session.username!);

        return res.status(200).json({
            storage
        })

      
    } catch (err) {
        return handleError(res, err, 'Erro ao buscar armazenamento.')
    }
});





file.post('/upload-folder', requireAuth, upload.array('file', 500), async (req: Request, res: Response) => {
    try {
        const uploadedFiles = req.files as Express.Multer.File[];

        if (!uploadedFiles || uploadedFiles.length === 0) {
            return res.status(400).json({ error: "Nenhum arquivo fornecido." });
        }

        let relativePaths: string[];
        try {
            relativePaths = JSON.parse(req.body.paths);
            if (!Array.isArray(relativePaths) || relativePaths.length !== uploadedFiles.length) {
                return res.status(400).json({ error: "Paths dos arquivos não informados corretamente." });
            }
        } catch {
            return res.status(400).json({ error: "Paths dos arquivos não informados corretamente." });
        }

        const { parentId } = uploadBodySchema.parse(req.body);

        let basePath = env.VAULT_PATH;
        let baseParentId: string | null = parentId ?? null;

        if (parentId) {
            const parentFolder = await validateParent(parentId, req.session.username!)
            basePath = parentFolder.path;
        }

        const incomingSize = uploadedFiles.reduce((acc, f) => acc + f.size, 0);
        await checkQuota(req.session.username!, incomingSize)

        for (const p of relativePaths) {
            if (/(\.\.[\\/])|(^[\\/])/.test(p)) {
                return res.status(400).json({ error: "Path inválido detectado." });
            }
        }


        const results = await uploadFolderService(uploadedFiles, relativePaths, basePath, baseParentId, req.session.username!)

        for (const newFile of results) {
            await audit(req, 'upload', newFile)
        }

        return res.status(201).json({ files: results });

    } catch (err) {
        return handleError(res, err, 'Erro ao fazer upload de pasta.')
    }
});



file.get('/folders/:id/size', requireAuth, async (req: Request, res: Response) => {
    const id = req.params['id'] as string;
    const username = req.session.username!

    if (!UUID_REGEX.test(id)) {
        return res.status(400).json({ error: 'ID inválido.' })
    }

    try {
        const size = await getStorageFolder(id, username)
        
        return res.json({ size })



    
    } catch (err) {
        logger.error(err, 'Erro ao calcular tamanho da pasta.')
        return res.status(500).json({ error: 'Erro interno do servidor.' })
    }
})






file.post('/:id/copy', requireAuth, async(req: Request, res: Response) => {
    try{
        const id = req.params['id'] as string
        const record = await findOwned(id, req.session.username!);

        if(record.inTrash){
            return res.status(400).json({
                error: "Arquivo está na lixeira."
            })
        }

        const siblings = await findDuplicate('', record.parentId).then(() => record.parentId ? db.select({ name: files.name }).from(files).where(and(eq(files.parentId, record.parentId), eq(files.inTrash, false)))
    : db.select({ name: files.name }).from(files).where(and(isNull(files.parentId), eq(files.inTrash, false), eq(files.ownerUsername, req.session.username!)))
    )


    const copyName = generateCopyName(record.name, siblings)
    const parentPath = path.dirname(record.path);


    if(!record.isDirectory){
        await checkQuota(req.session.username!, record.size ?? 0)

        const newPath = path.join(parentPath, copyName);

        await fsp.copyFile(record.path, newPath);
        const [newFile ] = await await db.insert(files).values({
            name: copyName,
            path: newPath,
            parentId: record.parentId,
            isDirectory: false,
            size: record.size, 
            mimeType: record.mimeType,
            extension: record.extension, 
            ownerUsername: req.session.username!
        }).returning()

        await audit(req, 'copy', newFile!);
        return res.status(201).json({
            file: newFile
        })
    }

    const newFolder = await copyFolderService(id, req.session.username!, copyName, record.parentId, parentPath);
    await audit(req, 'copy', record);

    return res.status(201).json({
        folderId: newFolder?.id
    })



    }catch(err){
        return handleError(res, err, 'Erro ao copiar arquivo.')

    }

})







file.patch('/:id/move', requireAuth, async (req: Request, res: Response) => {
    try{

        const id = req.params['id'] as string;
        const { targetId } = moveSchema.parse(req.body)
        const record = await findOwned(id, req.session.username!)



        if (record.inTrash){
            return res.status(400).json({ error: "Arquivo está na lixeira." })
        }


        if (record.parentId === targetId){ 
            return res.status(400).json({ error: "O item já está nessa pasta." })
        }


        if (record.id === targetId){
            return res.status(400).json({ error: "Não é possível mover uma pasta para dentro de si mesma." })
        } 


        let destPath = env.VAULT_PATH

        if (targetId) {
            const target = await validateParent(targetId, req.session.username!)


            if (record.isDirectory && target.path.startsWith(record.path + '/')) {
                return res.status(400).json({ error: "Não é possível mover uma pasta para dentro de um de seus subdiretórios." })
            }

            destPath = target.path
        }

        const existing = await findDuplicate(record.name, targetId)
        if (existing[0]){
            return res.status(409).json({ error: "Já existe um item com esse nome no destino." })
        }


        const oldPath = record.path
        const newPath = path.join(destPath, record.name)

        await fsp.rename(oldPath, newPath)

        await db.transaction(async (tx) => {
            await tx.update(files).set({ parentId: targetId, path: newPath, updatedAt: new Date() }).where(eq(files.id, id))

            if (record.isDirectory) {
                await tx.execute(sql`
                    UPDATE files
                    SET path = ${newPath} || SUBSTR(path, ${oldPath.length + 1})
                    WHERE path LIKE ${oldPath + '/%'}
                    AND owner_username = ${req.session.username!}
                `)
            }
        })

        await audit(req, 'move', record)
        return res.status(200).json({ message: "Item movido com sucesso." })

    } catch(err) {
        return handleError(res, err, 'Erro ao mover arquivo.')
    }
})


export default file