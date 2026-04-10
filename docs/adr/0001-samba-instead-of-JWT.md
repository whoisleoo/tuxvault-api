# ADR-0001: Utilizar validação do Samba ao inves de sessões JWT

# Status
Accepted

# Contexto
TuxVault é um sistema de armazenamento pessoal que roda em Linux utilizando Samba já configurado
para compartilhamento de arquivos. Os usuarios que vão utilizar o drive serão os mesmos cadastrados
no Samba. Precisava de uma camada de autenticação que aproveitasse essa estrutura, sem criar um sistema paralelo.

Foi levado em conta o uso de JWT, mas acabou que não faria sentido utiliza-lo já estaria desvinculado com o controle
de acesso do servidor.

# Decisão
Usar as credenciais do Samba validada via `smbclient` (execFile).
Escreve as credenciais em um arquivo temporario em /tmp e verifica se a conexão é valida.
Role Admin é determinado pela presença do grupo `sudo` do sistema via /etc/group.

# Consequencias

**Positiva**
- Os usuarios do drive são os mesmos do samba.
- Não permite que outros usuários criem contas e acessem o drive.
- Facil de validar sessão e sem necessidade de fluxo de cadastro.

**Negativa**
- Todo usuario novo precisa ser criado pelo CLI do servidor.
- Pode complicar na hora do deploy em docker se mal configurado.
- Dificulta escabilidade horizontal.
- Tem risco de command injection.