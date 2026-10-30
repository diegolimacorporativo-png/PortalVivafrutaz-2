# Manutenção que antes ocorria na inicialização

O servidor não executa mais DDL nem corrige registros ao iniciar. Ele valida
somente a presença do schema obrigatório e falha antes de aceitar tráfego se a
migration controlada ainda não tiver sido aplicada.

## Migration estrutural

O arquivo `migrations/20261030_startup_schema.sql` reúne operações idempotentes
antes executadas no boot: `orders.is_recurring`, `recurring_order_logs`, os
campos `password_changed_at` e a tabela de sessões PostgreSQL. A aplicação não
executa esse arquivo automaticamente.

Antes de executar, o operador deve revisar o banco-alvo, confirmar um backup
recuperável e usar uma janela aprovada. O CLI exige confirmação do nome do banco
e `--apply`; sem `--apply`, apenas descreve o procedimento.

```powershell
npm run ops:startup -- schema --confirm-db=<nome-do-banco>
npm run ops:startup -- schema --confirm-db=<nome-do-banco> --apply
```

O comando não imprime a URL de conexão nem credenciais. Depois de aplicar, o
CLI valida a presença das colunas e tabelas requeridas.

## Recuperação de emissões NF-e interrompidas

O servidor não muda automaticamente pedidos de `enviando` para `erro`. Primeiro
faça um dry-run para obter a quantidade de registros candidatos. A aplicação
deve estar sem emissões fiscais em andamento antes de autorizar a atualização.
O `UPDATE` só afeta registros que ainda estejam em `enviando`, portanto repetir
a operação não altera novamente os registros já recuperados.

```powershell
npm run ops:startup -- recover-nfe --confirm-db=<nome-do-banco>
npm run ops:startup -- recover-nfe --confirm-db=<nome-do-banco> --apply --confirm-no-nfe-in-flight
```

Este procedimento não consulta nem transmite à SEFAZ. Revise manualmente o
resultado fiscal após uma interrupção; o status local `erro` não prova que a
SEFAZ deixou de receber uma transmissão anterior.

## Desbloqueio de contas estratégicas

O boot mantém apenas uma consulta de leitura para registrar o bypass em memória
do limitador de login. O reset de `is_locked`, `login_attempts` e de registros
em `auth_attempts` só é feito mediante comando explícito. A autenticação também
preserva o tratamento estratégico no login.

```powershell
npm run ops:startup -- unlock-strategic-accounts --confirm-db=<nome-do-banco>
npm run ops:startup -- unlock-strategic-accounts --confirm-db=<nome-do-banco> --apply --confirm-account-unlock
```

O reset é repetível: depois da primeira execução, as contas já limpas deixam de
ser candidatas. Senhas não são lidas nem modificadas.

## Proteção contra alvo errado

Todos os comandos exigem `--confirm-db` igual ao nome extraído da URL configurada.
Essa confirmação identifica o alvo, não autentica nem prova que ele é descartável.
Não use banco compartilhado ou de produção para homologação. O teste A/B precisa
de PostgreSQL local temporário comprovado pelo launcher isolado do projeto.
