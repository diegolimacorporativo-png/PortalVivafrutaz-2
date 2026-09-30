# Módulos operacionais do motorista

## Implementado no APK

O `VivaFrutaz Tracker` agora mantém o rastreamento GPS existente e também consome os contratos operacionais já publicados pelo backend:

| Fluxo | Método | Endpoint | Implementação Android |
|---|---:|---|---|
| Rota do dia | GET | `/api/driver/route-today` | Lista ordenada de paradas, endereço, janela e status |
| Checklist | GET | `/api/deliveries/:id/checklist` | Cliente preparado para leitura |
| Confirmar entrega | POST | `/api/deliveries/:id/checklist` | Observação opcional e confirmação |
| Status da parada | POST | `/api/deliveries/:id/stop-status` | Registro de ocorrência (`problema`) |
| Rastreamento | POST | `/api/driver/gps` | Serviço foreground, fila Room e reenvio existentes |

A autenticação continua usando a sessão criada por `/api/driver/auth/login`, cookie protegido pelo Android Keystore/EncryptedSharedPreferences e `X-Device-Id`. O APK não envia `driverId` para o GPS: o backend resolve o motorista pela sessão.

## Lacunas verificadas no backend atual

Não existem, neste checkout, rotas HTTP dedicadas ou tabelas para:

- iniciar/encerrar jornada;
- lançamento de quilometragem/odômetro;
- abastecimento;
- upload de assinatura do recebedor;
- upload de fotos de comprovação.

A tabela `delivery_checklists` possui apenas os campos `assinaturaUrl` e `fotoUrl`, mas o endpoint POST atual sempre grava esses campos como `null` e não oferece upload. Por segurança, o APK não inventa endpoints ou payloads para esses fluxos.

## Próximo contrato recomendado para fechar o escopo

Antes de implementar a segunda etapa no APK, o backend deve publicar e documentar, no mínimo:

- `POST /api/driver/journey/start`
- `POST /api/driver/journey/end`
- `POST /api/driver/odometer`
- `POST /api/driver/fuel`
- `POST /api/deliveries/:id/proof` com multipart para `signature` e `photos[]`

Todos devem usar `requireAuthCore`, resolver o motorista pela sessão, validar tenant/entrega e aplicar limite de tamanho/tipo aos arquivos. Depois que esses contratos existirem, eles podem ser adicionados ao mesmo `TrackerApi` sem alterar o serviço GPS.

## Build local

O sandbox desta execução não possui Android SDK. No Android Studio:

```bash
cp local.properties.example local.properties
# defina sdk.dir e TRACKER_BASE_URL conforme o ambiente
./gradlew :app:assembleDebug
```
