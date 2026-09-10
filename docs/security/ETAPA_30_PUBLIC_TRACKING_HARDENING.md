# Etapa 30 — Hardening do rastreamento público

Data: 2026-09-10  
Escopo: `/api/track/:token` e `/api/logistics/track/:token`

## Resultado

Os dois endpoints deixaram de aceitar acesso anônimo por ID numérico. O
visitante precisa apresentar um token de rastreamento público assinado,
expirável, opaco e vinculado ao tipo e ao recurso:

- `delivery` para a entrega;
- `route` para a rota;
- finalidade fixa `public_tracking`;
- expiração configurável por `PUBLIC_TRACKING_TOKEN_TTL_SECONDS`;
- nonce aleatório por emissão.

O TTL padrão é de 24 horas. Valores configurados ficam limitados entre 5
minutos e 30 dias. O token é cifrado com AES-256-GCM e autenticado com HMAC,
com chaves derivadas de `SESSION_SECRET` por separação de domínio. Nenhum
segredo é enviado ao cliente e nenhuma migration foi criada.

## Emissão

Foram adicionados endpoints autenticados para emissão:

- `POST /api/track/token` com `{ "deliveryId": number }`;
- `POST /api/logistics/track/token` com `{ "routeId": number }`.

As duas rotas só emitem o link depois de verificar a sessão e a visibilidade
do recurso. A resposta contém o token, o vencimento e o path relativo para o
link público.

## Validação e compatibilidade

- A assinatura e a cifra são verificadas antes de consultar o banco.
- Token de entrega não funciona no endpoint de rota, e vice-versa.
- Token adulterado, truncado, expirado ou ausente retorna `403` genérico.
- O endpoint modular ainda aceita ID numérico para sessões internas
  autenticadas, preservando o mapa operacional existente; esse caminho não é
  público e continua sujeito à validação de papel e ownership do motorista.
- Links numéricos anônimos não chegam à consulta de rota.
- Foi aplicado rate limit de 30 consultas por minuto por IP nos endpoints
  públicos de tracking.
- Os logs do rate limiter redigem o token e registram somente a rota
  parametrizada.

## DTOs públicos

Os DTOs públicos são construídos separadamente dos payloads internos. Eles não
incluem:

- IDs de entrega, rota, pedido, parada, empresa ou motorista;
- `companyId`, nome e telefone do motorista;
- endereço completo, número, CEP e janelas operacionais;
- velocidade, direção, acurácia ou distância da telemetria;
- ETA detalhado por parada.

Quando GPS é necessário para a experiência pública, latitude e longitude são
arredondadas para duas casas decimais. A resposta mantém apenas o status,
progresso agregado, data agendada, posição ordinal e uma posição aproximada
do veículo.

## Frontend

As páginas `/track/:token` e `/driver-map/:token` passaram a encaminhar o
token opaco, em vez de transformar o segmento da URL em ID numérico. A tela
pública não mostra códigos internos, nomes de empresas, endereços completos
ou dados pessoais do motorista.

## Verificação

Foi criado teste unitário para:

- token válido;
- token adulterado;
- token expirado;
- troca de tipo;
- alteração de recurso;
- ausência de token;
- DTOs sem campos internos e com coordenadas arredondadas.

O teste isolado da etapa passou com 7 casos. `npm run check` ficou bloqueado
somente pelo estado pré-existente do ambiente: `node_modules` não contém o
pacote `cors`, embora ele esteja declarado no `package.json`. A suíte completa
também encontra a validação prévia de boot sem `SUPABASE_DATABASE_URL`; nenhum
segredo foi exibido ou alterado.