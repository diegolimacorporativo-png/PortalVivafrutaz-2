#!/bin/bash

# 🔍 TESTE DE VALIDAÇÃO DO AMBIENTE - ERP VIVAFRUTAZ + CLARA IA
# Execute: npm run validate (ou bash ./validate.sh)

echo "=========================================="
echo "🔍 VALIDAÇÃO DO AMBIENTE - ERP VIVAFRUTAZ"
echo "=========================================="
echo ""

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Contadores
PASS=0
FAIL=0
WARN=0

# Função para verificar comando
check_command() {
    if command -v $1 &> /dev/null; then
        echo -e "${GREEN}✅${NC} $1 instalado"
        ((PASS++))
    else
        echo -e "${RED}❌${NC} $1 NÃO instalado"
        ((FAIL++))
    fi
}

# Função para verificar arquivo
check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✅${NC} Arquivo existe: $1"
        ((PASS++))
    else
        echo -e "${RED}❌${NC} Arquivo NÃO existe: $1"
        ((FAIL++))
    fi
}

# Função para verificar diretório
check_dir() {
    if [ -d "$1" ]; then
        echo -e "${GREEN}✅${NC} Diretório existe: $1"
        ((PASS++))
    else
        echo -e "${RED}❌${NC} Diretório NÃO existe: $1"
        ((FAIL++))
    fi
}

# Função para verificar variável .env
check_env() {
    if grep -q "$1" .env 2>/dev/null; then
        echo -e "${GREEN}✅${NC} $1 existe em .env"
        ((PASS++))
    else
        echo -e "${YELLOW}⚠️${NC}  $1 NÃO encontrado em .env"
        ((WARN++))
    fi
}

echo ""
echo -e "${BLUE}📦 DEPENDÊNCIAS${NC}"
echo "=========================================="
check_command node
check_command npm
check_command npx
check_command tsc
check_command psql

echo ""
echo -e "${BLUE}📁 ESTRUTURA DE DIRETÓRIOS${NC}"
echo "=========================================="
check_dir "server"
check_dir "client"
check_dir "shared"
check_dir "scripts"
check_dir "tests"
check_dir "docs"

echo ""
echo -e "${BLUE}📄 ARQUIVOS CRÍTICOS${NC}"
echo "=========================================="
check_file ".env"
check_file "package.json"
check_file "tsconfig.json"
check_file "server/index.ts"
check_file "server/routes/routes.ts"
check_file "server/services/aiDeveloper.ts"
check_file "shared/schema.ts"
check_file "client/src/App.tsx"
check_file "client/src/pages/test-clara.tsx"

echo ""
echo -e "${BLUE}🔐 VARIÁVEIS DE AMBIENTE${NC}"
echo "=========================================="
check_env "DATABASE_URL"
check_env "PORT"
check_env "NODE_ENV"

echo ""
echo -e "${BLUE}🧪 ARQUIVOS DE TESTE E DOCUMENTAÇÃO${NC}"
echo "=========================================="
check_file "tests/e2e/clara-erp.spec.ts"
check_file "docs/clara-ia-maintenance-guide.md"
check_file "CHECKLIST_IA_DEVELOPER.md"
check_file "scripts/ngrok-tunnel.js"

echo ""
echo -e "${BLUE}🔧 VERIFICAÇÕES DE CÓDIGO${NC}"
echo "=========================================="

# Verificar se Clara está em routes.ts
if grep -q "clara" server/routes/routes.ts 2>/dev/null; then
    echo -e "${GREEN}✅${NC} Clara IA encontrada em routes"
    ((PASS++))
else
    echo -e "${RED}❌${NC} Clara IA NÃO encontrada em routes"
    ((FAIL++))
fi

# Verificar se Flora foi removido de routes.ts
if grep -q "/api/flora" server/routes/routes.ts 2>/dev/null; then
    echo -e "${RED}❌${NC} Rotas Flora ainda existem (devem ser Clara)"
    ((FAIL++))
else
    echo -e "${GREEN}✅${NC} Rotas Flora removidas ✓"
    ((PASS++))
fi

# Verificar TypeScript
echo ""
echo -e "${BLUE}🎯 COMPILAÇÃO TYPESCRIPT${NC}"
echo "=========================================="
if npm run check > /dev/null 2>&1; then
    echo -e "${GREEN}✅${NC} TypeScript compila sem erros"
    ((PASS++))
else
    echo -e "${RED}❌${NC} Erros TypeScript encontrados"
    ((FAIL++))
    echo -e "${YELLOW}Rodando npm run check para detalhes:${NC}"
    npm run check 2>&1 | head -20
fi

echo ""
echo -e "${BLUE}📊 RESUMO${NC}"
echo "=========================================="
echo -e "${GREEN}✅ Passou: $PASS${NC}"
echo -e "${RED}❌ Falhou: $FAIL${NC}"
echo -e "${YELLOW}⚠️  Avisos: $WARN${NC}"

echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}🎉 AMBIENTE VALIDADO COM SUCESSO!${NC}"
    echo ""
    echo "Próximos passos:"
    echo "1. npm run dev           → Inicia servidor"
    echo "2. npm run tunnel        → Abre Ngrok"
    echo "3. npm run test:e2e      → Executa testes"
    echo ""
    echo "Ou tudo junto:"
    echo "npm run mobile-test      → Dev + Ngrok + Auditoria"
    exit 0
else
    echo -e "${RED}⚠️  ERROS ENCONTRADOS!${NC}"
    echo ""
    echo "Verifique:"
    echo "1. Instale Node.js e npm"
    echo "2. Crie arquivo .env com DATABASE_URL e PORT"
    echo "3. Execute: npm install"
    echo "4. Execute: npm run db:push"
    echo ""
    exit 1
fi
