import { db } from '../db/index.js';
import { files } from '../db/schema.js';
import { sum, eq, and } from 'drizzle-orm';
import { env } from '../config/env.js';

export async function getStorageInfo() {
    const result = await db.select({ total: sum(files.size) }).from(files).where(and(eq(files.isDirectory, false), eq(files.inTrash, false)));

    const used = Number(result[0]?.total ?? 0);
    const total = env.VAULT_MAX_SIZE_GB * 1024 * 1024 * 1024;
    const free = total - used;

    return { used, total, free };
}