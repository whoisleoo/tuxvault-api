import { z } from 'zod';

const envSchema = z.object({
    SMTP_HOST: z.string(),
    SMTP_PORT: z.coerce.number(),
    SMTP_USER: z.string(),
    SMTP_PASS: z.string(),
    DEV_ADMIN_USERNAME: z.string(),
})
 


export const env = envSchema.parse(process.env);

