import { execFile } from "child_process";
import { promisify } from "util";
import { env } from '../config/env.js';




const execFileAsync = promisify(execFile);


export async function sambaUser(){
    const isDevMode = env.DEV_MODE;

    
   if(isDevMode){
    return []
   }
   
    const { stdout } = await execFileAsync('pdbedit', ['-L']);

    return stdout.split('\n').filter(line => line.trim() !== '').map(line => line.split(':')[0]);
}