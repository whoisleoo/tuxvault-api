# ADR-0002: Criação de variavel de ambiente DEV_MODE que burla o sistema de login.

# Status
Accepted

# Contexto
Tuxvault faz o login de usuarios por meio de validação de sessão de usuarios cadastrados
no Samba. Acontece que o proprio Tuxvault está sendo desevolvido principalmente no windows,
Impedindo que eu consiga verificar a validação em tempo real.

Foi pensado em codar com o projeto já instalado no servidor Linux, mas a complicidade de
versionamento e instalação acabaram por me fazer mudar de ideia.

# Decisão
Uma nova variavel de ambiente chamada `DEV_MODE` pula toda a validação de login,
aceitando qualquer senha e qualquer usuario que tenha o mesmo nome de `DEV_USARNAME`.
Permitindo que debugs sejam realizados de forma prática.
Como ela burla os sistema de validação, ela **NUNCA** deve ser ativada em produção.

Vale ressaltar que mesmo com essa decisão, foi implementado meios de autenticação OTP
via SMPT pra questões de segurança.

# Consequencias

**Positivas**
- Muito mais prático pra codar sem depender de um ambiente externo.
- Via docker é certeiro que o sistema funcionará no linux.
- Permite que eu valide outras rotas pra verificação de modo de desenvolvimento.

**Negativas**
- Abre muitas brechas de segurança.
- Não existe confirmação que vá funcionar a validação de login no linux.
- Risco de `DEV_MODE` ser ativada em produção.