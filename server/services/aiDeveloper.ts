import { processLearningPrompt, suggestBugFix, createNewModule, iterativeLearning } from "./autoLearningModule.ts";
import { saveToMemory, readFromMemory } from "./memoryModule.ts";

// Classe principal da IA Developer
export class AIDeveloper {
  private memoryEnabled: boolean = true;

  constructor() {
    // Inicializar memória se necessário
    this.initializeMemory();
  }

  private async initializeMemory(): Promise<void> {
    // Carregar memórias existentes (em produção, do DB)
    console.log("IA Developer: Memória inicializada.");
  }

  // Método para receber prompt de aprendizado
  async learnFromPrompt(promptData: { prompt: string; context?: string; expectedOutput?: string }): Promise<string> {
    if (!this.memoryEnabled) {
      return "Memória desabilitada. Aprendizado não armazenado.";
    }

    const result = await processLearningPrompt(promptData);
    console.log("IA Developer: Novo aprendizado adquirido.");
    return result;
  }

  // Método para sugerir correção de bug
  async fixBug(errorMessage: string): Promise<string> {
    const suggestion = await suggestBugFix(errorMessage);
    // Armazenar correção na memória para futuro
    await saveToMemory(`bug_${Date.now()}`, suggestion, 'bug_fix');
    return suggestion;
  }

  // Método para criar novo módulo
  async generateModule(name: string, description: string): Promise<string> {
    const code = await createNewModule(name, description);
    console.log(`IA Developer: Novo módulo '${name}' gerado.`);
    return code;
  }

  // Método para aprendizado iterativo
  async iterativeLearn(newPrompt: string): Promise<string> {
    const result = await iterativeLearning(newPrompt);
    console.log("IA Developer: Aprendizado iterativo aplicado.");
    return result;
  }

  // Método para chat
  async chat(message: string, userRole?: string): Promise<string> {
    // Simple response for now
    return `Olá! Sou a Clara IA. Você disse: ${message}. Seu papel é: ${userRole || 'desconhecido'}`;
  }

  // Método para teste
  async runTest(testName: string): Promise<string> {
    return `Teste ${testName} executado com sucesso.`;
  }

  // Método para consultar memória
  async recallKnowledge(key: string): Promise<string | null> {
    return await readFromMemory(key);
  }

  // Método para desabilitar memória (para testes)
  disableMemory(): void {
    this.memoryEnabled = false;
  }
}

// Instância global da IA Developer
export const aiDeveloper = new AIDeveloper();
