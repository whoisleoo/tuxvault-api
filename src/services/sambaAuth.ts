import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from 'fs/promises'
import { readFile } from "fs/promises";
import { env } from '../config/env.js';



const execFileAsync = promisify(execFile);

export async function sambaAuth(username: string, password: string){
    const isDevMode = env.DEV_MODE;


    if(isDevMode){
        // Isso aqui vai ser só pra desenvolvimento LEMBRAR DE TIRAR PRA PRODUÇÃO PORQUE NÃO É NECESSÁRIO
        const role = username === env.DEV_ADMIN_USERNAME ? 'admin' : 'user';

        return { username, role };
    }
    // ABAIXO FICARA O SISTEMA SMBCLIENT

    const tempfilePath = `/tmp/tuxvault_${Date.now()}`;

    try{
       

        await writeFile(tempfilePath, `username=${username}\npassword=${password}\n`, { mode: 0o600 });
    
        await execFileAsync('smbclient', [
            `//${process.env.SAMBA_HOST}/${process.env.SAMBA_SHARE}`,
            '-A', tempfilePath,
            '-c', 'quit'
        ])   
        
        await unlink(tempfilePath);


        const group = await readFile('/etc/group', 'utf-8');
        const sudoLine = group.split('\n').find(line => line.startsWith('sudo:'));
        const isAdmin = sudoLine?.split(':')[3]?.split(',').includes(username) ?? false;
        const role = isAdmin ? 'admin' : 'user';

        return { username, role };


    }catch(err){
        await unlink(tempfilePath).catch(() => {})
        return null;
    }

        
        
    

}