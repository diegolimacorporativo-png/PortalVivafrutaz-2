#!/usr/bin/env node
/**
 * Ngrok Tunnel Script - Versão CLI (v2)
 * Usa ngrok CLI diretamente ao invés do package Node.js
 */

const { spawn } = require('child_process');
const http = require('http');

const PORT = process.env.PORT || 5000;

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
    log('\n🚀 Iniciando Ngrok Tunnel (CLI)...', 'blue');

    // Verifica se servidor está rodando
    log('✓ Verificando servidor local em porta ' + PORT + '...', 'cyan');
    const serverRunning = await checkServerStatus();
    if (!serverRunning) {
      log('⚠️  Servidor pode não estar respondendo em http://localhost:' + PORT, 'yellow');
      log('   Aguardando... (isso é normal no início)', 'yellow');
    } else {
      log('✓ Servidor respondendo!', 'green');
    }

    // Abre túnel Ngrok via CLI
    log('✓ Abrindo túnel Ngrok via CLI...', 'cyan');
    const ngrok = spawn('ngrok', ['http', PORT.toString(), '--region', 'sa'], {
      stdio: 'pipe'
    });

    let buffer = '';
    let urlFound = false;

    ngrok.stdout.on('data', (data) => {
      const output = data.toString();
      buffer += output;
      process.stdout.write(output);

      // Procura pela URL no output
      if (!urlFound) {
        const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.ngrok\.io/);
        if (urlMatch) {
          urlFound = true;
          const url = urlMatch[0];
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

          log(`\n⏱️  Tunnel ativo. Pressione Ctrl+C para fechar.`, 'yellow');
        }
      }
    });

    ngrok.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    ngrok.on('close', (code) => {
      if (code !== 0) {
        log(`\n❌ Ngrok encerrou com erro (código ${code})`, 'red');
        process.exit(1);
      }
    });

    // Mantém o processo rodando
    process.on('SIGINT', () => {
      log('\n\n👋 Fechando Ngrok...', 'yellow');
      ngrok.kill();
      process.exit(0);
    });

  } catch (error) {
    log(`\n❌ Erro: ${error.message}`, 'red');
    process.exit(1);
  }
}

startNgrokTunnel();
