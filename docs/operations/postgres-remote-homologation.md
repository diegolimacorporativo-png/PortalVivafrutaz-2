# Homologação PostgreSQL remota isolada

Este procedimento prepara o harness; não cria projeto/branch, não aplica migrations
e não inicia conexão automaticamente. O primeiro uso remoto exige aprovação do
responsável e um projeto/branch Supabase comprovadamente isolado.

## Guardas do runtime

O modo remoto é ativado somente por `ISOLATED_REMOTE_HOMOLOGATION_MODE=1`, com
`NODE_ENV=development` ou `test`, e requer:

- `ISOLATED_REMOTE_HOMOLOGATION_DATABASE_URL`: conexão exclusiva do ambiente;
- `ISOLATED_REMOTE_HOMOLOGATION_PROJECT_REF`: Project Ref do ambiente isolado;
- `ISOLATED_REMOTE_HOMOLOGATION_ENVIRONMENT=homologation`;
- `ISOLATED_REMOTE_HOMOLOGATION_SCHEMA=public`;
- `ISOLATED_REMOTE_HOMOLOGATION_MARKER_ID`: UUID criado especificamente para esse alvo;
- `ISOLATED_REMOTE_HOMOLOGATION_DATA_DIR`: diretório exclusivo dentro da pasta temporária local.

O processo falha se `DATABASE_URL` ou `SUPABASE_DATABASE_URL` estiver presente,
se o Project Ref esperado for o do banco principal, se o ref extraído da URL não
coincidir, ou se faltar qualquer identificação. A connection string nunca é
incluída nos logs. O modo local `ISOLATED_PREVIEW_MODE=1` continua independente.
O modo fiscal deve permanecer em `NFE_SEFAZ_MODE=mock`; o runtime isolado recusa
`homologacao` e `production`. E-mail, push e alertas externos também são
suprimidos no runtime isolado.

O servidor remoto de teste deve ser iniciado em loopback. O teste integrado exige
`ISOLATED_REMOTE_HOMOLOGATION_API_URL` com `http://127.0.0.1:<porta>` ou
`http://localhost:<porta>`; endpoints públicos são rejeitados.

## Atestação SQL obrigatória

Antes de abrir o servidor, o pool da aplicação consulta `current_database()` e
`current_schema()` e lê exatamente uma linha da tabela
`public.portal_homologation_identity`. A linha deve conter:

- `application = PortalVivafrutaz-2`;
- `project_ref` igual ao ref esperado e diferente do projeto principal;
- `environment = homologation` e `schema_name = public`;
- `marker_id` igual ao UUID definido no processo;
- `data_classification = synthetic_only` e `write_enabled = true`.

Essa tabela e sua linha precisam ser provisionadas pelo operador **somente no
projeto/branch isolado**, depois de sua identidade ser confirmada. Este repositório
não cria essa tabela automaticamente e nenhuma migration é executada pelo harness.
O schema de aplicação também precisa estar previamente preparado por procedimento
autorizado; se não estiver, o servidor falha fechado antes de escutar.
O repositório contém migrações SQL em `migrations/` e configuração Drizzle, mas
não contém `supabase/config.toml` nem o layout `supabase/migrations/` usado pelo
pipeline de Supabase Branching. Portanto, criar um branch não basta para garantir
que o schema do ERP seja aplicado; o procedimento de preparação do schema precisa
ser aprovado e planejado separadamente.

Antes da primeira escrita, o teste consulta novamente a atestação e confirma que
as tabelas centrais de empresas, usuários, produtos, pedidos, entregas, lotes de
produção, documentos fiscais, configurações e trilhas de auditoria/autenticação
estão vazias. O marcador, a URL/ref do Supabase e a identidade SQL devem concordar.
Um banco preenchido é recusado sem limpeza.

## Dados e teardown

O teste integrado usa um UUID novo por execução. Os registros sintéticos são
identificados imediatamente após a inserção por seus IDs retornados: empresas A e
B, usuário de teste, pedidos, produtos e filhos operacionais vinculados. O
teardown apaga somente esses IDs e os filhos ligados aos IDs de pedidos criados
na mesma execução. Não há varredura por prefixo, limpeza prévia, exclusão ampla,
ou escrita em `company_config` preexistente. A configuração fiscal sintética da
regressão billing/NF-e é criada apenas se a tabela singleton estiver vazia; a
regressão só roda no PostgreSQL local descartável, não no modo remoto.

Se o processo for interrompido antes do teardown, os resíduos sintéticos podem
permanecer. A próxima execução não os remove: o preflight remoto detecta o banco
não vazio e aborta. Um operador deve identificar o `runId` e autorizar limpeza
exata antes de qualquer remoção. O teste não transmite documentos à SEFAZ nem
usa dados fiscais reais.

## Execução posterior, após autorização

1. Confirmar no Dashboard que o alvo é um branch/projeto separado, sem dados de
   produção, e obter seu Project Ref e conexão pelo canal seguro.
2. Aplicar o schema necessário somente ao alvo isolado e provisionar a linha de
   atestação por procedimento aprovado. Não usar o projeto principal nem `public`
   do projeto principal.
3. Exportar as variáveis acima no terminal local, mantendo fora do Git e dos logs;
   não definir `DATABASE_URL` nem `SUPABASE_DATABASE_URL` nesse processo.
   Definir também um `SESSION_SECRET` sintético local com pelo menos 32 caracteres;
   o app não carrega `.env` neste modo.
4. Iniciar o servidor com `NODE_ENV=development` e o modo remoto explícito. A
   inicialização deve confirmar a atestação SQL e o schema somente de leitura.
5. Definir `ISOLATED_REMOTE_HOMOLOGATION_API_URL` para o listener local e executar
   `pnpm exec tsx --test tests/integration/order-finalization.api.test.ts`.
6. Conferir o resultado e o teardown; se houver falha de limpeza, parar e revisar
   somente os IDs daquele `runId`. Nunca executar sweep ou limpeza por prefixo.

## Limitações atuais

- O Project Ref do Supabase não é exposto por uma variável SQL nativa; a validação
  combina o ref extraído da URL, a igualdade com o ref esperado, o bloqueio do ref
  principal e uma atestação provisionada e consultada por SQL.
- A atestação é prova operacional de isolamento, não substitui confirmar no
  Dashboard que o branch não recebeu dados de produção.
- O modo remoto não executa a regressão billing/NF-e. Ela depende de configuração
  fiscal global e permanece restrita ao banco local temporário até receber fixture
  completamente isolada.
- Os testes unitários deste mecanismo usam mocks e não provam conectividade nem
  comportamento concorrente do PostgreSQL remoto.
