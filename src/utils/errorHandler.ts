import { NotFoundError, QuotaError } from '../services/fileService.js';
import { Response } from 'express';
import { logger } from '../config/logger.js';
import { z } from 'zod';





export function handleError(res: Response, err: unknown, msg: string){
    if(err instanceof z.ZodError) return res.status(400).json({ error: err.issues });
    if(err instanceof NotFoundError) return res.status(404).json({ error: err.message});
    if(err instanceof QuotaError) return res.status(507).json({ error: err.message});
    logger.error(err, msg);
    return res.status(500).json({ error: "Erro interno do servidor."});
}