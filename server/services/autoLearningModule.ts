import { saveToMemory, readFromMemory, listMemoryByCategory } from "./memoryModule.ts";

// Interface para prompt de aprendizado
interface LearningPrompt {
  prompt: string;
  context?: string;
  expectedOutput?: string;
}

// Função para pedir permissão antes de alterações
export async function requestPermission(action: string, details: string): Promise<boolean> {
  // Simula pedido de permissão ao usuário
  console.log(`IA Developer: Solicitando permissão para: ${action}`);
  console.log(`Detalhes: ${details}`);
  console.log("Responda 'SIM' para aprovar ou 'NAO' para rejeitar.");

  // Em produção, isso seria integrado com UI ou prompt do usuário
  // Por enquanto, retorna false para simular necessidade de aprovação
  return false; // Sempre pede permissão
}

// Função para processar prompt de aprendizado
export async function processLearningPrompt(promptData: LearningPrompt): Promise<string> {
  const { prompt, context, expectedOutput } = promptData;

  // Analisar prompt para extrair padrões
  const patterns = extractPatterns(prompt);

  // Salvar aprendizado na memória
  for (const pattern of patterns) {
    await saveToMemory(`pattern_${pattern.key}`, pattern.value, 'code_pattern');
  }

  // Se há contexto, salvar como conhecimento geral
  if (context) {
    await saveToMemory(`context_${Date.now()}`, context, 'general_knowledge');
  }

  // Se há output esperado, salvar como exemplo
  if (expectedOutput) {
    await saveToMemory(`example_${Date.now()}`, expectedOutput, 'example_output');
  }

  return "Aprendizado processado e armazenado na memória.";
}

// Função auxiliar para extrair padrões do prompt
function extractPatterns(prompt: string): { key: string; value: string }[] {
  const patterns: { key: string; value: string }[] = [];

  // Exemplo simples: detectar palavras-chave como "função", "módulo", etc.
  if (prompt.includes('função')) {
    patterns.push({ key: 'function_pattern', value: 'Criar função com boas práticas TypeScript' });
  }
  if (prompt.includes('módulo')) {
    patterns.push({ key: 'module_pattern', value: 'Estrutura de módulo compatível com ERP' });
  }
  // Adicionar mais lógica conforme necessário

  return patterns;
}

// Função para sugerir correção de bug baseada na memória
export async function suggestBugFix(error: string): Promise<string> {
  const relatedMemories = await listMemoryByCategory('bug_fix');
  const relevant = relatedMemories.find(m => error.includes(m.key));

  if (relevant) {
    return `Sugestão baseada em aprendizado: ${relevant.value}`;
  }

  return "Nenhuma correção conhecida na memória para este erro.";
}

// Função para criar módulo novo baseado em aprendizado
export async function createNewModule(name: string, description: string): Promise<string> {
  const patterns = await listMemoryByCategory('code_pattern');
  const template = patterns.map(p => p.value).join('\n');

  const moduleCode = `
export function ${name}(): void {
  // ${description}
  // Implementação baseada em padrões aprendidos: ${template}
  console.log("${name} executado");
}
`;

  // Salvar módulo criado na memória
  await saveToMemory(`module_${name}`, moduleCode, 'module_created');

  return moduleCode;
}

// Função para executar teste simples
export async function runSimpleTest(testName: string): Promise<string> {
  // Simula execução de teste
  console.log(`Executando teste: ${testName}`);
  // Em produção, integrar com Jest ou similar
  return `Teste ${testName} executado com sucesso.`;
}

// Função para aprender iterativamente
export async function iterativeLearning(newPrompt: string): Promise<string> {
  const previousKnowledge = await readFromMemory('last_learning');
  const enhancedPrompt = previousKnowledge ? `${previousKnowledge}\n${newPrompt}` : newPrompt;

  const result = await processLearningPrompt({ prompt: enhancedPrompt });
  await saveToMemory('last_learning', enhancedPrompt, 'iterative_learning');

  return result;
}
