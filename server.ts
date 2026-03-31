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




const PORT = process.env.PORT || 8080;
const app = express();
app.set('trust proxy', true);

app.use(express.json());
app.use(cors());


const PgStore = connectPgSimple(session)
app.use(session({
    store: new PgStore({ pool, createTableIfMissing: true }),
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false,    
        maxAge: 1000 * 60 * 60 * 8 
    }
}))






app.get('/', (req, res) => {
    res.json('Tuxvault API is online, if you are not an administrator, you must leave this page.');
});

app.use('/api', router);
app.use('/api/auth', authRouter)
app.use('/api/files', fileRouter)
app.use('/api/users', userRouter);



app.listen(PORT, () => {
    console.log(`Tuxvault API is running at http://localhost:${PORT}`);
});