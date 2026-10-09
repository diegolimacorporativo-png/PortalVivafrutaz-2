# Testes de finalização manual em ambiente isolado

O teste de API usa o workflow `Start application` (`npm run dev:isolated`).
O launcher inicia um PostgreSQL temporário em loopback e, antes de qualquer
alteração de schema, verifica o banco, usuário, endereço, porta, diretório real
do servidor e marcador exclusivo do diretório temporário. Ele também exige que
o banco esteja vazio. Só então aplica o schema atual de `shared/schema.ts` e a
tabela de sessão; não executa as migrações históricas, seeds, workers ou
schedulers.

## Repetir a verificação

1. Inicie ou reinicie o workflow `Start application`. Cada início cria um banco
   temporário novo. O log deve mostrar
   `[ISOLATED_PREVIEW_DB_IDENTITY_VERIFIED]` e
   `[ISOLATED_PREVIEW_SCHEMA_READY]`.
2. Opcionalmente confirme a identidade do PostgreSQL no shell:

   ```sh
   psql 'postgresql://preview@127.0.0.1:55439/vivafrutaz_preview' \
     -X -Atc "SELECT current_database(), current_user, inet_server_addr(), inet_server_port(), current_setting('data_directory')"
   ```

   Espera-se `vivafrutaz_preview`, usuário `preview`, loopback `127.0.0.1`
   (normalmente exibido como `127.0.0.1/32`), porta `55439` e diretório dentro
   de `/tmp/vivafrutaz-isolated-preview.*/postgres`.
3. Com o workflow ainda ativo, rode:

   ```sh
   npm run test:integration:isolated
   ```

   Esse teste valida a identidade novamente antes de criar fixtures e chama a
   API pelo `REPLIT_DEV_DOMAIN` do preview. Os dados sintéticos permanecem
   somente no PostgreSQL temporário e são removidos quando o workflow encerra.
4. Rode os testes unitários seguros relacionados:

   ```sh
   npm run test:unit:order-finalization
   ```

O teste de integração falha fechado se o workflow, o marcador ou qualquer parte
da identidade do banco não corresponder ao PostgreSQL descartável esperado. Ele
nunca usa `SUPABASE_DATABASE_URL`, Render ou um fallback de produção.
