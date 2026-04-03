import { Request, Response, NextFunction } from 'express'
import { db } from '../db/index.js'
import { blockedIps } from '../db/schema.js'
import { lt, or, gt, isNull } from 'drizzle-orm'
import { logger } from '../config/logger.js'

const cache = new Set<string>()

export async function loadBannedIps(): Promise<void> {
    const now = new Date()
    const rows = await db.select({ ip: blockedIps.ip }).from(blockedIps).where(or(isNull(blockedIps.expiresAt), gt(blockedIps.expiresAt, now)))
    cache.clear()


    for(const row of rows) cache.add(row.ip)
    logger.info(`Blacklist carregada: ${cache.size} IPs bloqueados.`)
}

export async function banIp(ip: string, reason = 'honeypot'): Promise<void> {
    cache.add(ip)
    await db.insert(blockedIps).values({ ip, reason }).onConflictDoUpdate({target: blockedIps.ip,set: { reason, blockedAt: new Date() },})
}

export async function cleanExpiredBans(): Promise<void> {
    const expired = await db
        .delete(blockedIps)
        .where(lt(blockedIps.expiresAt, new Date()))
        .returning({ ip: blockedIps.ip })
    for (const row of expired) cache.delete(row.ip)
    if (expired.length > 0) logger.info(`${expired.length} ban(s) expirados removidos.`)
}

export const ipFilter = (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip
    if (ip && cache.has(ip)) {
        logger.warn({ ip, path: req.path }, 'Requisição bloqueada — IP na blacklist.')
        return res.status(403).json({ error: 'Sua conexão foi bloqueada.' })
    }
    next()
}
