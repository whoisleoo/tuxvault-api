import { Request, Response, NextFunction } from 'express';



export const requireAuth = (req: Request, res: Response, next: NextFunction): Response | void =>{
    const userSession = req.session.userId;
    const userRole = req.session.role;

    if(!userSession){
        return res.status(401).json({
            error: "Aceso negado.",
            message: "Essa sessão não existe ou é invalida."
        })
    }

    if(userRole !== 'admin'){
        return res.status(403).json({
             error: "Aceso negado.",
            message: "Sua sessão não foi permitida pelo servidor."
        })
    }

    next();
}