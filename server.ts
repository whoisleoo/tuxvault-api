import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import router from './src/routes/routes.js';

const PORT = process.env.PORT || 8080;
const app = express();
app.set('trust proxy', true);

app.use(express.json());
app.use(cors());

app.get('/', (req, res) => {
    res.json('Tuxvault API is online, if you are not an administrator, you must leave this page.');
});

app.use('/api', router);

app.listen(PORT, () => {
    console.log(`Tuxvault API is running at http://localhost:${PORT}`);
});