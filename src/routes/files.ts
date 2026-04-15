import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { files } from '../db/schema.js';
import { db } from '../db/index.js'
import { eq, isNull, and, inArray, sql, ilike } from 'drizzle-orm'
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

/**
 * @swagger
 * tags:
 *   - name: Files
 *     description: Gerenciamento de arquivos e pastas
 *   - name: Auth
 *     description: Autenticação e sessão
 *   - name: Users
 *     description: Gerenciamento de usuários (admin)
 *   - name: Audit
 *     description: Logs de auditoria (admin)
 */




const uploadBodySchema = z.object({
    parentId: z.string().uuid().optional()
  });

  const folderSchema = z.object({
    name: z.string().min(1).max(255).refine((val) => !/(\/|\\|\.\.)/.test(val),{ message: "Nome de pasta inválido." }),
    parentId: z.string().uuid().optional()
})


const renameSchema = z.object({
    name: z.string().min(1).max(255, {message: "Número máximo de caracteres excedido."}).refine((val) => !/(\/|\\|\.\.)/.test(val),{message: "Nome inválido."}),
})

const copyBodySchema = z.object({
    parentId: z.string().uuid().nullable().optional()
})

const moveSchema = z.object({
    targetId: z.union([z.string().uuid(), z.null()])
})


const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i



const file: Router = Router();


/**
 * @swagger
 * /api/files:
 *   get:
 *     summary: Lista arquivos e pastas do diretório atual
 *     tags: [Files]
 *     parameters:
 *       - in: query
 *         name: parentId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID da pasta pai. Omitir para raiz.
 *     responses:
 *       200:
 *         description: Lista de arquivos
 *       401:
 *         description: Não autenticado
 */
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
    return handleError(res, err, 'Erro ao procurar arquivos.')
}

});

file.get('/search', requireAuth, async (req: Request, res: Response) => {
    try {
        const q = (req.query.q as string ?? '').trim()
        if (!q) return res.status(200).json([])

        const escaped = q.replace(/[%_\\]/g, '\\$&')
        const result = await db.select().from(files).where(
            and(
                eq(files.inTrash, false),
                ilike(files.name, `%${escaped}%`)
            )
        ).orderBy(files.isDirectory, files.name)

        return res.status(200).json(result)
    } catch(err) {
        return handleError(res, err, 'Erro ao pesquisar arquivos.')
    }
})




/**
 * @swagger
 * /api/files/upload:
 *   post:
 *     summary: Faz upload de um ou mais arquivos
 *     tags: [Files]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               parentId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Arquivos enviados
 *       409:
 *         description: Todos os arquivos já existem no destino
 *       413:
 *         description: Arquivo muito grande
 *       507:
 *         description: Armazenamento insuficiente
 */
file.post('/upload', requireAuth, upload.fields([{ name: 'file', maxCount: 500 }]), async (req: Request, res: Response) => {
    try{
        const uploadedFiles = (req.files as Record<string, Express.Multer.File[]>)?.['file'] ?? [];

        if(!uploadedFiles || uploadedFiles.length === 0){
            return res.status(400).json({
                error: "Nenhum arquivo fornecido."
            })
        }

        const { parentId } = uploadBodySchema.parse(req.body);

        if(parentId) await validateParent(parentId)

        const incomingSize = uploadedFiles.reduce((acc, f) => acc + f.size, 0);
        try {
            await checkQuota(incomingSize)
        } catch (quotaErr) {
            await Promise.allSettled(uploadedFiles.map(f => fsp.unlink(f.path)))
            throw quotaErr
        }

        const fileNames = uploadedFiles.map(f => Buffer.from(f.originalname, 'latin1').toString('utf8'));



        const existingFiles = parentId ? await db.select({ name: files.name }).from(files).where(and(eq(files.parentId, parentId), inArray(files.name, fileNames)))
        : await db.select({ name: files.name }).from(files).where(and(isNull(files.parentId), inArray(files.name, fileNames)));

        const existingNames = new Set(existingFiles.map(f => f.name));


        const results = [];
        const skippedPaths: string[] = [];
        for(const f of uploadedFiles) {
            const originalname = Buffer.from(f.originalname, 'latin1').toString('utf-8');
            if(existingNames.has(originalname)) { skippedPaths.push(f.path); continue }

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

        if (skippedPaths.length) await Promise.allSettled(skippedPaths.map(p => fsp.unlink(p)))

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





/**
 * @swagger
 * /api/files/folder:
 *   post:
 *     summary: Cria uma nova pasta
 *     tags: [Files]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 255
 *               parentId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Pasta criada
 *       409:
 *         description: Já existe pasta com esse nome
 */
file.post('/folder', requireAuth, async (req: Request, res: Response) => {
    try{    
        const BASE_PATH = env.VAULT_PATH


        const { name, parentId } = folderSchema.parse(req.body);

        let folderPath: string


        if(parentId){
            const parentFolder = await validateParent(parentId)

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









/**
 * @swagger
 * /api/files/download/{id}:
 *   get:
 *     summary: Faz download de um arquivo
 *     tags: [Files]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Conteúdo do arquivo
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Item é uma pasta
 *       404:
 *         description: Arquivo não encontrado
 */
file.get('/download/:id', requireAuth, async (req: Request, res: Response) => {
    try{
     const id = req.params['id'] as string;
     const record = await findOwned(id)

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









/**
 * @swagger
 * /api/files/download-zip/{id}:
 *   get:
 *     summary: Faz download de uma pasta como ZIP
 *     tags: [Files]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Arquivo ZIP da pasta
 *         content:
 *           application/zip:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Item não é uma pasta
 */
file.get('/download-zip/:id', requireAuth, async (req: Request, res: Response) => {
    try{
     const id = req.params['id'] as string;
     const record = await findOwned(id)

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
            WHERE id = ${id}

            UNION ALL

            SELECT f.id, f.name, f.path AS disk_path, f.is_directory, f.parent_id,
                   (tree.rel_path || '/' || f.name)::text AS rel_path
            FROM files f
            INNER JOIN tree ON f.parent_id = tree.id
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









/**
 * @swagger
 * /api/files/preview/{id}:
 *   get:
 *     summary: Visualiza um arquivo em streaming (suporte a Range)
 *     tags: [Files]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: header
 *         name: Range
 *         schema:
 *           type: string
 *         description: "Ex: bytes=0-1024"
 *     responses:
 *       200:
 *         description: Conteúdo completo
 *       206:
 *         description: Conteúdo parcial (Range request)
 *       400:
 *         description: Item é uma pasta
 *       416:
 *         description: Range inválido
 */
file.get('/preview/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const id = req.params['id'] as string;
        const record = await findOwned(id)

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








/**
 * @swagger
 * /api/files/trash/{id}:
 *   delete:
 *     summary: Move um item para a lixeira
 *     tags: [Files]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Item movido para lixeira
 *       400:
 *         description: Item já está na lixeira
 *       404:
 *         description: Item não encontrado
 */
file.delete('/trash/:id', requireAuth, async (req: Request, res: Response) => {
    try{
        const id = req.params['id'] as string;
        const record = await findOwned(id)

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





/**
 * @swagger
 * /api/files/rename/{id}:
 *   patch:
 *     summary: Renomeia um arquivo ou pasta
 *     tags: [Files]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 255
 *     responses:
 *       200:
 *         description: Item renomeado
 *       409:
 *         description: Nome já existe no mesmo diretório
 */
file.patch('/rename/:id', requireAuth, async (req: Request, res: Response) => {
    try{
        const id = req.params['id'] as string;
        const { name } = renameSchema.parse(req.body);
        const record = await findOwned(id)

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

        const oldPath = record.path
        const dir = path.dirname(oldPath)
        const newPath = path.join(dir, name)





        if (oldPath !== newPath) {
            await fsp.rename(oldPath, newPath)
            if (record.isDirectory) {
                await db.execute(sql`
                    UPDATE files
                    SET path = ${newPath} || SUBSTRING(path FROM ${oldPath.length + 1})
                    WHERE path LIKE ${oldPath + '/%'}
                `)
        }
        }

        const [rename] = await db.update(files).set({ name, path: newPath, updatedAt: new Date() }).where(eq(files.id, id)).returning();

        await audit(req, 'rename', rename!, { oldName: record.name })


        return res.status(200).json({
            rename
        })


    } catch(err) {
        return handleError(res, err, 'Erro ao renomear o arquivo.')
    }

});




/**
 * @swagger
 * /api/files/favorites:
 *   get:
 *     summary: Lista os itens favoritados do usuário
 *     tags: [Files]
 *     responses:
 *       200:
 *         description: Lista de favoritos
 */
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


/**
 * @swagger
 * /api/files/trash:
 *   get:
 *     summary: Lista os itens na lixeira
 *     tags: [Files]
 *     responses:
 *       200:
 *         description: Lista de itens na lixeira
 */
file.get('/trash', requireAuth, async (req: Request, res: Response) => {
    try{    
        const result = await db.select().from(files).where(eq(files.inTrash, true));


        return res.status(200).json(result);

} catch(err) {
    return handleError(res, err, 'Erro ao listar lixeira.')
}

});




/**
 * @swagger
 * /api/files/trash/{id}/permanent:
 *   delete:
 *     summary: Exclui permanentemente um item da lixeira
 *     tags: [Files]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Item excluído permanentemente
 *       400:
 *         description: Item não está na lixeira
 */
file.delete('/trash/:id/permanent', requireAuth, async (req: Request, res: Response) => {
    try{
        const id = req.params['id'] as string;
        const record = await findOwned(id)

        if(!record.inTrash){
            return res.status(400).json({
                error: "Arquivo não está na lixeira."
            })
        }

        if (record.isDirectory) {
            await fsp.rm(record.path, { recursive: true, force: true }).catch(() => {});
        } else {
            await fsp.unlink(record.path).catch(() => {});
        }

        await db.delete(files).where(eq(files.id, id));

        await audit(req, 'deleted', { name: record.name, path: record.path });


        return res.status(200).json({
            message: "Arquivo deletado permanentemente."
        });


} catch(err) {
    return handleError(res, err, 'Erro ao deletar permanentemente o arquivo.')
}

});





/**
 * @swagger
 * /api/files/trash/{id}/restore:
 *   patch:
 *     summary: Restaura um item da lixeira
 *     tags: [Files]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Item restaurado
 *       400:
 *         description: Item não está na lixeira
 */
file.patch('/trash/:id/restore', requireAuth, async (req: Request, res: Response) => {
    try{
        const id = req.params['id'] as string;
        const record = await findOwned(id)

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

/**
 * @swagger
 * /api/files/{id}/favorite:
 *   patch:
 *     summary: Favorita ou desfavorita um item
 *     tags: [Files]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [favorited]
 *             properties:
 *               favorited:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Estado de favorito atualizado
 */
file.patch('/:id/favorite', requireAuth, async (req: Request, res: Response) => {
    try {
        const id = req.params['id'] as string;
        const { favorited } = favoriteSchema.parse(req.body);
        const record = await findOwned(id)

        const [updated] = await db.update(files).set({ favorited, updatedAt: new Date() }).where(eq(files.id, id)).returning();

        return res.status(200).json({ favorited: updated!.favorited });

    } catch (err) {
        return handleError(res, err, 'Erro ao favoritar arquivo.')
    }
});



file.get('/storage/breakdown', requireAuth, async (req: Request, res: Response) => {
    try {
        const result = await db.execute(sql`
            SELECT
                COALESCE(SUM(CASE WHEN mime_type LIKE 'image/%' THEN size ELSE 0 END), 0)::bigint AS images,
                COALESCE(SUM(CASE WHEN mime_type LIKE 'video/%' THEN size ELSE 0 END), 0)::bigint AS videos,
                COALESCE(SUM(CASE WHEN mime_type LIKE 'audio/%' THEN size ELSE 0 END), 0)::bigint AS audio,
                COALESCE(SUM(CASE WHEN LOWER(extension) = ANY(ARRAY['zip','tar','gz','rar','7z','bz2','xz','tgz']) THEN size ELSE 0 END), 0)::bigint AS archives,
                COALESCE(SUM(CASE WHEN LOWER(extension) = ANY(ARRAY['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md','rtf','odt','csv']) THEN size ELSE 0 END), 0)::bigint AS documents,
                COALESCE(SUM(CASE WHEN LOWER(extension) = ANY(ARRAY['js','ts','jsx','tsx','py','java','c','cpp','go','rs','php','rb','swift','kt','html','css','scss','json','yaml','yml','xml','sh','bash','sql','vue','svelte','lua','r']) THEN size ELSE 0 END), 0)::bigint AS code,
                COALESCE(SUM(size), 0)::bigint AS total
            FROM files
            WHERE in_trash = false
            AND is_directory = false
        `)
        const row = result.rows[0] as Record<string, string>
        const images = Number(row.images)
        const videos = Number(row.videos)
        const audio = Number(row.audio)
        const archives = Number(row.archives)
        const documents = Number(row.documents)
        const code = Number(row.code)
        const total = Number(row.total)
        const other = Math.max(0, total - images - videos - audio - archives - documents - code)
        return res.status(200).json({ breakdown: { images, videos, audio, archives, documents, code, other } })
    } catch (err) {
        return handleError(res, err, 'Erro ao buscar breakdown de armazenamento.')
    }
})

/**
 * @swagger
 * /api/files/storage:
 *   get:
 *     summary: Retorna informações de armazenamento do usuário
 *     tags: [Files]
 *     responses:
 *       200:
 *         description: Dados de armazenamento
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 storage:
 *                   type: object
 *                   properties:
 *                     used:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     free:
 *                       type: integer
 */
file.get('/storage', requireAuth, async (req: Request, res: Response) => {
    try {
        const storage = await getStorageInfo();

        return res.status(200).json({
            storage
        })

      
    } catch (err) {
        return handleError(res, err, 'Erro ao buscar armazenamento.')
    }
});





/**
 * @swagger
 * /api/files/upload-folder:
 *   post:
 *     summary: Faz upload de uma pasta com estrutura de diretórios
 *     tags: [Files]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, paths]
 *             properties:
 *               file:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               paths:
 *                 type: string
 *                 description: JSON array com os caminhos relativos de cada arquivo
 *               parentId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Pasta enviada com sucesso
 *       507:
 *         description: Armazenamento insuficiente
 */
file.post('/upload-folder', requireAuth, upload.fields([{ name: 'file', maxCount: 10000 }]), async (req: Request, res: Response) => {
    try {
        const uploadedFiles = (req.files as Record<string, Express.Multer.File[]>)?.['file'] ?? [];

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
            const parentFolder = await validateParent(parentId)
            basePath = parentFolder.path;
        }

        const incomingSize = uploadedFiles.reduce((acc, f) => acc + f.size, 0);
        try {
            await checkQuota(incomingSize)
        } catch (quotaErr) {
            await Promise.allSettled(uploadedFiles.map(f => fsp.unlink(f.path)))
            throw quotaErr
        }

        for (const p of relativePaths) {
            if (/(\.\.[\\/])|(^[\\/])/.test(p)) {
                return res.status(400).json({ error: "Path inválido detectado." });
            }
            const normalized = path.posix.normalize(p)
            if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
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



/**
 * @swagger
 * /api/files/folders/{id}/size:
 *   get:
 *     summary: Retorna o tamanho total de uma pasta
 *     tags: [Files]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Tamanho da pasta em bytes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 size:
 *                   type: integer
 */
file.get('/folders/:id/size', requireAuth, async (req: Request, res: Response) => {
    const id = req.params['id'] as string;

    if (!UUID_REGEX.test(id)) {
        return res.status(400).json({ error: 'ID inválido.' })
    }

    try {
        const size = await getStorageFolder(id)
        
        return res.json({ size })



    
    } catch (err) {
        logger.error(err, 'Erro ao calcular tamanho da pasta.')
        return res.status(500).json({ error: 'Erro interno do servidor.' })
    }
})






/**
 * @swagger
 * /api/files/{id}/copy:
 *   post:
 *     summary: Cria uma cópia de um arquivo ou pasta
 *     tags: [Files]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       201:
 *         description: Cópia criada
 *       400:
 *         description: Item está na lixeira
 *       507:
 *         description: Armazenamento insuficiente
 */
file.post('/:id/copy', requireAuth, async(req: Request, res: Response) => {
    try{
        const id = req.params['id'] as string
        const { parentId: destinationId } = copyBodySchema.parse(req.body)
        
        const record = await findOwned(id);

        if(record.inTrash){
            return res.status(400).json({
                error: "Arquivo está na lixeira."
            })
        }


        let targetParentId = record.parentId;

        let destPath = path.dirname(record.path);

        if(destinationId !== undefined){
            if(destinationId === null){ //ve se ta na raiz
                targetParentId = null;
                destPath = env.VAULT_PATH;
            } else {
                let destination = await validateParent(destinationId);
                targetParentId = destination.id;
                destPath = destination.path;
            }
        }



        const siblings = targetParentId
            ? await db.select({ name: files.name }).from(files).where(eq(files.parentId, targetParentId))
            : await db.select({ name: files.name }).from(files).where(isNull(files.parentId))


    const copyName = generateCopyName(record.name, siblings)

    if(!record.isDirectory){
        await checkQuota(record.size ?? 0)


        
        const newPath = path.join(destPath, copyName);

        await fsp.copyFile(record.path, newPath);
        const [newFile ] = await await db.insert(files).values({
            name: copyName,
            path: newPath,
            parentId: targetParentId,
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

    const newFolder = await copyFolderService(id, req.session.username!, copyName, targetParentId, destPath);
    await audit(req, 'copy', record);

    return res.status(201).json({
        folderId: newFolder?.id
    })



    }catch(err){
        return handleError(res, err, 'Erro ao copiar arquivo.')

    }

})







/**
 * @swagger
 * /api/files/{id}/move:
 *   patch:
 *     summary: Move um item para outra pasta
 *     tags: [Files]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targetId]
 *             properties:
 *               targetId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *                 description: ID da pasta destino. null para mover para raiz.
 *     responses:
 *       200:
 *         description: Item movido
 *       400:
 *         description: Operação inválida (mover para si mesmo, subdiretório, etc.)
 *       409:
 *         description: Já existe item com esse nome no destino
 */
file.patch('/:id/move', requireAuth, async (req: Request, res: Response) => {
    try{

        const id = req.params['id'] as string;
        const { targetId } = moveSchema.parse(req.body)
        const record = await findOwned(id)



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
            const target = await validateParent(targetId)

            if(record.isDirectory && target.path.startsWith(record.path + '/')) {
                return res.status(400).json({ error: "Não é possível mover uma pasta para dentro de um de seus subdiretórios." })
            }
            destPath = target.path
        }

        const existing = await findDuplicate(record.name, targetId)
        if (existing[0]){
            return res.status(409).json({ error: "Já existe um item com esse nome no destino." })
        }


        const oldPath = path.normalize(record.path)
        const newPath = path.normalize(path.join(destPath, record.name))

        try {
            await fsp.access(oldPath)
        } catch {
            return res.status(409).json({ error: 'Arquivo não encontrado no disco. O caminho armazenado pode estar desatualizado.' })
        }

        await fsp.mkdir(path.dirname(newPath), { recursive: true })
        await fsp.rename(oldPath, newPath)

        await db.transaction(async (tx) => {
            await tx.update(files).set({ parentId: targetId, path: newPath, updatedAt: new Date() }).where(eq(files.id, id))

            if (record.isDirectory) {
                await tx.execute(sql`
                    UPDATE files
                    SET path = ${newPath} || SUBSTR(path, ${oldPath.length + 1})
                    WHERE path LIKE ${oldPath + '/%'}
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