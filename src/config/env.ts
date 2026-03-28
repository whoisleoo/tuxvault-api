import { z } from 'zod';

const envSchema = z.object({
    SMTP_HOST: z.string(),
    SMTP_PORT: z.coerce.number(),
    SMTP_USER: z.string(),
    SMTP_PASS: z.string(),
    DEV_ADMIN_USERNAME: z.string(),
    PORT: z.coerce.number(),
    DATABASE_URL: z.url(),
    SESSION_SECRET: z.string().min(1),
    SAMBA_HOST: z.string().min(1),
    SAMBA_SHARE: z.string().min(1),
    SMTP_TO: z.email(),
    HOST_SSH_USER: z.string().min(1),
    APP_URL: z.string().url(),
    DEV_MODE: z.string().transform(v => v === 'true').default(false)

})
 


export const env = envSchema.parse(process.env);

