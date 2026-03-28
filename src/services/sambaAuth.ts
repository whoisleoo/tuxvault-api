const { execFile } = require('child_process');
import { promisify } from "util";
import { writeFile, unlink } from 'fs/promises'
import { datetime } from "drizzle-orm/mysql-core";


const execFileAsync = promisify(execFile);
const tempfilePath = `/tmp/tuxvault_${Date.now()}`;

export async function sambaAuth(username: string, password: string){
    const isDevMode = process.env.DEV_MODE === 'true';
    const adminUsername = process.env.DEV_ADMIN_USERNAME;

    

    if(!adminUsername){
        throw new Error("DEV_ADMIN_USERNAME is not defined at .env");
    }

    if(isDevMode){
        // Isso aqui vai ser só pra desenvolvimento LEMBRAR DE TIRAR PRA PRODUÇÃO PORQUE NÃO É NECESSÁRIO
        const role = username === adminUsername ? 'admin' : 'user';

        return { username, role };
    }
    // ABAIXO FICARA O SISTEMA SMBCLIENT

    //  execFile('smbclient', ['-L', `${process.env.SERVER_IP}`, '-U', `${username}%${password}`, '-C', '-ls'];
            
        
    

}