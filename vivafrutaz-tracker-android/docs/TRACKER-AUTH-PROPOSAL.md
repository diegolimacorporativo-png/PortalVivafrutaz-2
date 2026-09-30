# Proposta específica: autenticação renovável do Tracker

> **Status atual:** a sessão do Tracker já foi separada da sessão comum do ERP
> e recebeu validade de 30 dias, renovada a cada envio de GPS. Isso atende
> turnos contínuos de 24 horas. O refresh token rotativo abaixo continua sendo
> a evolução recomendada para não depender de cookie de longa duração.

## Motivo

O ERP comum usa uma sessão `sessionId` com validade aproximada de 24 horas e não possui refresh token. O Tracker agora usa uma sessão específica de 30 dias, renovada no endpoint de GPS, mas ainda não possui refresh token rotativo.

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

## Próxima evolução recomendada

O comportamento atual já atende conexão contínua durante 24 horas ou mais,
desde que o APK esteja ativo e enviando GPS. A implementação de refresh token
rotativo continua recomendada antes de transformar a sessão em uma credencial
de longa duração permanente, pois permite revogação por dispositivo sem
guardar senha no APK e reduz a exposição de um cookie longo.
