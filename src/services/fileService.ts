import { db } from '../db/index.js'
import { files } from '../db/schema.js'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { getStorageInfo } from './storage.js';
import { createReadStream } from 'fs';
import { mkdir } from 'fs/promises';
import * as path from 'path';
import { logger } from '../config/logger.js';
import { Request, Response } from 'express';
import * as fsp from 'fs/promises';


export class NotFoundError extends Error {}

export async function findOwned(id: string, username: string){
    const [record] = await db.select().from(files).where(and(eq(files.id, id), eq(files.ownerUsername, username)));

    if(!record) throw new NotFoundError('Arquivo não encontrado.');
    
    return record;
}



export async function validateParent(parentId: string, username: string){
    const [parent] = await db.select().from(files).where(and(eq(files.id, parentId), eq(files.ownerUsername, username)));

    if(!parent) throw new NotFoundError('Pasta de destino não encontrada.');
    if(!parent.isDirectory) throw new Error('O destino não é uma pasta.')

        return parent;
}


export class QuotaError extends Error {};

export async function checkQuota(username: string, incomingSize: number){
    const { used, total } = await getStorageInfo(username);

    if(used + incomingSize > total) throw new QuotaError('Armazenamento insuficiente.');
}



export function pipeFile(res: Response, filePath: string, options?: { start: number; end: number}){
    const stream = createReadStream(filePath, options)

    stream.on('error', (err) =>{
        logger.error(err, 'Erro ao transmitir arquivo');
        if(!res.headersSent) res.status(500).json({ error: 'Erro ao transmitir arquivo. '})
    })
stream.pipe(res);
}



export function setDownloadHeaders(res: Response, record: { name: string, mimeType: string | null; size: number | null}){
    res.setHeader('Content-Type', record.mimeType ?? 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(record.name)}`)
    res.setHeader('Content-Length', record.size ?? 0)
}


export async function findDuplicate(name: string, parentId: string | null){
    return parentId ? db.select().from(files).where(and(eq(files.parentId, parentId), eq(files.name, name))) :
    db.select().from(files).where(and(isNull(files.parentId), eq(files.name, name)));
}



export async function uploadFolderService(
    uploadedFiles: Express.Multer.File[],
    relativePaths: string[],
    basePath: string,
    baseParentId: string | null,
    username: string
){
    return await db.transaction(async (tx) => {
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
                    ? await tx.select().from(files).where(and(eq(files.parentId, currentParentId), eq(files.name, segment)))
                    : await tx.select().from(files).where(and(isNull(files.parentId), eq(files.name, segment)));

                let folderId: string;

                if (existingInDb[0]) {
                    folderId = existingInDb[0].id;
                } else {
                    const [newFolder] = await tx.insert(files).values({
                        name: segment,
                        path: folderPath,
                        parentId: currentParentId,
                        isDirectory: true,
                        ownerUsername: username
                    }).returning();
                    folderId = newFolder!.id;
                }

                folderIdMap.set(segmentKey, { id: folderId, path: folderPath });
                currentParentId = folderId;
                currentBasePath = folderPath;
            }
        }

        const fileValues = uploadedFiles.map((f, i) => {
            const relativePath = relativePaths[i]!;
            const originalname = Buffer.from(f.originalname, 'latin1').toString('utf8');
            const dir = path.dirname(relativePath);
            const fileParentId = dir === '.' ? baseParentId : (folderIdMap.get(dir)?.id ?? baseParentId);
            const extensionName = originalname.split('.').pop() ?? null;

            return {
                name: originalname,
                path: f.path,
                parentId: fileParentId,
                isDirectory: false as const,
                size: f.size,
                mimeType: f.mimetype,
                extension: extensionName,
                ownerUsername: username
            }
        });

        const CHUNK_SIZE = 500
        const results = []
        for (let i = 0; i < fileValues.length; i += CHUNK_SIZE) {
            const chunk = fileValues.slice(i, i + CHUNK_SIZE)
            const inserted = await tx.insert(files).values(chunk).returning()
            results.push(...inserted)
        }
        return results
    });
}




export function generateCopyName(sourceName: string, siblings: {name: string}[]): string {
    const base = sourceName.replace(/ \(Copy\)(\(\d+\))*$/, '').trim() + ' (Copy)'
    if(!siblings.some(s => s.name === base)) return base;
    let i = 1;

    while(siblings.some(s => s.name === `${base}(${i})`)) i++;
    return `${base}(${i})`

}


export async function copyFolderService(sourceId: string, username: string, copyName: string, destParentId: string | null, destParentPath: string){
    const treeResult = await db.execute(sql`
        WITH RECURSIVE tree AS (
            SELECT id, name, path AS disk_path, is_directory, parent_id,
                   size, mime_type, extension, 0 AS depth
            FROM files
            WHERE id = ${sourceId}
            UNION ALL
            SELECT f.id, f.name, f.path, f.is_directory, f.parent_id,
                   f.size, f.mime_type, f.extension, tree.depth + 1
            FROM files f
            INNER JOIN tree ON f.parent_id = tree.id
        )
        SELECT * FROM tree ORDER BY depth
    `)


    type Node = { id: string; name: string; disk_path: string; is_directory: boolean; parent_id: string | null; size: number | null; mime_type: string | null; extension: string | null }
    const nodes = treeResult.rows as Node[]

    // console.log('[copyFolderService] first row keys:', Object.keys(treeResult.rows[0] ?? {}))
    // console.log('[copyFolderService] first row:', JSON.stringify(treeResult.rows[0]))

    return await db.transaction(async (tx) => {
        const idMap = new Map<string, { id: string; path: string }>()

        for (const node of nodes) {
            const isRoot   = node.id === sourceId
            const newName  = isRoot ? copyName : node.name
            const parentEntry = node.parent_id ? idMap.get(node.parent_id) : null
            const newParentId   = isRoot ? destParentId   : (parentEntry?.id   ?? destParentId)
            const newParentPath = isRoot ? destParentPath : (parentEntry?.path ?? destParentPath)
            const newPath  = path.join(newParentPath, newName)

            if (node.is_directory) {
                await mkdir(newPath, { recursive: true })
                const [newDir] = await tx.insert(files).values({
                    name: newName, path: newPath,
                    parentId: newParentId, isDirectory: true,
                    ownerUsername: username
                }).returning()
                idMap.set(node.id, { id: newDir!.id, path: newPath })
            } else {
                await fsp.copyFile(node.disk_path, newPath)
                await tx.insert(files).values({
                    name: newName, path: newPath,
                    parentId: newParentId, isDirectory: false,
                    size: node.size, mimeType: node.mime_type,
                    extension: node.extension, ownerUsername: username
                })
            }
        }

        return idMap.get(sourceId)
    })
}