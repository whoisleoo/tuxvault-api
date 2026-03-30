import { Request, Response, NextFunction } from 'express';



export const requireAuth = (req: Request, res: Response, next: NextFunction): Response | void =>{
    const userSession = req.session.userId;

    if(!userSession){
        return res.status(401).json({
            error: "Acesso negado.",
            message: "Essa sessão não existe ou é invalida."
        })
    }

    next();
}