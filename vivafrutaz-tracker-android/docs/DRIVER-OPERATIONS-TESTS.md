# Testes dos módulos operacionais do motorista

Data: 2026-09-30

## Resultado resumido

| Área | Resultado |
|---|---|
| Compilação Android | Aprovada (`BUILD SUCCESSFUL`) |
| Compilação do backend | Aprovada via `pnpm build` |
| Verificação de espaço em branco no Git | Aprovada (`git diff --check`) |
| Integridade do APK | Aprovada; checksum local e download público coincidem |
| Idempotência em banco real | Implementada no código, pendente de execução contra banco implantado |
| Upload real de prova | Implementado no código, pendente de execução contra backend com migration aplicada |

## Validações realizadas

### 1. Idempotência no backend

Foi feita revisão dos quatro fluxos de escrita e todos exigem uma chave única:

- `POST /api/driver/journey/start`
- `POST /api/driver/journey/end`
- `POST /api/driver/odometer`
- `POST /api/driver/fuel`
- `POST /api/deliveries/:id/proof`

O comportamento implementado é:

1. Ler `Idempotency-Key` do header ou `idempotencyKey` do JSON.
2. Rejeitar a requisição sem chave com HTTP `400`.
3. Consultar o registro existente antes do `INSERT`.
4. Devolver o registro existente em uma repetição, sem criar nova linha.
5. Reforçar a regra com coluna `UNIQUE` no banco.

A migration cria as constraints únicas em:

- `driver_journeys.idempotency_key`;
- `driver_odometer_entries.idempotency_key`;
- `driver_fuel_entries.idempotency_key`;
- `delivery_proofs.idempotency_key`.

No APK, cada operação gera uma chave UUID nova e reutilizável em caso de reenvio offline.

### 2. Validação de provas de entrega

O endpoint implementado é:

```http
POST /api/deliveries/:id/proof
```

O backend valida:

- sessão autenticada;
- perfil operacional do usuário;
- vínculo do motorista com a entrega e tenant;
- presença de assinatura ou pelo menos uma foto;
- assinatura com no máximo 2 MB;
- até 3 fotos;
- cada foto com no máximo 6 MB;
- idempotência da operação;
- latitude e longitude quando enviadas.

O APK foi compilado contendo:

- canvas para assinatura manuscrita;
- exportação da assinatura para PNG Base64;
- seleção de imagem pelo Android;
- compressão/limite de tamanho antes do envio;
- envio da prova com `Idempotency-Key`.

### 3. Validações de build e integridade

Executados com sucesso:

```text
./gradlew :app:assembleDebug
BUILD SUCCESSFUL

pnpm build
✓ built in ...

 git diff --check
sem erros
```

O APK foi baixado novamente do CDN e o SHA-256 conferido contra o artefato local:

```text
ae8f9cbcb3912091b61db42787c8cc6a026cc64b8b705ef89ff51505de89232b
```

## Testes de integração ainda necessários

Não foi executado um teste HTTP contra um banco de produção neste ambiente. Para concluir a homologação, aplicar primeiro:

```text
migrations/20260930_driver_operations.sql
```

Depois executar os casos abaixo com uma sessão real de motorista.

### Caso A — repetição da mesma jornada

1. Enviar `POST /api/driver/journey/start` com `Idempotency-Key: teste-jornada-001`.
2. Reenviar o mesmo JSON e a mesma chave.
3. Esperado: a segunda chamada devolve o mesmo `id` e não cria outra jornada.

### Caso B — repetição do abastecimento

1. Enviar `POST /api/driver/fuel` com `Idempotency-Key: teste-combustivel-001`.
2. Reenviar a mesma requisição.
3. Esperado: um único registro em `driver_fuel_entries`.

### Caso C — repetição de assinatura e fotos

1. Enviar `POST /api/deliveries/:id/proof` com uma assinatura, uma foto e `Idempotency-Key: teste-prova-001`.
2. Reenviar exatamente a mesma requisição.
3. Esperado: o mesmo `id` de prova e nenhuma duplicação em `delivery_proofs`.

### Caso D — rejeições de segurança

Validar que o backend rejeita:

- chave de idempotência ausente;
- motorista tentando usar uma entrega de outra rota;
- assinatura e fotos ausentes;
- mais de 3 fotos;
- arquivo acima do limite;
- odômetro final menor que o inicial;
- segunda jornada ativa para o mesmo motorista.

## Conclusão

A idempotência está implementada e coberta por validação de código, constraints únicas e build. O envio de assinatura e fotos está implementado no APK e no endpoint. A confirmação definitiva de não duplicação e persistência requer uma execução de integração com a migration aplicada no banco do ambiente publicado.
