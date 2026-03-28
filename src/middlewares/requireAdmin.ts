import { Request, Response, NextFunction } from 'express';



export const requireAuth = (req: Request, res: Response, next: NextFunction): Response | void =>{
    const userSession = req.session.userId;
    const userRole = req.session.userId;

    if(!userSession){
        return res.status(401).json({
            error: "Aceso negado.",
            message: "Essa sessão não existe ou é invalida."
        })
    }

    if()

    next();
}