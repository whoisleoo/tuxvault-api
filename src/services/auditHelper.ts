import { db } from '../db/index.js'
import { auditLog } from '../db/schema.js'
import { Request } from 'express'


type AuditFile = { id: string, name: string, path: string};

export async function audit(req: Request, action: string, file: AuditFile){
    await db.insert(auditLog).values({
        userId: req.session.userId,
        action,
        fileId: file.id,
        fileName: file.name,
        filePath: file.path,
        ipAddress: req.ip ?? null
    })
}