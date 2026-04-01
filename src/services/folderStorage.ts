import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';


export async function getStorageFolder(folderId: string, username: string): Promise<number> {
    const result = await db.execute(sql`
        WITH RECURSIVE folder_tree AS (
        SELECT id, size, is_directory
        FROM files
        WHERE id = ${folderId}
            AND owner_username = ${username}

        UNION ALL
        
        SELECT f.id, f.size, f.is_directory
        FROM files f
        INNER JOIN folder_tree ft ON f.parent_id = ft.id
        WHERE f.owner_username = ${username}
        )     
        
        SELECT COALESCE(SUM(size), 0) AS total
        FROM folder_tree
        WHERE is_directory = false
        
        `)

        return Number((result.rows[0] as { total: string }).total);
}