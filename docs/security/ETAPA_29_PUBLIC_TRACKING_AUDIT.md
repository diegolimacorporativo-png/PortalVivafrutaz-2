# ETAPA 29 — Auditoria e hardening do rastreamento público

**Data da análise:** 10 de setembro de 2026
**Escopo:** auditoria dos endpoints públicos de rastreamento, sem alteração de código de aplicação, banco, schema, dados, frontend, testes ou configurações.
**Fonte da etapa anterior:** `docs/security/ETAPA_26_AUDITORIA_FINAL.md`

## 1. Resumo executivo

Os dois endpoints analisados são públicos por desenho funcional, mas continuam
aceitando identificadores numéricos internos diretamente:

```text
GET /api/track/:deliveryId
GET /api/logistics/track/:routeId
```

O primeiro retorna o estado de uma entrega e a posição GPS mais recente do
motorista. O segundo agrega uma rota completa, seus stops, deliveries,
empresas, motorista e posição GPS.

A análise confirma risco prático de enumeração e divulgação indevida:

| Endpoint | Classificação | Risco real |
|---|---|---|
| `/api/track/:deliveryId` | **VERMELHO** | Médio, com exposição de GPS e metadados operacionais por ID enumerável |
| `/api/logistics/track/:routeId` | **VERMELHO** | Médio residual, com impacto de privacidade e operação alto por payload agregado |

Não foi implementada correção. O rastreamento tem finalidade legítima, mas a
forma atual não comprova que o visitante recebeu um link válido nem limita o
acesso ao recurso compartilhado.

## 2. Limites e método

Foram realizados:

- inspeção do registro das rotas;
- rastreamento de cada parâmetro até controller e storage/queries;
- classificação dos campos retornados;
- inspeção das telas e consumidores frontend;
- inspeção das validações de formato e respostas para recursos ausentes;
- verificação do fluxo de geração de links, QR Codes e tokens;
- verificação da ordem de montagem dos routers e dos limitadores;
- revisão do estado Git e da integridade do diff.

Não foram realizados:

- brute force ou enumeração de IDs;
- varredura de dados reais;
- escrita ou alteração no banco;
- chamadas com dados reais de terceiros;
- mudança em código de produção;
- criação de migration ou alteração de schema.

## 3. Mapeamento dos endpoints

### 3.1 `GET /api/track/:deliveryId`

| Camada | Localização | Comportamento |
|---|---|---|
| Route | `server/routes/logistics.routes.ts` | Handler público, sem `requireAuth` |
| Controller | Mesmo arquivo, handler em `app.get('/api/track/:deliveryId', ...)` | Converte o parâmetro com `Number()` e consulta a entrega |
| Delivery lookup | `server/services/storage.ts` → `getDelivery(id)` | `SELECT deliveries WHERE deliveries.id = id` |
| Rota/data | `storage.getDeliveries({ date: delivery.scheduledDate })` | Lê deliveries da data e filtra em memória por `routeId` |
| GPS | `storage.getLatestGpsPosition(delivery.driverId)` | Último registro por motorista, ordenado por `recordedAt DESC` |
| Tabelas alcançadas | `deliveries`, `driver_gps_positions` | A consulta de deliveries é usada também para cálculo de posição |

O lookup público usa `getDelivery(id)`, e não
`getDeliveryForCompany(id, companyId)`. Isso é coerente com a intenção atual de
um link público, mas deixa o ID interno como único fator de autorização.

### 3.2 `GET /api/logistics/track/:routeId`

| Camada | Localização | Comportamento |
|---|---|---|
| Route | `server/modules/logistics/logistics.routes.ts` | `router.get('/track/:routeId', logisticsController.routeTracking)` |
| Mount | `server/modules/logistics/index.ts` e `server/modules/index.ts` | `/api/logistics/track/:routeId`; o mesmo router também é montado como `/api/v1/logistics/track/:routeId` |
| Controller | `server/modules/logistics/logistics.controller.ts` → `routeTracking` | Handler público com escopo interno opcional quando existe sessão |
| Route query | SQL no controller | `logistics_routes` + `logistics_drivers`, filtrado somente por `lr.id` |
| Stops query | SQL no controller | `route_stops`, filtrado somente por `route_id` |
| Deliveries query | SQL no controller | `deliveries LEFT JOIN companies`, filtrado somente por `d.route_id` |
| GPS query | SQL no controller | Último registro em `driver_gps_positions` pelo `driver_id` |
| Cálculo adicional | `calculateETA` e `summariseETA` | ETA e distância são calculados em memória |

O endpoint valida apenas que `routeId` seja numérico, finito e maior que zero.
Não exige token, sessão ou prova de que o visitante possui o link da rota.

## 4. Payload atual de `/api/track/:deliveryId`

A resposta é um objeto direto, sem envelope:

```json
{
  "id": "delivery.id",
  "status": "delivery.status",
  "companyId": "delivery.companyId",
  "scheduledDate": "delivery.scheduledDate",
  "deliveredAt": "delivery.deliveredAt",
  "routePosition": "delivery.routePosition",
  "totalStopsInRoute": "routeDeliveries.length",
  "stopsAhead": "computed",
  "etaMinutes": "computed",
  "etaTime": "computed ISO timestamp",
  "driverPosition": {
    "lat": "gps.latitude",
    "lng": "gps.longitude",
    "updatedAt": "gps.recordedAt"
  }
}
```

`driverPosition` é `null` quando não existe posição recente.

### Classificação dos campos

| Campo | Classificação | Observação |
|---|---|---|
| `status` | A — essencial | Necessário para a tela pública mostrar o estado |
| `scheduledDate` | A/B | Pode ser útil ao cliente, mas é metadado operacional |
| `deliveredAt` | A/B | Útil para confirmar conclusão; pode ser reduzido ao necessário |
| `etaMinutes`, `etaTime` | B — útil, redutível | A tela usa a previsão, mas a precisão e a origem podem ser limitadas |
| `routePosition`, `totalStopsInRoute`, `stopsAhead` | B/C | Mostram a posição da entrega na operação inteira |
| `driverPosition.lat/lng` | C/D | GPS exato do motorista; não é mínimo necessário para confirmar status |
| `driverPosition.updatedAt` | C | Ajuda a inferir atividade em tempo real |
| `id` | C — identificador interno | É exibido na tela e também é o segredo atual do link |
| `companyId` | D/E — contexto interno | Não é necessário para o cliente e permite associar a entrega a uma empresa |

Não são retornados nome, telefone, endereço ou `orderId` neste endpoint.
Entretanto, a ausência desses campos não elimina o risco de localização
operacional e confirmação de atividade de outro tenant.

## 5. Payload atual de `/api/logistics/track/:routeId`

### 5.1 Payload para visitante anônimo ou usuário não interno

O objeto de rota contém:

```text
route:
  id, name, status, deliveryDate, driverId, vehicleId

driver:
  id, name, phone

stops:
  id, ordem, companyId, cep, endereco, numero, cidade, estado,
  latitude, longitude, janelaInicio, janelaFim, tempoEstimadoMin

deliveries:
  id, orderId, companyId, companyName, status, routePosition,
  latitude, longitude, scheduledDate, deliveredAt

driverPosition:
  lat, lng, accuracy, speed, heading, updatedAt

viewerScope: "public"
```

Para o escopo público, são removidos apenas os campos de ETA detalhado:
`distanceKm`, `legMinutes`, `etaMinutes` e `etaTime` dos stops, além de
`etaMinutes` e `etaTime` das deliveries. `driverPosition` permanece no
payload público.

### 5.2 Payload para escopo interno

Quando a sessão pertence a uma role de
`LOGISTICS_AUTH_ROLES`, o endpoint retorna os mesmos dados com os detalhes
operacionais de ETA e adiciona:

```text
eta:
  totalDistanceKm, totalMinutes, totalEtaTime, avgSpeedKmh
```

Um usuário com role `DRIVER` passa por uma verificação adicional: só pode
acessar a rota associada ao próprio motorista. Essa proteção é aplicável à
sessão autenticada do motorista; ela não existe para visitantes anônimos.

### Classificação dos campos públicos

| Campo ou grupo | Classificação | Motivo |
|---|---|---|
| `route.status`, `route.deliveryDate` | A/B | Podem ser úteis ao cliente, mas podem ser apresentados de forma mínima |
| `route.name` | B/C | Nome operacional da rota não é necessário para identificar o estado de uma entrega |
| `route.id`, `driverId`, `vehicleId` | C/D | IDs internos e vínculo operacional |
| `driver.name` | C | Identifica o motorista |
| `driver.phone` | D — sensível | Telefone pessoal/operacional exposto sem autenticação |
| `stops.endereco`, `numero`, `cep`, `cidade`, `estado` | C/D | Endereços de todas as paradas, não apenas do cliente solicitante |
| `stops.latitude`, `longitude` | D — sensível | Localização exata de todas as paradas |
| `stops.companyId` | E — outro contexto | Vincula cada parada a um tenant/cliente interno |
| `stops.janelaInicio`, `janelaFim` | C | Horários operacionais da rota |
| `deliveries.id`, `orderId` | C/D | IDs internos e referência direta a pedido |
| `deliveries.companyId`, `companyName` | D/E | Identidade e relacionamento comercial de outros clientes |
| `deliveries.status`, `routePosition` | C | Estado e sequência da operação |
| `deliveries.latitude`, `longitude` | D | Coordenadas exatas das entregas |
| `deliveries.scheduledDate`, `deliveredAt` | C | Histórico e agenda operacional |
| `driverPosition.lat/lng` | D — sensível | Localização exata em tempo real |
| `driverPosition.accuracy/speed/heading` | C/D | Telemetria operacional detalhada |
| `viewerScope` | B/C | Revela que a resposta foi tratada como pública ou interna |

Esse payload não é somente um status de entrega: ele descreve a operação de
uma rota inteira.

## 6. Enumeração e diferenças de resposta

### `/api/track/:deliveryId`

- O parâmetro é convertido diretamente com `Number(req.params.deliveryId)`.
- A consulta é feita por igualdade em `deliveries.id`.
- Um ID existente leva a resposta `200` com dados da entrega.
- Um ID inexistente leva a `404` com `Entrega não encontrada`.
- Não há token opaco, validade, assinatura ou vínculo verificável com o link.
- A análise não executou sequência de IDs nem consultou dados reais de terceiros.

Mesmo sem brute force, a diferença `200`/`404` comprova uma oracle de existência
para IDs conhecidos ou adivinhados.

### `/api/logistics/track/:routeId`

- O parâmetro é numérico e deve ser finito e maior que zero.
- Valor não numérico, zero ou negativo leva a `400` com `Invalid routeId`.
- Rota numérica inexistente leva a `404` com `Route not found`.
- Rota existente leva a `200` com os dados agregados.
- Não há token opaco, validade, assinatura ou vínculo verificável com o link.

A diferença `400`/`404`/`200` facilita a confirmação de formato e existência de
rotas. O espaço de IDs é numérico e global na tabela de rotas.

### Controles de volume observados

O `apiLimiter` cobre orders/import, e o `publicLimiter` cobre health; nenhum
deles é montado especificamente sobre os endpoints de rastreamento. O
`simpleRateLimit` é instalado no início do registro das rotas legadas, portanto
alcança `/api/track/:deliveryId`. Já o router modular de logística é montado
antes de `registerRoutes`, e `/api/logistics/track/:routeId` não recebe esse
middleware legado pelo caminho observado.

Isso não cria a vulnerabilidade de autorização, mas aumenta a diferença entre
as superfícies de contenção de enumeração.

## 7. Fluxo de negócio e consumidores

### Rastreamento de entrega

`client/src/App.tsx` registra a tela sem `ProtectedRoute`:

```text
/track/:id
```

`client/src/pages/track.tsx`:

- lê `id` da URL;
- chama `GET /api/track/:id`;
- envia credenciais de sessão se existirem, mas não exige sessão;
- atualiza automaticamente a cada 60 segundos;
- mostra status, código numérico, data, ETA e link para a posição no Google Maps
  quando `driverPosition` existe.

### Rastreamento de rota/mapa

`client/src/App.tsx` também registra sem `ProtectedRoute`:

```text
/driver-map/:routeId
```

`client/src/pages/driver-map.tsx`:

- lê `routeId` da URL;
- chama `GET /api/logistics/track/:routeId`;
- atualiza automaticamente a cada 5 segundos;
- renderiza stops, sequência, endereço/cidade, empresas, status, rota no mapa,
  posição do motorista e ETA quando presente.

O próprio frontend da tela de mapa é público. A proteção de motorista existente
fica no backend e só é acionada quando existe uma sessão com role `DRIVER`.

### Links, QR Codes e tokens

A busca por geração de link de rastreamento, token, `share link`, QR Code
relacionado a `/track` ou `driver-map` não encontrou um fluxo de emissão.

O QR Code em `client/src/lib/danfe-generator.ts` aponta para
`/admin/orders?order=<id>` e é um QR Code administrativo de pedido; não é um
link de rastreamento público.

Conclusão do fluxo observado: as telas consumidoras dependem diretamente de IDs
numéricos colocados na URL. Não há, no código revisado, uma origem de token
opaco que possa ser preservada por simples troca do parâmetro.

## 8. Decisão de segurança

### 8.1 `/api/track/:deliveryId` — VERDE, AMARELO ou VERMELHO?

**Classificação: VERMELHO.**

O endpoint possui finalidade legítima e retorna menos dados que o endpoint de
rota, mas o risco é prático porque:

1. o ID interno é o único segredo;
2. a resposta confirma se a entrega existe;
3. `companyId` e posição na rota são expostos;
4. GPS exato e horário de atualização são expostos sem sessão;
5. a consulta não tem qualquer token, expiração ou autorização contextual.

### 8.2 `/api/logistics/track/:routeId` — VERDE, AMARELO ou VERMELHO?

**Classificação: VERMELHO.**

O endpoint é mais grave em conteúdo, pois um único ID dá acesso a uma coleção
de dados de uma rota:

1. motorista, telefone e IDs operacionais;
2. todos os stops e endereços;
3. todas as empresas/deliveries associadas;
4. `orderId` e coordenadas de entregas;
5. GPS e telemetria do motorista;
6. sequência e status da operação.

A remoção de alguns campos de ETA melhora apenas a exposição de planejamento;
não resolve a divulgação de identidade, localização e estrutura operacional.

## 9. Risco real

O risco não é um bypass de RBAC interno: os endpoints foram desenhados como
públicos. O problema é que o desenho público usa identificadores internos
enumeráveis e não separa adequadamente a resposta para o cliente da resposta
operacional interna.

O cenário plausível é:

1. um visitante recebe ou descobre um `deliveryId`/`routeId`;
2. consulta o recurso sem autenticação;
3. confirma existência pelo status HTTP;
4. obtém informações de localização e operação de um tenant ou cliente que não
   autorizou aquela consulta.

O impacto é maior no endpoint de rota. A severidade residual permanece
**Medium** em continuidade com a Etapa 26, mas o impacto de privacidade,
segurança operacional e exposição de terceiros é alto o suficiente para exigir
correção futura antes de considerar esses endpoints totalmente hardened.

## 10. Recomendação mínima para etapa posterior

Não implementar automaticamente nesta Etapa 29. A menor correção segura deve
ser desenhada em uma etapa específica, com validação do fluxo de negócio:

1. **Separar o contrato público do contrato interno.**
   - Endpoint interno autenticado mantém detalhes para administração e
     operação.
   - Endpoint público retorna somente estado, janela mínima e uma indicação
     não precisa de identidade de outros clientes.

2. **Substituir o ID numérico público por credencial de compartilhamento.**
   - Preferência inicial: token opaco assinado, com alta entropia e expiração,
     contendo apenas o recurso e o escopo autorizados.
   - Se for necessária revogação individual ou auditoria persistente, usar
     token aleatório persistido e revogável.

3. **Reduzir o DTO público.**
   - Remover `companyId`, `orderId`, IDs de deliveries/stops, telefone,
     nome do motorista, endereço completo, coordenadas exatas, velocidade,
     heading e demais dados de outras paradas.
   - Não incluir `driverPosition` exato no fluxo público sem uma justificativa
     explícita de negócio; se necessário, reduzir precisão e frescor.

4. **Adicionar limitação específica ao público.**
   - Aplicar rate limit próprio aos endpoints públicos/tokenizados.
   - Manter respostas e mensagens que não revelem mais detalhes que o
     necessário para o fluxo.

5. **Atualizar a emissão e o consumo do link.**
   - O backend precisará gerar o link/token.
   - O frontend `/track/:id` e `/driver-map/:routeId` precisará deixar de
     depender de IDs numéricos.
   - O fluxo de QR/link enviado ao cliente deverá ser localizado e validado
     antes da troca.

## 11. Impacto e necessidade de migration

### Opção sem migration

Um token assinado e expirável pode ser implementado sem nova tabela ou coluna.
Ainda exige:

- segredo de assinatura gerenciado fora do código;
- alteração do backend para validar assinatura, recurso e expiração;
- alteração do frontend e da emissão dos links;
- decisão sobre como invalidar um link antes da expiração.

Essa opção não oferece revogação individual simples sem adicionar estado.

### Opção com migration

Um token aleatório armazenado para cada entrega/rota permite expiração,
revogação, rotação e auditoria. Essa opção exige:

- migration ou nova tabela/coluna;
- backfill ou estratégia para recursos antigos;
- alteração da criação e distribuição dos links;
- alteração dos consumidores frontend.

**Decisão desta etapa:** nenhuma das opções foi implementada. Não houve
migration, alteração de schema ou alteração de dados.

## 12. Compatibilidade

Uma alteração futura de ID numérico para token afeta diretamente:

- `/track/:id`;
- `/driver-map/:routeId`;
- qualquer link externo já compartilhado;
- eventual QR Code ou mensagem gerada fora dos arquivos encontrados;
- atualização automática das posições;
- mapas e status de entrega.

Por isso, não é seguro remover campos ou trocar o identificador somente no
controller. A alteração deve incluir emissão, persistência/assinatura,
expiração, frontend e período de compatibilidade para links já distribuídos.

## 13. Testes e validação

### Validação estática realizada

- As duas rotas foram localizadas no código atual.
- Controllers, storage e queries foram rastreados.
- Consumidores frontend foram localizados.
- O fluxo de QR Code foi conferido e não é de rastreamento público.
- Nenhum token de tracking foi encontrado.
- Não foi executada enumeração de IDs.

### Validação HTTP

Não foi possível iniciar o workflow nesta etapa. O processo falhou antes do
boot da aplicação com:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'cors'
imported from /home/runner/workspace/server/app.ts
```

Como não houve alteração de aplicação e o problema é uma dependência ausente
no ambiente, não foram instaladas dependências nem modificados lockfiles.
Também não foram feitas chamadas HTTP contra dados reais.

### Testes de projeto

`npm run check`, `npm test` e `npm run build` não foram executados como parte
desta auditoria: não houve mudança de código para validar e o workflow não
consegue iniciar devido à dependência ausente. A falha de boot deve ser tratada
em uma etapa de recuperação do ambiente, fora do escopo desta auditoria.

## 14. Banco, schema e dados

| Item | Estado |
|---|---|
| Banco consultado para esta auditoria | Não |
| Dados reais acessados | Não |
| Dados escritos/alterados | Não |
| Schema alterado | Não |
| Migration criada | Não |
| NF-e, financeiro, inventory ou deliveries internos alterados | Não |

## 15. Estado Git

O arquivo anexado pelo usuário permanece não alterado. Nenhum commit foi
criado. O único arquivo de projeto criado por esta etapa é este relatório:

```text
docs/security/ETAPA_29_PUBLIC_TRACKING_AUDIT.md
```

O arquivo anexado em `attached_assets/` aparece como não rastreado pelo Git
porque foi fornecido durante a sessão; ele não foi editado.

## 16. Conclusão

Os dois endpoints são legítimos para o produto, mas não devem ser considerados
seguros como superfícies públicas baseadas apenas em IDs numéricos.

- `/api/track/:deliveryId`: **VERMELHO**, com exposição de GPS e metadados
  operacionais.
- `/api/logistics/track/:routeId`: **VERMELHO**, com exposição agregada de
  rota, stops, empresas, entregas, motorista, telefone e GPS.
- O risco residual é explorável por análise estática e por consulta de IDs
  conhecidos ou enumeráveis.
- A menor correção futura é separar DTO público de DTO interno e trocar o
  identificador público por token opaco expirável.
- Nenhuma mudança de código, banco, schema ou dados foi aplicada nesta etapa.