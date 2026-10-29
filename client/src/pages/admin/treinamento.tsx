import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { BackHeader } from '@/components/navigation/BackHeader';
import { Badge } from '@/components/ui/badge';
import {
  BookOpen, ChevronDown, ChevronRight, Truck, Receipt, Brain,
  Users, ShoppingCart, BarChart3, Package, DollarSign,
  MapPin, Zap, Shield, CheckCircle, Info, FileText,
  GraduationCap, Bot, Route, Warehouse,
  Layers, Globe, Navigation, Map, CheckCircle2, Hash, Tags, Tag
} from 'lucide-react';

interface ModuleInfo {
  id: string;
  title: string;
  icon: any;
  category: string;
  color: string;
  description: string;
  features: string[];
  access: string[];
  tips?: string[];
}

const MODULES: ModuleInfo[] = [
  {
    id: 'dashboard',
    title: 'Painel / Dashboard',
    icon: BarChart3,
    category: 'Painel',
    color: 'text-blue-600',
    description: 'Visão geral do sistema em tempo real. Exibe métricas principais, alertas operacionais, pedidos do dia e performance da equipe.',
    features: [
      'Resumo de pedidos do dia (pendentes, em rota, entregues)',
      'KPIs financeiros: faturamento, ticket médio, inadimplência',
      'Alertas operacionais automáticos (estoque crítico, rotas sem veículo)',
      'Gráficos de performance semanal e mensal',
    ],
    access: ['ADMIN', 'DIRECTOR', 'LOGISTICS'],
    tips: ['Acesse diariamente ao iniciar o expediente para uma visão rápida do dia.'],
  },
  {
    id: 'empresas',
    title: 'Empresas / Clientes',
    icon: Users,
    category: 'Comercial',
    color: 'text-purple-600',
    description: 'Cadastro completo de clientes B2B. Gerencie dados da empresa, contratos, endereços múltiplos, configurações de entrega e histórico.',
    features: [
      'Cadastro com CNPJ, contato, endereços múltiplos',
      'Tipos de cliente: Semanal, Mensal, Contratual',
      'Configuração de janelas de entrega por dia da semana',
      'Busca inteligente por nome, CEP, bairro, cidade',
      'Múltiplos endereços de entrega por empresa',
      'Histórico de pedidos e ocorrências',
      'Exclusão permanente disponível apenas para MASTER e DIRECTOR; apaga em uma transação pedidos, notas fiscais e demais registros vinculados por chaves estrangeiras ou pelos campos de empresa legados',
    ],
    access: ['ADMIN', 'DIRECTOR'],
    tips: [
      'Use a busca por CEP para localizar empresas rapidamente.',
      'Configure as janelas de entrega corretamente para que o sistema calcule rotas.',
      'Inativar preserva o cadastro e o histórico. Excluir permanentemente apaga pedidos, entregas, notas fiscais, usuários e demais registros vinculados; é irreversível. Se houver relação cíclica não suportada ou qualquer falha, toda a operação é cancelada.',
    ],
  },
  {
    id: 'pedidos',
    title: 'Pedidos',
    icon: ShoppingCart,
    category: 'Pedidos',
    color: 'text-orange-600',
    description: 'Gestão completa do ciclo de pedidos. Criação, edição, aprovação e acompanhamento de todas as ordens de entrega.',
    features: [
      'Criação manual e automática de pedidos',
      'Pedidos semanais e pontuais',
      'Janelas de pedido configuráveis por empresa',
      'Status em tempo real: pendente, em rota, entregue, cancelado',
      'Exceções e pedidos especiais',
      'Exportação para Excel/PDF',
      'A exclusão do histórico exige motivo, alvo de uma única empresa por vez e confirmação adicional para pedidos com NF-e',
      'A trilha de auditoria da exclusão é mantida; o fechamento fiscal continua bloqueando alterações no período fechado',
    ],
    access: ['ADMIN', 'OPERATIONS_MANAGER', 'DIRECTOR', 'LOGISTICS'],
  },
  {
    id: 'catalogo',
    title: 'Produtos, Categorias e Preços',
    icon: Package,
    category: 'Compras',
    color: 'text-orange-600',
    description: 'Catálogo VivaFrutaz com produto, unidade, categoria e preço base ou preços específicos por categoria.',
    features: [
      'O banco gera um ID próprio para cada registro de produto',
      'productCode é um código opcional para agrupar produtos base e variantes',
      'Preços por categoria podem ser diferentes para o mesmo produto',
      'A importação permite revisar produtos, categorias, medidas e preços antes de confirmar',
    ],
    access: ['ADMIN', 'DIRECTOR'],
    tips: ['Confira a categoria e o preço da variante antes de importar ou liberar o produto para pedidos.'],
  },
  {
    id: 'logistica',
    title: 'Logística & Rotas',
    icon: Truck,
    category: 'Logística',
    color: 'text-teal-600',
    description: 'Organize entregas em rotas, atribua motoristas e acompanhe os status registrados durante a operação.',
    features: [
      'Cada parada precisa estar vinculada à entrega e à empresa corretas, em uma rota com motorista atribuído',
      'O motorista usa o painel web ou o VivaFrutaz Tracker Android para consultar suas paradas',
      'O Tracker Android envia GPS por serviço em primeiro plano e mantém fila local para reenvio após perda de rede',
      'A posição no mapa e a estimativa de chegada dependem de jornada iniciada, rota/paradas configuradas e GPS recente',
      'A confirmação “Entregue” grava checklist, horário e evento de status; pedidos com várias entregas só são finalizados quando todas terminam',
      'A busca inteligente só sugere encaixe em rota da mesma data com motorista ativo atribuído e coordenadas válidas; a distância é em linha reta, sem ruas ou trânsito',
      'Ocorrências e mudanças de status são registradas por parada e podem ser consultadas no histórico',
    ],
    access: ['ADMIN', 'DIRECTOR', 'LOGISTICS', 'OPERATIONS_MANAGER'],
    tips: [
      'Antes de sair, confira empresa/endereço, ordem das paradas, motorista, veículo e início da jornada.',
      'Use a sugestão como apoio: ela não considera trânsito, capacidade do veículo ou janelas de entrega, e precisa de revisão manual antes de alterar a rota.',
      'Um clique não substitui confirmação do servidor: aguarde a resposta de sucesso. Se houver falha de rede, tente novamente e confira o histórico antes de repetir.',
      'O Android APK versionado em releases é anterior ao contrato GPS atual; não distribua esse APK. Gere e valide uma nova versão a partir do código-fonte antes de instalar nos aparelhos.',
      'Mudanças de status geram aviso push pelo outbox. A entrega depende de VAPID configurado, aviso habilitado e o cliente ter permitido notificações no dispositivo; o portal também atualiza o rastreamento enquanto está aberto.',
    ],
  },
  {
    id: 'painel-motorista',
    title: 'Painel do Motorista',
    icon: Route,
    category: 'Logística',
    color: 'text-cyan-600',
    description: 'Área do motorista para consultar entregas atribuídas, registrar andamento e compartilhar localização quando permitido.',
    features: [
      'Lista de entregas do dia em ordem de rota',
      'Botão Entregue envia confirmação e observação ao servidor; assinatura e foto são ações separadas',
      'Jornada, odômetro e comprovantes de entrega (assinatura/foto) são operações separadas da confirmação “Entregue”',
      'Transmissão contínua de GPS no Android enquanto serviço, permissão e rede/dispositivo permitirem',
      'Histórico de entregas do turno',
    ],
    access: ['MOTORISTA', 'LOGISTICS', 'ADMIN'],
    tips: ['No início do turno, valide sessão, rota do dia, jornada ativa e estado “GPS ativo/último envio”. O sistema não consegue garantir rastreamento contínuo se Android/rede/bateria interromperem o serviço.'],
  },
  {
    id: 'financeiro',
    title: 'Financeiro & Contas',
    icon: DollarSign,
    category: 'Financeiro',
    color: 'text-green-600',
    description: 'Área financeira em fase congelada. Não use estes dados para fechamento, cobrança ou decisões financeiras até nova liberação.',
    features: [
      'A implementação não está liberada para uso operacional',
      'Esta central não confirma integrações bancárias, cobrança ou conciliação em produção',
    ],
    access: ['ADMIN', 'FINANCEIRO', 'DIRECTOR'],
  },
  {
    id: 'nfe',
    title: 'NF-e / Nota Fiscal',
    icon: Receipt,
    category: 'Financeiro',
    color: 'text-emerald-600',
    description: 'Módulo NF-e em modo mock proposital. As operações simulam respostas e não autorizam uma nota na SEFAZ.',
    features: [
      'Fluxos de emissão e retorno simulados para desenvolvimento',
      'Protocolo, DANFE ou XML do modo mock não são comprovantes de autorização fiscal',
      'A ativação em produção depende de configuração e validação fiscal autorizadas',
    ],
    access: ['ADMIN', 'FINANCEIRO', 'DIRECTOR'],
    tips: ['Use o módulo apenas para conhecer e validar o fluxo simulado enquanto o modo mock estiver ativo.'],
  },
  {
    id: 'estoque',
    title: 'Estoque & Inventário',
    icon: Warehouse,
    category: 'Compras',
    color: 'text-amber-600',
    description: 'Controle de estoque em tempo real, inventário, alertas de mínimo e planejamento de compras.',
    features: [
      'Cadastro de produtos com estoque mínimo',
      'Alertas automáticos de estoque crítico',
      'Movimentações de entrada e saída',
      'Controle de desperdício',
      'Relatório de giro de estoque',
    ],
    access: ['ADMIN', 'DIRECTOR', 'PURCHASE_MANAGER'],
  },
  {
    id: 'ia-operacional',
    title: 'IA Operacional (Clara)',
    icon: Brain,
    category: 'Inteligência',
    color: 'text-violet-600',
    description: 'A Clara atende consultas e alguns fluxos guiados. O que ela pode executar depende da intenção, da sessão e das permissões do usuário.',
    features: [
      'Consulta de pedidos, logística, estoque e dados comerciais permitidos ao perfil',
      'Consulta de clima atual e previsão para amanhã',
      'Respostas curtas para pedidos de piada',
      'Cadastro guiado de produto para usuários internos autorizados, com confirmação',
    ],
    access: ['ADMIN', 'DIRECTOR', 'DEVELOPER', 'OPERATIONS_MANAGER'],
    tips: ['Acesse diariamente para verificar alertas críticos antes de iniciar as operações.'],
  },
  {
    id: 'saas',
    title: 'Gestão SaaS & Planos',
    icon: Layers,
    category: 'SaaS',
    color: 'text-indigo-600',
    description: 'Área administrativa de empresas e configurações SaaS. Consulte limites e condições vigentes na conta; esta central não publica preços de planos.',
    features: [
      'Consulta e configuração dependem do perfil administrativo',
      'Esta página não é uma tabela comercial nem confirma recursos ativos por plano',
    ],
    access: ['MASTER', 'ADMIN', 'DIRECTOR'],
  },
  {
    id: 'usuarios',
    title: 'Usuários & Permissões',
    icon: Shield,
    category: 'Sistema',
    color: 'text-red-600',
    description: 'Gerenciamento de usuários internos por perfil. MASTER e DIRECTOR têm as mesmas permissões globais; ADMIN administra perfis operacionais da própria empresa.',
    features: [
      'Roles: MASTER, ADMIN, DIRECTOR, DEVELOPER, LOGISTICS, FINANCEIRO, etc.',
      'A visibilidade de abas é uma preferência de navegação; as APIs validam perfil e empresa no servidor',
      'Somente MASTER e DIRECTOR podem atribuir perfis globais como MASTER, DIRECTOR e DEVELOPER',
      'Ao criar um usuário como MASTER/DIRECTOR, selecione uma empresa ativa para um perfil operacional ou “Conta global” para MASTER/DIRECTOR; a empresa do novo usuário aparece na lista',
      'Bloqueio automático após múltiplas tentativas de login falhas',
      'Auditoria de ações do sistema',
      'A exclusão permanente funciona para um usuário selecionado; operadores globais MASTER/DIRECTOR excluem o alvo pelo cadastro e o servidor fixa a operação à empresa salva para esse usuário',
    ],
    access: ['MASTER', 'ADMIN', 'DIRECTOR'],
    tips: ['Se o usuário tiver registros operacionais vinculados, a exclusão é bloqueada para preservar o histórico; desative a conta para impedir o acesso.'],
  },
  {
    id: 'marketplace',
    title: 'Loja de Módulos',
    icon: Globe,
    category: 'SaaS',
    color: 'text-pink-600',
    description: 'A disponibilidade de módulos varia conforme a configuração da instalação. Confirme no painel antes de orientar uma empresa cliente.',
    features: [
      'Não presuma que um módulo listado está liberado ou conectado a um serviço externo',
      'NF-e permanece em modo mock e o Financeiro permanece congelado',
    ],
    access: ['MASTER', 'ADMIN', 'DIRECTOR'],
  },
];

function ModuleCard({ mod }: { mod: ModuleInfo }) {
  const [open, setOpen] = useState(false);
  const Icon = mod.icon;

  return (
    <div className="border border-border/60 rounded-xl overflow-hidden bg-card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-muted/30 transition-colors"
        data-testid={`button-module-${mod.id}`}
      >
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${open ? 'bg-primary/10' : 'bg-muted'}`}>
          <Icon className={`w-5 h-5 ${open ? 'text-primary' : mod.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-foreground">{mod.title}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{mod.category}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{mod.description}</p>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-border/40 pt-4 bg-muted/10">
          <p className="text-sm text-muted-foreground">{mod.description}</p>

          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60 mb-2">Funcionalidades</p>
            <ul className="space-y-1.5">
              {mod.features.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60 mb-2">Acesso permitido</p>
            <div className="flex flex-wrap gap-1.5">
              {mod.access.map(role => (
                <Badge key={role} variant="secondary" className="text-xs">{role}</Badge>
              ))}
            </div>
          </div>

          {mod.tips && (
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-1">
              <p className="text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1"><Info className="w-3.5 h-3.5" /> Dicas</p>
              {mod.tips.map((t, i) => (
                <p key={i} className="text-xs text-amber-700 dark:text-amber-300">{t}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const QUICK_START_STEPS = [
  { n: 1, title: 'Prepare as categorias', desc: 'Em Produtos, confira se as categorias que serão usadas estão cadastradas e ativas. O mesmo produto pode ter condições comerciais diferentes por categoria.', icon: Tag },
  { n: 2, title: 'Monte o catálogo e os preços', desc: 'Cadastre nome, categoria e unidade. Use preço por categoria quando os valores variarem; o preço base não precisa ser compartilhado entre categorias. O ID interno é gerado pelo banco.', icon: Package },
  { n: 3, title: 'Importe a planilha com revisão', desc: 'Abra Importar Dados, envie a planilha e confira a prévia de produtos, categorias, medidas e preços antes de confirmar.', icon: FileText },
  { n: 4, title: 'Configure empresas e pedidos', desc: 'Cadastre a empresa cliente, confira seus dias e janela de pedido e valide itens, unidades e preços disponíveis antes de fechar o pedido.', icon: Users },
  { n: 5, title: 'Organize a entrega', desc: 'Na Logística, confira as entregas, atribua rota e motorista e acompanhe os status registrados. O mapa depende de haver transmissão de GPS.', icon: Route },
  { n: 6, title: 'Acompanhe pelo portal do cliente', desc: 'O cliente consulta o pedido no histórico e abre o rastreamento daquele pedido. A posição do motorista só aparece quando houver transmissão de GPS disponível.', icon: MapPin },
];

const CATALOG_STEPS = [
  { n: 1, title: 'ID do registro e código base são diferentes', desc: 'O ID interno do produto é criado pelo banco ao salvar ou importar. “ID do produto base” (productCode) é opcional e agrupa variantes relacionadas; não é a chave do registro.', icon: Hash },
  { n: 2, title: 'Preço base ou preço por categoria', desc: 'Se o produto tiver valores diferentes por categoria, selecione cada categoria e informe seu preço. Não use um preço único para substituir valores comerciais distintos.', icon: Tags },
  { n: 3, title: 'Importação da tabela de pedidos', desc: 'Em Importar Dados, carregue o XLS/XLSX e examine a prévia. Confira nome, categoria, unidade/medida e preço de cada variante antes de confirmar; categorias diferentes não devem ser mescladas.', icon: FileText },
  { n: 4, title: 'Confira o resultado no catálogo', desc: 'Depois de salvar ou importar, pesquise o produto na tela Produtos e verifique categoria e preço. Um item sem preço válido precisa ser completado antes de ser usado comercialmente.', icon: CheckCircle2 },
];

const CLARA_STEPS = [
  { n: 1, title: 'Pergunte com uma cidade', desc: 'Exemplo: “Qual o clima em Curitiba?” Para o dia seguinte: “Vai chover amanhã em Curitiba?”.', icon: Globe },
  { n: 2, title: 'Peça uma piada', desc: 'Exemplo: “Clara, me conta uma piada”. A resposta é curta e não depende dos pares cadastrados na Central Treinar Clara.', icon: Bot },
  { n: 3, title: 'Cadastre produto com confirmação', desc: 'Usuários internos autorizados podem iniciar “Criar produto”. A Clara solicita nome, categoria existente e unidade, apresenta o resumo e só cadastra após “confirmar”. Depois, configure o preço por categoria na tela Produtos.', icon: Package },
  { n: 4, title: 'Ensine respostas específicas', desc: 'Em Treinar Clara, cadastre pergunta e resposta com termos que as pessoas realmente usarão. Evite instruções genéricas, integrações não ativadas ou promessas de emissão fiscal real.', icon: Brain },
];

const GPS_TUTORIAL_STEPS = [
  {
    n: 1,
    icon: Map,
    title: 'Preparar as paradas antes da saída',
    desc: 'Confirme que cada pedido está ligado a uma entrega, à empresa/endereço corretos e a uma rota com sequência e motorista atribuídos. O painel Android mostra entregas atribuídas; pedidos sem entrega/atribuição não devem ser considerados prontos para expedição.',
  },
  {
    n: 2,
    icon: Route,
    title: 'Conferir rota e iniciar a jornada',
    desc: 'No VivaFrutaz Tracker Android, entre com a conta de motorista, atualize a rota do dia e confira endereço, janela e sequência. Inicie a jornada quando aplicável; a posição/ETA do cliente depende de rota ativa, paradas configuradas e GPS recente.',
  },
  {
    n: 3,
    icon: Navigation,
    title: 'Validar o GPS no aparelho',
    desc: 'Autorize a localização, que é necessária para o GPS. A permissão de notificações é opcional: se for negada, o rastreamento continua, mas o aviso do serviço pode não aparecer na barra de notificações. Confira no Tracker o estado do serviço, horário do último envio e fila pendente. Ações de status/entrega só são confirmadas após resposta do servidor.',
  },
  {
    n: 4,
    icon: CheckCircle2,
    title: 'Confirmar entregas na rota',
    desc: 'Na parada correta, toque “Entregue”, registre uma observação se necessário e aguarde a confirmação do servidor. O sistema grava checklist, horário e evento de auditoria; depois tenta atualizar a rota exibida no Android. Se a atualização falhar, use “Atualizar rota” quando houver conexão. O portal do cliente consulta o status atualizado periodicamente enquanto a tela de rastreamento está aberta. Assinatura e foto são comprovantes separados.',
  },
  {
    n: 5,
    icon: Truck,
    title: 'Registrar ocorrência e fechar a rota',
    desc: 'Quando não for possível entregar, registre a ocorrência na parada em vez de marcá-la como entregue. Revise as paradas pendentes e os comprovantes antes de encerrar a operação; o pedido só é finalizado automaticamente quando todas as entregas vinculadas estão terminais e o pedido está no estado operacional esperado (SHIPPED).',
  },
  {
    n: 6,
    icon: MapPin,
    title: 'Cliente consulta o próprio pedido',
    desc: 'A pessoa usuária da empresa entra no portal, abre o Histórico de Pedidos e seleciona “Rastrear” no pedido. A tela consulta apenas pedidos da empresa autenticada; atualiza periodicamente enquanto estiver aberta, mas não envia uma notificação automática de cada mudança.',
  },
];

export default function AdminTreinamento() {
  const [activeSection, setActiveSection] = useState<'guide' | 'catalog' | 'simulations' | 'gps' | 'clara' | 'modules' | 'faq'>('guide');

  const sections = [
    { key: 'guide' as const, label: 'Início Rápido', icon: Zap },
    { key: 'catalog' as const, label: 'Produtos e Preços', icon: Package },
    { key: 'simulations' as const, label: 'Simulação Comercial', icon: BarChart3 },
    { key: 'gps' as const, label: 'Entregas e Rastreamento', icon: Navigation },
    { key: 'clara' as const, label: 'Clara IA', icon: Bot },
    { key: 'modules' as const, label: 'Módulos do Sistema', icon: Layers },
    { key: 'faq' as const, label: 'Perguntas Frequentes', icon: Info },
  ];

  return (
    <Layout>
      <BackHeader fallback="/admin" breadcrumb={[{ label: "Treinamento" }]} />
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/25 flex-shrink-0">
            <GraduationCap className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Central de Treinamento</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Guias práticos dos fluxos reais do VivaFrutaz: catálogo, pedidos, entregas e Clara.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
          <strong>Estado atual:</strong> o módulo NF-e está em modo mock e o Financeiro permanece congelado. Não use essas áreas para emissão fiscal real, fechamento ou decisão financeira.
        </div>

        <div className="flex gap-2 flex-wrap">
          {sections.map(s => {
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setActiveSection(s.key)}
                data-testid={`tab-training-${s.key}`}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  activeSection === s.key
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                <Icon className="w-4 h-4" />
                {s.label}
              </button>
            );
          })}
        </div>

        {activeSection === 'guide' && (
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-5">
              <h2 className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-2 mb-2">
                <BookOpen className="w-5 h-5" /> Sobre o VivaFrutaz ERP
              </h2>
              <p className="text-sm text-emerald-700 dark:text-emerald-300/80">
                O VivaFrutaz organiza o catálogo de frutas e outros produtos, os pedidos das empresas clientes e as entregas. O catálogo pode ter preços por categoria; a equipe acompanha pedidos e rotas, e o cliente consulta o próprio rastreamento no portal.
              </p>
            </div>

            <h2 className="font-bold text-foreground text-lg">Primeiros Passos — Guia Rápido</h2>
            <div className="space-y-3">
              {QUICK_START_STEPS.map(step => {
                const Icon = step.icon;
                return (
                  <div key={step.n} className="flex items-start gap-4 p-4 border border-border/60 rounded-xl bg-card">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-primary">{step.n}</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className="w-4 h-4 text-muted-foreground" />
                        <span className="font-semibold text-sm text-foreground">{step.title}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{step.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeSection === 'catalog' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200">
              Cadastre cada variante na categoria correta. O sistema gera o ID interno do registro; preços podem variar por categoria e não precisam ser reduzidos a um preço base único.
            </div>
            {CATALOG_STEPS.map(step => {
              const Icon = step.icon;
              return (
                <div key={step.n} className="flex items-start gap-4 rounded-xl border border-border/60 bg-card p-4" data-testid={`catalog-step-${step.n}`}>
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <span className="text-sm font-bold text-primary">{step.n}</span>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold text-foreground">{step.title}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{step.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeSection === 'simulations' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-200">
              Em Simulação Comercial → Escopo, use a busca para localizar produtos pelo nome, categoria ou unidade. Selecione vários produtos, ajuste quantidade, preço e custo médio por produto e adicione as linhas ao dia escolhido.
            </div>
            <div className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">
              A média apresentada é ponderada por quantidade semanal (quantidade × frequência). Preços e custos médios são calculados separadamente por unidade, para não misturar, por exemplo, quilos e unidades. Cada item continua salvo separadamente com sua própria categoria, preço e custo; a média é apenas informativa e não altera os valores das linhas.
            </div>
          </div>
        )}

        {activeSection === 'gps' && (
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-cyan-50 to-blue-50 dark:from-cyan-950/20 dark:to-blue-950/20 border border-cyan-200 dark:border-cyan-800 rounded-xl p-5">
              <h2 className="font-bold text-cyan-800 dark:text-cyan-300 flex items-center gap-2 mb-2">
                <Navigation className="w-5 h-5" /> Entregas e Rastreamento
              </h2>
              <p className="text-sm text-cyan-700 dark:text-cyan-300/80">
                O fluxo liga pedido, entrega, rota/parada, motorista e posição GPS. O Android envia confirmação de entrega/ocorrência e posições GPS autenticadas ao backend; após uma resposta de sucesso, atualiza a rota local. O cliente consulta o status do pedido da própria empresa pelo portal, que atualiza enquanto a tela está aberta. A posição e a estimativa no mapa dependem de jornada, rota e coordenadas recentes.
              </p>
            </div>

            <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200">
              <strong>Cuidados operacionais:</strong> a localização é obrigatória para rastrear; notificações do Android são opcionais e sua ausência não bloqueia o serviço. A rota “hoje” usa a data de São Paulo; confirme a data e as paradas na operação. O APK versionado em releases continua anterior ao contrato GPS atual e não deve ser distribuído até gerar e validar uma nova versão. Avisos push dependem de VAPID, configuração do evento e permissão do cliente. Em pedidos divididos, o rastreamento mostra entrega parcial enquanto houver paradas em aberto; confira o status de todas as paradas.
            </div>

            <div className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">
              <strong className="text-foreground">Padrão operacional recomendado:</strong> validar pedido e endereço, separar e conferir quantidade/qualidade, sequenciar as paradas, atribuir motorista e veículo, conferir carga e condições de transporte, iniciar jornada/rastreamento, capturar prova de entrega e registrar exceções, depois reconciliar pendências e devoluções. O sistema oferece rotas, status, GPS e registro de assinatura/foto; separação, cadeia fria, notificação proativa ao cliente e conciliação de devoluções não foram confirmadas como fluxos integrados nesta inspeção.
            </div>

            <h2 className="font-bold text-foreground text-lg">Passo a Passo — GPS e Rotas</h2>
            <div className="space-y-3">
              {GPS_TUTORIAL_STEPS.map(step => {
                const Icon = step.icon;
                return (
                  <div key={step.n} className="flex items-start gap-4 p-4 border border-border/60 rounded-xl bg-card" data-testid={`gps-step-${step.n}`}>
                    <div className="w-8 h-8 rounded-lg bg-cyan-100 dark:bg-cyan-900/40 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-cyan-700 dark:text-cyan-300">{step.n}</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className="w-4 h-4 text-cyan-600" />
                        <span className="font-semibold text-sm text-foreground">{step.title}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{step.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 space-y-2">
              <p className="text-sm font-bold text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <Info className="w-4 h-4" /> Resolução de Problemas do GPS
              </p>
              {[
                { q: 'Quem pode acessar o GPS em tempo real?', a: 'LOGISTICS e COMERCIAL podem consultar o GPS dos motoristas das empresas atendidas sem selecionar uma empresa. O filtro opcional Empresa de trabalho limita a consulta a uma empresa específica. Contas vinculadas permanecem restritas à própria empresa, e apenas perfis autorizados podem ver as posições.' },
                { q: 'GPS não aparece no mapa', a: 'No Android, confirme permissão, serviço em primeiro plano, jornada/rota ativa, rede e horário do último envio. No painel web, confira a permissão do navegador e mantenha a tela ativa.' },
                { q: 'Posição desatualizada', a: 'Sem coordenadas recentes o mapa não consegue mostrar a posição; confira se o dispositivo ainda está compartilhando localização.' },
                { q: 'Cliente não vê o mapa', a: 'O rastreamento do pedido mostra status sem exigir que haja posição GPS. O mapa aparece somente quando existe uma transmissão disponível.' },
                { q: 'Rota não aparece no painel', a: 'Confira se o motorista está conectado e se as entregas foram atribuídas à rota e ao usuário corretos.' },
                { q: 'A rota do dia parece errada à noite', a: 'A seleção de “hoje” usa a data local de São Paulo. Confira também a data programada e as paradas atribuídas ao motorista.' },
              ].map((item, i) => (
                <div key={i} className="flex gap-2 text-sm">
                  <span className="text-amber-600 font-medium min-w-fit">•</span>
                  <span><span className="font-medium text-amber-800 dark:text-amber-300">{item.q}:</span> <span className="text-amber-700 dark:text-amber-400">{item.a}</span></span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeSection === 'modules' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Clique em cada módulo para expandir detalhes de funcionalidades, permissões e dicas de uso.
            </p>
            {MODULES.map(mod => <ModuleCard key={mod.id} mod={mod} />)}
          </div>
        )}

        {activeSection === 'clara' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900 dark:border-violet-800 dark:bg-violet-950/20 dark:text-violet-200">
              A Clara respeita o perfil conectado. Fluxos que alteram cadastros exigem permissão interna e confirmação antes de gravar.
            </div>
            {CLARA_STEPS.map(step => {
              const Icon = step.icon;
              return (
                <div key={step.n} className="flex items-start gap-4 rounded-xl border border-border/60 bg-card p-4" data-testid={`clara-step-${step.n}`}>
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/40">
                    <span className="text-sm font-bold text-violet-700 dark:text-violet-300">{step.n}</span>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <Icon className="h-4 w-4 text-violet-600" />
                      <span className="text-sm font-semibold text-foreground">{step.title}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{step.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeSection === 'faq' && (
          <div className="space-y-3">
            {[
              { q: 'Como importar produtos e preços da planilha?', a: 'Abra Importar Dados, carregue o arquivo XLS/XLSX e revise a prévia. Confira nome, categoria, unidade/medida e preço de cada variante antes de confirmar.' },
              { q: 'O ID do produto é o mesmo que o ID do produto base?', a: 'Não. O ID interno é gerado pelo banco para cada registro. O campo de produto base (productCode) é opcional e agrupa variantes relacionadas.' },
              { q: 'Preciso usar um preço base único?', a: 'Não. Quando o preço varia por categoria, informe o preço de cada categoria. Confirme que todas as categorias e valores da variante estão corretos.' },
              { q: 'Como o cliente acompanha o pedido?', a: 'No portal, abra o histórico e use Rastrear no pedido desejado. O status pode ser consultado; a posição no mapa depende de uma transmissão GPS disponível.' },
              { q: 'O cliente recebe aviso automático quando o status muda?', a: 'O sistema enfileira push de mudança de status para a empresa. Para receber, VAPID precisa estar configurado, o evento delivery_status habilitado e o usuário deve permitir notificações no dispositivo. O rastreamento do portal também se atualiza por consulta periódica enquanto aberto.' },
              { q: 'O que fazer quando o motorista toca em Entregue?', a: 'Aguardar a confirmação do servidor. O sistema grava a conclusão e o evento; se a chamada falhar, conferir novamente o status antes de considerar a parada concluída.' },
              { q: 'Posso distribuir o APK que está em releases?', a: 'Não sem validar. O repositório indica que o APK publicado é anterior ao contrato GPS atual; gere uma versão pelo código atual e valide login, GPS e confirmação de entrega em aparelho de teste.' },
              { q: 'Por que não aparece a posição do motorista?', a: 'Confira permissão de localização do navegador, conexão do dispositivo e rastreamento ativo. Sem coordenadas recentes, a tela não consegue mostrar a posição no mapa.' },
              { q: 'A NF-e emitida pela tela vale fiscalmente?', a: 'Não enquanto o módulo estiver em modo mock. O retorno simulado não autoriza documento na SEFAZ; não use DANFE, XML ou protocolo mock como comprovante fiscal.' },
              { q: 'Posso usar os valores do Financeiro para fechar o caixa?', a: 'Não. O módulo Financeiro está congelado. Aguarde a liberação e validação antes de usar os dados para fechamento ou decisões.' },
              { q: 'Como treinar a Clara?', a: 'Na área Treinar Clara, cadastre pares de pergunta e resposta concretos, com termos que as pessoas usarão. Evite respostas genéricas ou promessas sobre recursos simulados.' },
            ].map((item, i) => (
              <div key={i} className="border border-border/60 rounded-xl p-4 bg-card">
                <p className="font-semibold text-sm text-foreground flex items-center gap-2 mb-2">
                  <Info className="w-4 h-4 text-primary flex-shrink-0" />
                  {item.q}
                </p>
                <p className="text-sm text-muted-foreground pl-6">{item.a}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
