import { db } from '../db/index.js'
import { files } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { getStorageInfo } from './storage.js';


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



