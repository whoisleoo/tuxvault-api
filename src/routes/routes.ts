import { Router } from 'express';

const router = Router();

router.get('/status', (req, res) => {
    res.json({ message: 'Tuxvault API is online.' });
});

export default router;