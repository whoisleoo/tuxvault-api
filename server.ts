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


setInterval(async () =>{
    await db.delete(pendingTwoFa).where(lt(pendingTwoFa.expiresAt, new Date()))
}, 60 * 1000)






app.get('/', (req, res) => {
    res.json('Tuxvault API is online, if you are not an administrator, you must leave this page.');
});

app.use('/api', router);
app.use('/api/auth', authRouter)
app.use('/api/files', fileRouter)
app.use('/api/users', userRouter);
app.use('/api/audit', auditRouter);



// error handler global
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error(err, 'Erro não tratado.');
    res.status(500).json({
        error: "Erro interno do servidor."
    })
})


app.listen(PORT, () => {
    console.log(`Tuxvault API is running at http://localhost:${PORT}`);
});