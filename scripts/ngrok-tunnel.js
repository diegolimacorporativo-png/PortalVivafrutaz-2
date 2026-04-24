#!/usr/bin/env node

/**
 * Script para abrir túnel Ngrok automaticamente
 * Uso: node scripts/ngrok-tunnel.js
 * 
 * Este script:
 * 1. Verifica se o servidor está rodando na porta 5000
 * 2. Abre um túnel Ngrok público
 * 3. Exibe o link público HTTPS
 * 4. Salva o link em arquivo para referência
 */

import ngrok from 'ngrok';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 5000;
const LOG_FILE = path.join(__dirname, '../ngrok-link.log');

// Cores para terminal
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Verifica se servidor está rodando
function checkServerStatus() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${PORT}`, (res) => {
      resolve(res.statusCode !== undefined);
      req.destroy();
    });
    req.on('error', () => resolve(false));
  });
}

async function startNgrokTunnel() {
  try {
    log('\n🚀 Iniciando Ngrok Tunnel...', 'blue');

    // Verifica se servidor está rodando
    log('✓ Verificando servidor local...', 'cyan');
    const serverRunning = await checkServerStatus();
    if (!serverRunning) {
      log('⚠️  Servidor não está respondendo em http://localhost:' + PORT, 'yellow');
      log('   Certifique-se de executar: npx tsx server/index.ts', 'yellow');
    }

    // Abre túnel Ngrok
    log('✓ Abrindo túnel Ngrok...', 'cyan');
    const url = await ngrok.connect({
      proto: 'http',
      addr: PORT,
      region: 'sa', // South America (mais rápido para Brasil)
    });

    log(`\n✅ Túnel Ngrok aberto com sucesso!`, 'green');
    log(`\n📱 Link público HTTPS:`, 'cyan');
    log(`   ${url}`, 'green');
    
    log(`\n🌐 Acesso ao ERP VivaFrutaz:`, 'cyan');
    log(`   Página de Status Clara IA: ${url}/test-clara`, 'green');
    log(`   Chat Clara IA: ${url}/api/clara/chat`, 'green');
    log(`   Inserir NF Manual: ${url}/admin/insert-nf-manual`, 'green');
    
    log(`\n💻 Testes recomendados:`, 'cyan');
    log(`   Desktop: http://localhost:${PORT}/test-clara`, 'green');
    log(`   Mobile: ${url}/test-clara`, 'green');
    log(`   Outro navegador: ${url}`, 'green');

    // Salva link em arquivo
    const logContent = `Ngrok Tunnel - ${new Date().toISOString()}\n` +
                      `Public URL: ${url}\n` +
                      `Server Port: ${PORT}\n` +
                      `Status Page: ${url}/test-clara\n` +
                      `API/Chat: ${url}/api/clara/chat\n`;
    
    fs.writeFileSync(LOG_FILE, logContent);
    log(`\n📝 Link salvo em: ngrok-link.log`, 'cyan');

    log(`\n⏱️  Tunnel ativo. Pressione Ctrl+C para fechar.`, 'yellow');

    // Mantém o túnel aberto
    process.on('SIGINT', async () => {
      log('\n\n👋 Fechando Ngrok...', 'yellow');
      await ngrok.kill();
      process.exit(0);
    });

  } catch (error) {
    log(`\n❌ Erro ao abrir Ngrok:`, 'red');
    log(`   ${error.message}`, 'red');
    
    // Sugestões de correção
    if (error.message.includes('ERR_NGROK_317')) {
      log(`\n💡 Dica: Você pode precisar de uma conta Ngrok gratuita.`, 'yellow');
      log(`   Visite: https://dashboard.ngrok.com/signup`, 'cyan');
      log(`   Configure token: ngrok config add-authtoken <seu-token>`, 'cyan');
    }
    
    if (error.message.includes('Connection refused')) {
      log(`\n💡 Dica: Certifique-se que o servidor está rodando em http://localhost:${PORT}`, 'yellow');
      log(`   Execute em outro terminal: npx tsx server/index.ts`, 'cyan');
    }

    process.exit(1);
  }
}

// Executa
startNgrokTunnel();
