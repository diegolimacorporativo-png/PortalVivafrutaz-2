# Módulos operacionais do motorista

## Implementado

| Fluxo | Endpoint | Backend | Android |
|---|---|---|---|
| Rota do dia | `GET /api/driver/route-today` | existente | lista de paradas |
| Checklist | `GET/POST /api/deliveries/:id/checklist` | existente | confirmação e observação |
| Status de parada | `POST /api/deliveries/:id/stop-status` | existente | ocorrência |
| Jornada | `GET /api/driver/journey/today` | novo | iniciar/encerrar |
| Odômetro | `GET/POST /api/driver/odometer/today`, `/api/driver/odometer` | novo | lançamento no início/fim |
| Abastecimento | `GET/POST /api/driver/fuel` | novo | litros, valor, tipo e posto |
| Prova digital | `POST /api/deliveries/:id/proof` | novo | assinatura manuscrita e foto |
| GPS | `POST /api/driver/gps` | existente | foreground service + fila |

## Segurança e resiliência

- Todos os endpoints usam `requireAuthCore` e o motorista é resolvido pela sessão.
- Entregas passam por `getAuthorizedDelivery`, preservando tenant e vínculo de rota.
- Operações de escrita exigem `Idempotency-Key` (ou `idempotencyKey` no corpo).
- Jornada ativa única por motorista, com validação de odômetro final maior ou igual ao inicial.
- Coordenadas e valores numéricos são validados no backend.
- Limites de tamanho são aplicados a comprovante, assinatura e fotos.
- O APK usa cookie protegido, `X-Device-Id` e não armazena senha.
- A captura de assinatura usa canvas nativo e a foto usa seletor de imagem do Android.

## Banco

A migration `migrations/20260930_driver_operations.sql` cria:

- `driver_journeys`;
- `driver_odometer_entries`;
- `driver_fuel_entries`;
- `delivery_proofs`.

Aplicar a migration no ambiente do backend antes de usar os novos endpoints. O arquivo é aditivo e possui chaves únicas para idempotência.

## Build do APK

```bash
cd vivafrutaz-tracker-android
./gradlew :app:assembleDebug
```

O artefato é gerado em `app/build/outputs/apk/debug/app-debug.apk`.
