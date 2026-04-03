

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
import { pendingTwoFa } from './src/db/schema.js';
import { lt } from 'drizzle-orm';
import { db } from './src/db/index.js';
import { NextFunction, Request, Response } from 'express';
import { logger } from './src/config/logger.js';
import { ipFilter, banIp, loadBannedIps, cleanExpiredBans } from './src/middlewares/blacklistIp.js';
import { requireAdmin } from './src/middlewares/requireAdmin.js';
import { setupSwagger } from './src/config/swagger.js';

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
        maxAge: 1000 * 60 * 60 * 8
    }
}))




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

app.all('/.env',             honeyPot)
app.all('/.git/config',      honeyPot)
app.all('/wp-login.php',     honeyPot)
app.all('/wp-admin',         honeyPot)
app.all('/xmlrpc.php',       honeyPot)
app.all('/phpmyadmin',       honeyPot)
app.all('/admin/config',     honeyPot)
app.all('/actuator/env',     honeyPot)
app.all('/actuator/health',  honeyPot)
app.all('/.DS_Store',        honeyPot)

app.get('/', (req, res) => {
    res.json('Tuxvault API is online, if you are not an administrator, you must leave this page.');
});

app.use('/api', router);
app.use('/api/auth', authRouter)
app.use('/api/files', fileRouter)
app.use('/api/users', userRouter);
app.use('/api/audit', auditRouter);
app.use('/api-docs', requireAdmin, (req, res, next) => {
    setupSwagger(app);
    next();
});

/*
*    Error Handler global, funciona como um middleware
*    global para todo o servidor, caso um erro não tenha sido
*    tratado em uma das rotas, ele provavelmente vai ser mostrado por esse handler.
*
*/
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: `Arquivo muito grande. O limite por upload é ${env.UPLOAD_MAX_SIZE_GB}GB.` })
        }
        return res.status(400).json({ error: err.message })
    }
    logger.error(err, 'Erro não tratado.');
    res.status(500).json({
        error: "Erro interno do servidor."
    })
})


loadBannedIps().catch(err => logger.error(err, 'Erro ao carregar blacklist.'))

app.listen(PORT, () => {
    console.log(`Tuxvault API is running at http://localhost:${PORT}`);
});
