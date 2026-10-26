export interface ClaraProductDraft {
  name?: string;
  category?: string;
  unit?: string;
}

export interface ClaraProductContext {
  action: 'create_product';
  step: 'name' | 'category' | 'unit' | 'confirm';
  data: ClaraProductDraft;
}

export interface ClaraCreatedProduct {
  id: number;
  name: string;
  category: string;
  unit: string;
}

export async function createClaraProduct(
  draft: ClaraProductDraft,
  create: (input: { name: string; category: string; unit: string; active: true; basePrice: null; observation: string }) => Promise<ClaraCreatedProduct>,
): Promise<ClaraCreatedProduct> {
  if (!draft.name?.trim() || !draft.category?.trim() || !draft.unit?.trim()) {
    throw new Error('Nome, categoria e unidade são obrigatórios');
  }
  const product = await create({
    name: draft.name.trim(),
    category: draft.category.trim(),
    unit: draft.unit.trim(),
    active: true,
    basePrice: null,
    observation: 'Cadastrado via Clara IA',
  });
  if (!Number.isInteger(product.id) || product.id <= 0) {
    throw new Error('O armazenamento não retornou o ID gerado do produto');
  }
  return product;
}

export function advanceProductCreation(
  context: ClaraProductContext,
  message: string,
  availableCategories: string[] = [],
): { response: string; context: ClaraProductContext | null; create?: ClaraProductDraft; cancelled?: boolean } {
  const value = message.trim();
  const normalized = value.toLocaleLowerCase('pt-BR');
  if (['cancelar', 'cancela', 'não', 'nao'].includes(normalized)) {
    return { response: '❌ Criação do produto cancelada.', context: null, cancelled: true };
  }

  const data = { ...context.data };
  if (context.step === 'name') {
    if (value.length < 2) return { response: 'Informe um nome de produto com pelo menos 2 caracteres.', context };
    data.name = value;
    return { response: `✅ Nome: **${value}**\n\nInforme a **categoria** do produto:`, context: { action: 'create_product', step: 'category', data } };
  }
  if (context.step === 'category') {
    if (!value) return { response: 'Informe a categoria do produto:', context };
    const category = availableCategories.find((candidate) => candidate.toLocaleLowerCase('pt-BR') === normalized);
    if (!category) {
      return {
        response: availableCategories.length
          ? `Escolha uma categoria existente: ${availableCategories.join(', ')}.`
          : 'Não há categorias ativas cadastradas. Cadastre uma categoria no catálogo e depois inicie o cadastro do produto.',
        context,
      };
    }
    data.category = category;
    return { response: `✅ Categoria: **${value}**\n\nInforme a **unidade** (ex.: kg, caixa, unidade):`, context: { action: 'create_product', step: 'unit', data } };
  }
  if (context.step === 'unit') {
    if (!value) return { response: 'Informe a unidade do produto:', context };
    data.unit = value;
    return {
      response: `📋 **Confirme o novo produto**\n\n• Nome: ${data.name}\n• Categoria: ${data.category}\n• Unidade: ${value}\n\nO preço pode ser configurado depois por categoria. Digite **"confirmar"** para criar ou **"cancelar"** para desistir.`,
      context: { action: 'create_product', step: 'confirm', data },
    };
  }
  if (context.step === 'confirm' && ['confirmar', 'sim', 'ok'].includes(normalized)) {
    return { response: '', context: null, create: data };
  }
  return { response: 'Digite **"confirmar"** para criar o produto ou **"cancelar"** para desistir.', context };
}
