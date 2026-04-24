# 🔍 TESTE DE VALIDAÇÃO DO AMBIENTE - ERP VIVAFRUTAZ + CLARA IA
# Execute no PowerShell: .\validate.ps1

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "🔍 VALIDAÇÃO DO AMBIENTE - ERP VIVAFRUTAZ" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Contadores
$PASS = 0
$FAIL = 0
$WARN = 0

# Função para verificar comando
function Check-Command {
    param($command)
    try {
        $null = Get-Command $command -ErrorAction Stop
        Write-Host "✅ $command instalado" -ForegroundColor Green
        $script:PASS++
    } catch {
        Write-Host "❌ $command NÃO instalado" -ForegroundColor Red
        $script:FAIL++
    }
}

# Função para verificar arquivo
function Check-File {
    param($path)
    if (Test-Path $path) {
        Write-Host "✅ Arquivo existe: $path" -ForegroundColor Green
        $script:PASS++
    } else {
        Write-Host "❌ Arquivo NÃO existe: $path" -ForegroundColor Red
        $script:FAIL++
    }
}

# Função para verificar diretório
function Check-Dir {
    param($path)
    if (Test-Path $path -PathType Container) {
        Write-Host "✅ Diretório existe: $path" -ForegroundColor Green
        $script:PASS++
    } else {
        Write-Host "❌ Diretório NÃO existe: $path" -ForegroundColor Red
        $script:FAIL++
    }
}

# Função para verificar variável .env
function Check-Env {
    param($key)
    if (Test-Path ".env") {
        $envContent = Get-Content ".env" | Select-String $key
        if ($envContent) {
            Write-Host "✅ $key existe em .env" -ForegroundColor Green
            $script:PASS++
        } else {
            Write-Host "⚠️  $key NÃO encontrado em .env" -ForegroundColor Yellow
            $script:WARN++
        }
    } else {
        Write-Host "⚠️  .env não encontrado" -ForegroundColor Yellow
        $script:WARN++
    }
}

Write-Host ""
Write-Host "📦 DEPENDÊNCIAS" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Check-Command "node"
Check-Command "npm"
Check-Command "npx"

Write-Host ""
Write-Host "📁 ESTRUTURA DE DIRETÓRIOS" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Check-Dir "server"
Check-Dir "client"
Check-Dir "shared"
Check-Dir "scripts"
Check-Dir "tests"
Check-Dir "docs"

Write-Host ""
Write-Host "📄 ARQUIVOS CRÍTICOS" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Check-File ".env"
Check-File "package.json"
Check-File "tsconfig.json"
Check-File "server/index.ts"
Check-File "server/routes/routes.ts"
Check-File "server/services/aiDeveloper.ts"
Check-File "shared/schema.ts"
Check-File "client/src/App.tsx"
Check-File "client/src/pages/test-clara.tsx"

Write-Host ""
Write-Host "🔐 VARIÁVEIS DE AMBIENTE" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Check-Env "DATABASE_URL"
Check-Env "PORT"

Write-Host ""
Write-Host "🧪 ARQUIVOS DE TESTE E DOCUMENTAÇÃO" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Check-File "tests\e2e\clara-erp.spec.ts"
Check-File "docs\clara-ia-maintenance-guide.md"
Check-File "CHECKLIST_IA_DEVELOPER.md"
Check-File "scripts\ngrok-tunnel.js"

Write-Host ""
Write-Host "🔧 VERIFICAÇÕES DE CÓDIGO" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Verificar se Clara está em routes.ts
$routesContent = Get-Content "server/routes/routes.ts" -Raw -ErrorAction SilentlyContinue
if ($routesContent -match "clara") {
    Write-Host "✅ Clara IA encontrada em routes" -ForegroundColor Green
    $PASS++
} else {
    Write-Host "❌ Clara IA NÃO encontrada em routes" -ForegroundColor Red
    $FAIL++
}

# Verificar se Flora foi removido
if ($routesContent -match "/api/flora") {
    Write-Host "❌ Rotas Flora ainda existem (devem ser Clara)" -ForegroundColor Red
    $FAIL++
} else {
    Write-Host "✅ Rotas Flora removidas ✓" -ForegroundColor Green
    $PASS++
}

Write-Host ""
Write-Host "🎯 COMPILAÇÃO TYPESCRIPT" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
$tsOutput = npm run check 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ TypeScript compila sem erros" -ForegroundColor Green
    $PASS++
} else {
    Write-Host "❌ Erros TypeScript encontrados" -ForegroundColor Red
    $FAIL++
    Write-Host "Primeiras linhas de erro:" -ForegroundColor Yellow
    $tsOutput | Select-Object -First 10 | ForEach-Object { Write-Host $_ }
}

Write-Host ""
Write-Host "📊 RESUMO" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "✅ Passou: $PASS" -ForegroundColor Green
Write-Host "❌ Falhou: $FAIL" -ForegroundColor Red
Write-Host "⚠️  Avisos: $WARN" -ForegroundColor Yellow

Write-Host ""

if ($FAIL -eq 0) {
    Write-Host "🎉 AMBIENTE VALIDADO COM SUCESSO!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Próximos passos:"
    Write-Host "1. npm run dev           → Inicia servidor"
    Write-Host "2. npm run tunnel        → Abre Ngrok"
    Write-Host "3. npm run test:e2e      → Executa testes"
    Write-Host ""
    Write-Host "Ou tudo junto:"
    Write-Host "npm run mobile-test      → Dev + Ngrok + Auditoria"
} else {
    Write-Host "⚠️  ERROS ENCONTRADOS!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Verifique:"
    Write-Host "1. Instale Node.js (nodejs.org)"
    Write-Host "2. Crie arquivo .env com DATABASE_URL e PORT=5000"
    Write-Host "3. Execute: npm install"
    Write-Host "4. Execute: npm run db:push"
}

exit $FAIL
