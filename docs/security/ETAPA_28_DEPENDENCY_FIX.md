# ETAPA 28 — CORREÇÃO DO BLOQUEIO DE DEPENDÊNCIA `cors`

**Data:** 10 de setembro de 2026  
**Objetivo:** restaurar a dependência já declarada sem alterar versões do projeto  
**Deploy:** não realizado  
**Commit:** não criado  

## 1. Causa exata

O erro não era causado por uma declaração ausente no projeto:

```text
server/app.ts:3:18 - error TS2307: Cannot find module 'cors'
```

O diagnóstico mostrou:

- `server/app.ts` importa `cors` como default:

  ```typescript
  import cors from "cors";
  ```

- `package.json` já declarava `cors` como dependência;
- `package-lock.json` já continha `cors@2.8.6`;
- `node_modules/cors` estava ausente;
- `npm ls cors --depth=0` retornava uma árvore vazia.

Portanto, o bloqueio estava somente na instalação incompleta do ambiente, não
em uma inconsistência de versão entre `package.json` e `package-lock.json`.

## 2. Estado anterior de `package.json`

O projeto já tinha:

```json
"cors": "^2.8.6"
```

Nenhuma alteração foi feita em `package.json`.

## 3. Estado anterior de `package-lock.json`

O lockfile já tinha:

```json
"cors": "^2.8.6"
```

e o pacote travado como:

```json
"node_modules/cors": {
  "version": "2.8.6",
  "resolved": "http://package-firewall.replit.local/npm/cors/-/cors-2.8.6.tgz",
  "integrity": "sha512-tJtZBBHA6vjIAaF6EnIaq6laBBP9aq/Y3ouVJjEfoHbRBcHBAHYcMh/w8LDrk2PvIMMq8gmopa5D4V8RmbrxGw=="
}
```

Nenhuma alteração manual ou automática foi feita em `package-lock.json`.

## 4. Correção aplicada

Foi restaurado somente o pacote ausente no ambiente com:

```bash
npm install --no-save --package-lock=false --ignore-scripts cors@2.8.6
```

Essa instalação:

- não alterou `package.json`;
- não alterou `package-lock.json`;
- não atualizou outras versões declaradas;
- não executou scripts de instalação;
- não executou `npm update`;
- não executou `npm audit fix`.

O `node_modules` foi recomposto pelo npm como parte da restauração do ambiente,
mas não há alteração rastreada no projeto.

## 5. Versão final do `cors`

```text
cors@2.8.6
```

Verificação:

```text
rest-express@1.0.0
└── cors@2.8.6
```

Não há duplicação na árvore de dependências de nível superior.

## 6. Outras dependências alteradas

Nenhuma dependência declarada foi alterada.

O npm exibiu avisos já separados do objetivo desta etapa:

- `libxmljs2@0.37.0` requer Node `>=22`, enquanto o ambiente usa Node `20.20.0`;
- `prebuild-install` está deprecated;
- `recharts` possui aviso de manutenção;
- foram reportadas 12 vulnerabilidades pelo npm.

Esses avisos não foram corrigidos nesta etapa. Não foi executado
`npm audit fix` nem `npm audit fix --force`.

## 7. Resultado de `npm run check`

Passou:

```text
> rest-express@1.0.0 check
> tsc
```

O erro de resolução de `cors` foi eliminado.

## 8. Resultado de `npm test`

Passou integralmente:

```text
Testes: 344
Passaram: 344
Falharam: 0
Cancelados: 0
Ignorados: 0
```

Os testes de deadline da Etapa 27 permaneceram inalterados e continuam
passando.

## 9. Resultado de `npm run build`

Passou no frontend e no servidor:

```text
✓ built in 20.50s
...
⚡ Done in 428ms
```

Permaneceram somente warnings não bloqueantes:

- imports dinâmicos e estáticos de `xlsx`, `jspdf`, `jspdf-autotable` e
  `leaflet`;
- chunks maiores que 500 kB;
- uso de `import.meta` no bundle CommonJS do validador NF-e.

## 10. Resultado de `npm ls cors`

Passou e confirmou a versão esperada:

```text
rest-express@1.0.0
└── cors@2.8.6
```

## 11. Workflow

O workflow `Start application` foi reiniciado após a restauração e está
executando:

```text
serving on port 5000
[APP_READY] {
  port: 5000,
  env: 'development',
  db: 'supabase'
}
```

O banco Supabase foi conectado durante o boot porque a configuração ambiental
já estava disponível. Não foi solicitada nem exibida nenhuma secret.

O startup executou somente as verificações automáticas já existentes da
aplicação. Não foi executada migration manual nem alteração manual de schema ou
dados nesta etapa.

Os logs também registraram avisos preexistentes fora do escopo:

- warmup do binding nativo `libxmljs2` do validador NF-e;
- backup stale;
- push notifications desabilitado por VAPID não configurado.

Nenhum desses avisos bloqueou o boot.

## 12. Áreas não alteradas

Não foram alterados:

- banco;
- schema;
- migrations;
- dados;
- NF-e/fiscal;
- financeiro;
- inventory;
- logistics;
- deliveries;
- GPS/Android;
- tenant context;
- RBAC;
- autenticação;
- testes de deadline;
- `docs/security/ETAPA_26_AUDITORIA_FINAL.md`;
- `docs/security/ETAPA_27_TIMEZONE_AUDIT.md`.

## 13. Estado Git

Após a correção e as validações:

```text
?? attached_assets/Pasted-ETAPA-28-CORRE-O-DO-BLOQUEIO-DE-DEPEND-NCIA-cors-Objeti_1789041273512.txt
```

O relatório desta etapa será o único novo arquivo criado pelo agente. Não há
diff rastreado em `package.json`, `package-lock.json` ou código da aplicação.

Verificações:

```text
git diff --stat
```

Sem alterações rastreadas.

```text
git diff --check
```

Passou sem erros.

## 14. Conclusão

O bloqueio foi resolvido de forma cirúrgica: `cors@2.8.6` já estava declarado e
travado corretamente, mas faltava em `node_modules`. A dependência foi
restaurada sem modificar versões, package manifest ou lockfile.

Com a correção:

- `npm run check` passa;
- `npm test` passa com 344/344;
- `npm run build` passa;
- `npm ls cors` confirma `cors@2.8.6`;
- o workflow inicia e fica pronto na porta 5000;
- `git diff --check` passa.