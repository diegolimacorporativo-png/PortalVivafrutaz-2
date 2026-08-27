# VivaFrutaz Tracker Android

Aplicativo Android separado, escrito em Kotlin, para manter o rastreamento GPS dos motoristas sem transformar o ERP/PWA em aplicativo móvel.

## Estado atual

A base do MVP está implementada:

- login pelo `POST /api/auth/login` com `type: "admin"`;
- cookie `sessionId` persistido com armazenamento criptografado do Android;
- `X-Device-Id` persistente e enviado nas chamadas;
- validação por `GET /api/auth/me`;
- `Foreground Service` com `FusedLocationProviderClient`;
- envio para o endpoint existente `POST /api/driver/gps`;
- fila Room limitada a 200 posições;
- deduplicação por impressão do payload;
- reenvio com backoff quando a rede volta;
- retomada após reinicialização pelo `BOOT_COMPLETED`;
- nenhuma ação comum no app para desligar o rastreamento;
- nenhuma senha, chave administrativa ou token escrito no código.

## Contrato enviado

O app preserva o payload atual:

```json
{
  "latitude": -23.55052,
  "longitude": -46.6333,
  "accuracy": 12.5,
  "speed": 8.2,
  "heading": 180
}
```

O `driverId` não é enviado. O backend resolve o motorista pela sessão autenticada, como a PWA atual.

## Build no Android Studio

O workspace atual não possui Java, Android SDK ou Gradle disponíveis localmente. Para compilar:

1. Abra `vivafrutaz-tracker-android/` no Android Studio.
2. Configure um SDK Android compatível com `compileSdk 35`.
3. Copie `local.properties.example` para `local.properties`.
4. Defina `TRACKER_BASE_URL` nesse `local.properties` ou como propriedade Gradle.
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

## Limite de autenticação que exige decisão de backend

A sessão atual do ERP possui validade aproximada de 24 horas e não oferece refresh token. O app já persiste a sessão, revalida em `/api/auth/me` e não armazena a senha. Porém, renovação silenciosa depois que o servidor expira a sessão não pode ser implementada com segurança apenas no APK.

Por isso, nenhuma alteração foi feita no backend. A proposta isolada para o Tracker está em `docs/TRACKER-AUTH-PROPOSAL.md` e precisa de aprovação antes de qualquer mudança de autenticação.