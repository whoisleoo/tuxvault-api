import { Request, Response, NextFunction } from 'express';



export const requireAdmin = (req: Request, res: Response, next: NextFunction): Response | void =>{
    const userSession = req.session.userId;
    const userRole = req.session.role;

    if(!userSession){
        return res.status(401).json({
            error: "Acesso negado.",
            message: "Essa sessão não existe ou é invalida."
        })
    }

    if(userRole !== 'admin'){
        return res.status(403).json({
             error: "Acesso negado.",
            message: "Sua sessão não foi permitida pelo servidor."
        })
    }

    next();
}