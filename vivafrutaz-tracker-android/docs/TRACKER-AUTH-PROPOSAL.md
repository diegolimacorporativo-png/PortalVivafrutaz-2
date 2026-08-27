# Proposta específica: autenticação renovável do Tracker

## Motivo

O ERP atual usa uma sessão `sessionId` com validade aproximada de 24 horas e não possui refresh token. Persistir o cookie no Android resolve fechamento, minimização e reinicialização do aparelho enquanto a sessão ainda estiver válida, mas não permite renovar a sessão depois da expiração sem guardar a senha do motorista.

Guardar a senha no APK, em `SharedPreferences` ou em banco local não é aceitável.

## Proposta recomendada

Adicionar um fluxo isolado para o Tracker, sem alterar o login do ERP e sem alterar o contrato do `POST /api/driver/gps`:

1. `POST /api/tracker/auth/login`
   - recebe email e senha uma única vez;
   - valida as mesmas credenciais e regras de papel do login administrativo;
   - cria uma sessão HTTP compatível com o endpoint GPS;
   - entrega um refresh token opaco, aleatório e de uso rotativo.

2. `POST /api/tracker/auth/refresh`
   - recebe o refresh token pelo corpo HTTPS;
   - valida somente o hash armazenado no servidor;
   - revoga o token anterior;
   - emite um novo refresh token;
   - cria/renova a sessão `sessionId` do motorista por mais um período;
   - mantém o mesmo `userId`, papel, tenant e vínculo de dispositivo.

3. `POST /api/tracker/auth/revoke`
   - revoga a família de refresh tokens do dispositivo;
   - pode ser chamado por uma função administrativa autorizada;
   - não recebe nem revela chave administrativa no APK.

## Persistência e segurança

- Criar uma tabela própria de tokens do Tracker, separada das sessões comuns do ERP.
- Armazenar somente hash do refresh token.
- Usar rotação a cada refresh e detectar reutilização de token.
- Associar token a `userId`, dispositivo, data de criação, expiração e revogação.
- Reutilizar o `tokenVersion` existente para revogação emergencial da conta.
- Nunca registrar token, senha ou cookie em logs.
- Exigir HTTPS fora do desenvolvimento.

## Comportamento do Android depois da aprovação

- guardar o refresh token no Android Keystore;
- chamar `/api/tracker/auth/refresh` antes da expiração;
- atualizar o cookie `sessionId` recebido;
- continuar enviando o GPS para `/api/driver/gps` sem alteração;
- se o refresh for revogado, parar o serviço com estado visível e exigir novo login;
- não oferecer botão comum de desligamento.

## Impacto controlado

Essa proposta altera somente o módulo de autenticação específico do Tracker e a persistência necessária para seus tokens. Não altera o login do ERP, não cria outro endpoint GPS e não muda o schema operacional de motoristas ou posições.

## Aprovação necessária

Esta proposta deve ser aprovada antes de criar rotas, tabelas ou migrations no backend. Até essa aprovação, o Tracker permanece implementado somente sobre a sessão atual de 24 horas e não declara o requisito de login único como concluído.