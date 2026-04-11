import { z } from 'zod';

/*
*    Schema do .env utilizando Zod.
*    ao tentar utilizar process.env typescript vai reclamar dizendo que a varivel pode ser vázia.
*    como alternativa, criei esse schema pra tratar os dados do env passando pra uma função que parseia
*    todas as variaveis do env.
*    
*    Quaisquer variaveis novas no env, devem ser validadas aqui caso forem ser usadas no código,
*    da pra utilizar facilmente importando env.ts e utilizando "env.(variavel)".
* 
* 
*    Em deploy, VAULT_MAX_SIZE_GB deve se adequar a quantidade real do seu servidor linux, por padrão é setado
*    com 500GB
*/


const envSchema = z.object({
    SMTP_HOST: z.string(),
    SMTP_PORT: z.coerce.number(),
    SMTP_USER: z.string(),
    SMTP_PASS: z.string(),
    DEV_ADMIN_USERNAME: z.string().default('admin'),
    PORT: z.coerce.number(),
    DATABASE_URL: z.string().min(1),
    SESSION_SECRET: z.string().min(32, "SESSION precisa ter no minimo 32 caracteres pra funcionar."),
    SAMBA_HOST: z.string().min(1),
    SAMBA_SHARE: z.string().min(1),
    SMTP_TO: z.email(),
    HOST_SSH_USER: z.string().min(1),
    APP_URL: z.string().url(),
    DEV_MODE: z.string().transform(v => v === 'true').default(false),
    VAULT_PATH: z.string().default('/data/vault'),
    NODE_ENV: z.enum(['development', 'production']).default('development'),
    UPLOAD_MAX_SIZE_GB: z.string().transform(v => parseInt(v)).default(15),
    VAULT_MAX_SIZE_GB: z.string().transform(v => parseInt(v)).default(500),
    AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
    SESSION_MAX_AGE_HOURS: z.coerce.number().positive().default(8),
    RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().positive().default(15),
    RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
    OTP_EXPIRY_MINUTES: z.coerce.number().positive().default(5),
    SMTP_SECURE: z.string().transform(v => v === 'true').default(false),
    REQUEST_TIMEOUT_MINUTES: z.coerce.number().positive().default(30),
})
 


export const env = envSchema.parse(process.env);

