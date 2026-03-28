

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

}