# VivaFrutaz Tracker Android

Aplicativo Android separado, escrito em Kotlin, para manter o rastreamento GPS dos motoristas sem transformar o ERP/PWA em aplicativo móvel.

## Estado atual

A base do MVP está implementada:

- painel operacional nativo com rota do dia via `/api/driver/route-today`;
- confirmação de entrega via `/api/deliveries/:id/checklist`;
- registro de ocorrência/status via `/api/deliveries/:id/stop-status`;
- login pelo `POST /api/driver/auth/login`, usando uma sessão própria para o
  Tracker e aceitando apenas contas `DRIVER`, `MOTORISTA` ou `LOGISTICS`;
- cookie `sessionId` persistido com armazenamento criptografado do Android;
- `X-Device-Id` persistente e enviado nas chamadas;
- validação por `GET /api/auth/me`;
- `Foreground Service` com `FusedLocationProviderClient`;
- envio para o endpoint existente `POST /api/driver/gps`;
- fila Room limitada a 200 posições;
- deduplicação por impressão do payload;
- reenvio com backoff quando a rede volta;
- retomada após reinicialização pelo `BOOT_COMPLETED`;
- estado persistido e compartilhado entre o serviço e a tela, com GPS, rede,
  última captura, último envio e tamanho da fila;
- painel que mostra `GPS ATIVO`, `SEM SINAL / GPS INDISPONÍVEL`,
  `SEM INTERNET` ou `ERRO` em tempo real enquanto a Activity está aberta;
- nenhuma ação comum no app para desligar o rastreamento;
- nenhuma senha, chave administrativa ou token escrito no código.

> **Atenção:** o APK versionado em `releases/vivafrutaz-tracker-debug.apk` é da
> versão 0.1.0, anterior ao envio obrigatório de `capturedAt`, e não deve ser
> distribuído. Gere e teste a versão 0.2.0 a partir deste código antes de
> atualizar os aparelhos.

Os contratos de jornada, quilometragem, abastecimento, assinatura e fotos não
estão publicados no backend deste checkout. A lacuna e o contrato recomendado
estão registrados em `docs/DRIVER-OPERATIONS.md`; o APK não inventa endpoints
ou payloads para esses fluxos.

## Sessão durante o turno

O login do Tracker cria uma sessão específica com validade longa de 30 dias.
Cada envio de GPS renova a validade no servidor, permitindo que o APK permaneça
conectado durante turnos de 24 horas ou mais sem pedir a senha novamente.
Essa sessão continua revogável pelo servidor por logout, alteração de senha,
`tokenVersion` ou validação do dispositivo. Portanto, o comportamento é de
conexão contínua enquanto o APK estiver ativo, e não de credencial permanente
impossível de revogar.

## Contrato enviado

O app preserva o payload atual:

```json
{
  "latitude": -23.55052,
  "longitude": -46.6333,
  "accuracy": 12.5,
  "speed": 8.2,
  "heading": 180,
  "capturedAt": 1791567600000
}
```

`capturedAt` é um número inteiro de milissegundos desde o Unix epoch, obtido da
captura Android (`Location.time`). A fila Room persiste e reenvia o mesmo valor;
o horário do reenvio nunca substitui o original.

O `driverId` não é enviado. O backend resolve o motorista pela sessão autenticada, como a PWA atual.

## Build no Android Studio

O workspace atual não possui Java, Android SDK ou Gradle disponíveis localmente. Para compilar:

1. Abra `vivafrutaz-tracker-android/` no Android Studio.
2. Configure um SDK Android compatível com `compileSdk 35`.
3. Copie `local.properties.example` para `local.properties`.
4. Defina `TRACKER_BASE_URL` nesse `local.properties` ou como propriedade Gradle,
   usando a origem HTTPS de um deployment ativo do backend Node/Express ou de um
   gateway que encaminhe `/api/*`. Não use `localhost`, uma URL `.replit.dev`
   ou um deployment inativo.
5. Execute:

No Android Studio, execute a tarefa `app > Tasks > build > assembleDebug` no painel Gradle.

Se o projeto tiver um Gradle Wrapper configurado no ambiente de desenvolvimento, o equivalente é:

```bash
./gradlew :app:assembleDebug
```

O `local.properties` não deve ser versionado.

## Permissões e aparelhos antigos

O serviço solicita localização precisa/aproximada e notificação quando necessário. O Android e o fabricante continuam podendo limitar a execução em segundo plano; o app não tenta burlar essas proteções.

Teste prioritariamente em:

- Motorola Moto G6;
- Samsung Galaxy J6;
- Samsung Galaxy J7.

Em aparelhos com gerenciamento agressivo de bateria, o usuário/administrador pode precisar permitir a execução do app em segundo plano nas configurações do sistema.

## Política de autenticação

A sessão comum do ERP continua com a política própria do ERP. O Tracker usa a
sessão longa específica descrita acima e renova sua validade a cada envio de
GPS; o APK persiste somente o cookie protegido, não a senha.
