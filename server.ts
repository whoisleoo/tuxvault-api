

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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
    } catch(err) {
        logger.error(err, 'Erro ao limpar código de dois fatores expirados.');
    }
}, 60 * 1000);





app.get('/', (req, res) => {
    res.json('Tuxvault API is online, if you are not an administrator, you must leave this page.');
});

app.use('/api', router);
app.use('/api/auth', authRouter)
app.use('/api/files', fileRouter)
app.use('/api/users', userRouter);
app.use('/api/audit', auditRouter);



/*
*    Error Handler global, funciona como um middleware
*    global para todo o servidor, caso um erro não tenha sido
*    tratado em uma das rotas, ele provavelmente vai ser mostrado por esse handler.
*    
*/
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error(err, 'Erro não tratado.');
    res.status(500).json({
        error: "Erro interno do servidor."
    })
})


app.listen(PORT, () => {
    console.log(`Tuxvault API is running at http://localhost:${PORT}`);
});