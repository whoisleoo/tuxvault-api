import { db } from '../db/index.js'
import { auditLog } from '../db/schema.js'
import { Request } from 'express'


type AuditFile = { id: string, name: string, path: string};

export async function audit(req: Request, action: string, file: AuditFile, extra?: Record<string, unknown>){
    await db.insert(auditLog).values({
        userId: req.session.userId,
        action,
        fileId: file.id,
        fileName: file.name,
        filePath: file.path,
        extra: extra ?? null,
        ipAddress: req.ip ?? null
    })
}