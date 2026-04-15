

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import router from './src/routes/routes.js';
import authRouter from './src/routes/auth.js'
import fileRouter from './src/routes/files.js'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import { pool } from './src/db/index.js'
import { env } from './src/config/env.js';
import userRouter from './src/routes/users.js';
import auditRouter from './src/routes/audit.js';
import helmet from 'helmet';
import { pendingTwoFa, auditLog } from './src/db/schema.js';
import { lt, eq, sql } from 'drizzle-orm';
import { db } from './src/db/index.js';
import { NextFunction, Request, Response } from 'express';
import { logger } from './src/config/logger.js';
import { ipFilter, banIp, loadBannedIps, cleanExpiredBans } from './src/middlewares/blacklistIp.js';
import { requireAdmin } from './src/middlewares/requireAdmin.js';
import { swaggerJsonHandler, swaggerUiHandlers } from './src/config/swagger.js';
import cron from 'node-cron'


/*
*    TUX VAULT (PT-BR)
*    Tux Vault é uma alternativa do google drive
*    sendo sua principal vantagem ser open-source,
*    facilmente adaptavel com qualquer servidor linux
*    que contenha Samba como gerenciador de usuários.
*
*
*    Desenvolvido por: @whoisleoo
*    Considere colaborar com o projeto.
*
*/

if (env.DEV_MODE && env.NODE_ENV === 'production') {
    console.error('DEV_MODE=true não é permitido em NODE_ENV=production, portanto o servidor não pode ser iniciado.');
    process.exit(1);
}

if (env.DEV_MODE) {
    console.warn('ATENÇÃO: DEV_MODE está ativo, autenticação via SAMBA desativada.');
}


const PORT = process.env.PORT || 8080;
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(cors({
    origin: env.APP_URL,
    credentials: true
}));
app.use(helmet());
app.use(ipFilter);


const PgStore = connectPgSimple(session)
app.use(session({
    store: new PgStore({ pool, createTableIfMissing: true }),
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: env.SESSION_MAX_AGE_HOURS * 60 * 60 * 1000
    }
}))


cron.schedule('0 0 * * *', async () => {
    try {
      await db.delete(auditLog).where(lt(auditLog.createdAt, sql`NOW() - INTERVAL '1 day' * ${env.AUDIT_LOG_RETENTION_DAYS}`))
  
      logger.info('Limpeza do registro de auditoria executada com sucesso.')
    } catch (err) {
      logger.error(err, 'Erro ao limpar registro de auditoria antigos.')
    }
  })


 


setInterval(async () => {
    try {
        await db.delete(pendingTwoFa).where(lt(pendingTwoFa.expiresAt, new Date()));
        await cleanExpiredBans();
    } catch(err) {
        logger.error(err, 'Erro ao limpar registros expirados.');
    }
}, 60 * 1000);




async function honeyPot(req: Request, res: Response) {
    res.status(404).end()
    const ip = req.ip
    if (ip) {
        banIp(ip).catch(err => logger.error(err, 'Erro ao persistir ban no banco.'))
        logger.warn({ ip, path: req.path, method: req.method }, 'Honeypot triggered — IP bloqueado.')
    }
}

app.all('/.env', honeyPot)
app.all('/.env.:ext', honeyPot)
app.all('/.git/config', honeyPot)
app.all('/.git/*path', honeyPot)
app.all('/wp-login.php', honeyPot)
app.all('/wp-admin', honeyPot)
app.all('/wp-admin/*path', honeyPot)
app.all('/xmlrpc.php', honeyPot)
app.all('/phpmyadmin', honeyPot)
app.all('/phpmyadmin/*path', honeyPot)
app.all('/admin/config', honeyPot)
app.all('/actuator/env', honeyPot)
app.all('/actuator/health', honeyPot)
app.all('/actuator/*path', honeyPot)
app.all('/.DS_Store', honeyPot)
app.all('/config.json', honeyPot)
app.all('/server-status', honeyPot)

app.get('/', (req, res) => {
    res.json('Tuxvault API is online, if you are not an administrator, you must leave this page.');
});

app.use('/api', router);
app.use('/api/auth', authRouter)
app.use('/api/files', fileRouter)
app.use('/api/users', userRouter);
app.use('/api/audit', auditRouter);
if (env.NODE_ENV === 'production') {
    app.get('/api-docs.json', requireAdmin, swaggerJsonHandler)
    app.use('/api-docs', requireAdmin, ...swaggerUiHandlers)
} else {
    app.get('/api-docs.json', swaggerJsonHandler)
    app.use('/api-docs', ...swaggerUiHandlers)
}

/*
*    Error Handler global, funciona como um middleware
*    global para todo o servidor, caso um erro não tenha sido
*    tratado em uma das rotas, ele provavelmente vai ser mostrado por esse handler.
*
*/
app.use((err: Error & { code?: string }, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: `Arquivo muito grande. O limite por upload é ${env.UPLOAD_MAX_SIZE_GB}GB.` })
        }
        return res.status(400).json({ error: err.message })
    }
    if (err.message === 'Request aborted') {
        return res.status(499).end()
    }
    if (err.code === 'ENOSPC') {
        return res.status(507).json({ error: 'Armazenamento insuficiente no servidor.' })
    }
    logger.error(err, 'Erro não tratado.');
    res.status(500).json({
        error: "Erro interno do servidor."
    })
})


async function start() {
    await loadBannedIps().catch(err => logger.error(err, 'Erro ao carregar blacklist, verifique o Docker está rodando.'))
    const server = app.listen(PORT, () => {
        console.log(`Tuxvault API is running at http://localhost:${PORT}`)
    })
    server.requestTimeout  = env.REQUEST_TIMEOUT_MINUTES * 60 * 1000
    server.headersTimeout  = (env.REQUEST_TIMEOUT_MINUTES + 1) * 60 * 1000
}

start()
