import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { Badge } from '@/components/ui/badge';
import {
  BookOpen, ChevronDown, ChevronRight, Truck, Receipt, Brain,
  Users, ShoppingCart, BarChart3, Package, DollarSign, Settings,
  MapPin, Star, Zap, Shield, CheckCircle, Info, FileText,
  GraduationCap, Bot, Megaphone, Route, Warehouse, ClipboardList,
  Activity, Layers, Globe, Navigation, Map, CheckCircle2
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
    ],
    access: ['ADMIN', 'DIRECTOR'],
    tips: [
      'Use a busca por CEP para localizar empresas rapidamente.',
      'Configure as janelas de entrega corretamente para que o sistema calcule rotas.',
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
    ],
    access: ['ADMIN', 'OPERATIONS_MANAGER', 'DIRECTOR', 'LOGISTICS'],
  },
  {
    id: 'logistica',
    title: 'Logística & Rotas',
    icon: Truck,
    category: 'Logística',
    color: 'text-teal-600',
    description: 'Planejamento e execução de rotas de entrega. Integrado com motoristas, veículos e GPS em tempo real.',
    features: [
      'Criação e otimização de rotas',
      'Atribuição de motoristas e veículos',
      'Mapa de entregas com visualização em tempo real',
      'Rastreamento GPS dos motoristas',
      'Checklist de confirmação de entrega',
      'Controle de status por entrega',
    ],
    access: ['ADMIN', 'DIRECTOR', 'LOGISTICS', 'OPERATIONS_MANAGER'],
    tips: ['Sempre atribua um veículo antes de iniciar a rota para evitar alertas operacionais.'],
  },
  {
    id: 'painel-motorista',
    title: 'Painel do Motorista',
    icon: Route,
    category: 'Logística',
    color: 'text-cyan-600',
    description: 'Interface simplificada para motoristas confirmarem entregas, registrarem observações e transmitirem posição GPS.',
    features: [
      'Lista de entregas do dia em ordem de rota',
      'Confirmação de entrega com observação',
      'Checklist: veículo, carga e pedidos',
      'Transmissão de posição GPS automática',
      'Histórico de entregas do turno',
    ],
    access: ['MOTORISTA', 'LOGISTICS', 'ADMIN'],
    tips: ['O motorista deve acessar no início do turno para transmitir posição GPS continuamente.'],
  },
  {
    id: 'financeiro',
    title: 'Financeiro & Contas',
    icon: DollarSign,
    category: 'Financeiro',
    color: 'text-green-600',
    description: 'Controle financeiro completo: faturamento, contas a pagar/receber, fluxo de caixa e relatórios.',
    features: [
      'Painel financeiro com MRR, ARR e inadimplência',
      'Contas a pagar e a receber',
      'Integração bancária Itaú',
      'Boleto e PIX automatizados',
      'Relatórios por período e empresa',
    ],
    access: ['ADMIN', 'FINANCEIRO', 'DIRECTOR'],
  },
  {
    id: 'nfe',
    title: 'NF-e / Nota Fiscal',
    icon: Receipt,
    category: 'Financeiro',
    color: 'text-emerald-600',
    description: 'Emissão de Notas Fiscais eletrônicas padrão NF-e 4.00. Integrado com SEFAZ via certificado digital A1.',
    features: [
      'Emissão de NF-e 4.00 com SEFAZ',
      'Preenchimento automático de código IBGE via CEP',
      'Diagnóstico inteligente de erros de rejeição',
      'Cancelamento e carta de correção',
      'Download de DANFE em PDF e XML',
      'Histórico completo de notas emitidas',
    ],
    access: ['ADMIN', 'FINANCEIRO', 'DIRECTOR'],
    tips: [
      'Configure o certificado digital em Configurações Fiscais antes de emitir.',
      'Use o Diagnóstico Inteligente para resolver erros de rejeição automaticamente.',
    ],
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
    description: 'Central de inteligência artificial que analisa o sistema e detecta riscos operacionais antes que se tornem problemas.',
    features: [
      'Análise preditiva automática em tempo real',
      'Alertas por severidade: Crítico, Alto, Médio, Baixo',
      'Detecção de estoque zerado, rotas sem veículo, falhas de segurança',
      'Botão "Corrigir Automaticamente" para correção inteligente',
      'Categorias: Estoque, Clientes, Produtos, Logística, Sistema',
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
    description: 'Painel SaaS para gerenciamento de assinaturas, planos, faturamento recorrente e métricas de negócio.',
    features: [
      'MRR (Receita Mensal Recorrente) e ARR (Anual)',
      'Gestão de planos: Free, Starter, Pro, Enterprise',
      'Assinaturas por empresa com status e vencimento',
      'Loja de Módulos adicionais',
      'White Label por empresa (logo, cores)',
      'Controle de GPS por plano',
    ],
    access: ['MASTER', 'ADMIN', 'DIRECTOR'],
  },
  {
    id: 'usuarios',
    title: 'Usuários & Permissões',
    icon: Shield,
    category: 'Sistema',
    color: 'text-red-600',
    description: 'Gerenciamento de usuários internos com controle granular de permissões por role e por aba do sistema.',
    features: [
      'Roles: MASTER, ADMIN, DIRECTOR, DEVELOPER, LOGISTICS, FINANCEIRO, etc.',
      'Controle de acesso por tab do sistema',
      'Bloqueio automático após múltiplas tentativas de login falhas',
      'Auditoria de ações do sistema',
    ],
    access: ['ADMIN', 'DEVELOPER', 'DIRECTOR'],
  },
  {
    id: 'marketplace',
    title: 'Loja de Módulos',
    icon: Globe,
    category: 'SaaS',
    color: 'text-pink-600',
    description: 'Marketplace de módulos adicionais. Cada empresa pode ativar módulos extras além do plano base.',
    features: [
      '10+ módulos disponíveis: GPS, NF-e, IA, Financeiro, etc.',
      'Ativação por empresa individualmente',
      'Controle de versão e changelog de cada módulo',
      'Integração automática com o plano da empresa',
    ],
    access: ['MASTER', 'ADMIN', 'DIRECTOR'],
  },
];

const PLANS = [
  { name: 'Free', price: 'R$ 0/mês', color: 'bg-gray-100 text-gray-700 border-gray-200', features: ['1 usuário', '50 produtos', '100 pedidos/mês', 'GPS desativado', 'Suporte básico'] },
  { name: 'Starter', price: 'R$ 199/mês', color: 'bg-blue-50 text-blue-700 border-blue-200', features: ['5 usuários', '200 produtos', '500 pedidos/mês', 'GPS básico', 'NF-e incluído', 'Suporte normal'] },
  { name: 'Pro', price: 'R$ 499/mês', color: 'bg-purple-50 text-purple-700 border-purple-200', features: ['20 usuários', '1000 produtos', 'Pedidos ilimitados', 'GPS completo', 'IA Operacional', 'Suporte prioritário', 'API integração'] },
  { name: 'Enterprise', price: 'Sob consulta', color: 'bg-amber-50 text-amber-700 border-amber-200', features: ['Usuários ilimitados', 'Produtos ilimitados', 'Pedidos ilimitados', 'GPS + análise IA', 'White Label', 'SLA dedicado', 'Integração customizada'] },
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
  { n: 1, title: 'Cadastrar Empresas', desc: 'Vá em Empresas → Nova Empresa. Preencha CNPJ, endereço e configure os dias de entrega permitidos.', icon: Users },
  { n: 2, title: 'Configurar Produtos', desc: 'Em Produtos, cadastre seu catálogo com preços, custo e estoque mínimo.', icon: Package },
  { n: 3, title: 'Criar Pedidos', desc: 'Em Pedidos → Novo Pedido, selecione a empresa, data e itens. O sistema valida janelas de entrega automaticamente.', icon: ShoppingCart },
  { n: 4, title: 'Planejar Rota', desc: 'Em Logística, agrupe os pedidos do dia em uma rota. Atribua motorista e veículo.', icon: Route },
  { n: 5, title: 'Executar Entrega', desc: 'O motorista acessa o Painel do Motorista, confirma cada entrega com observação e transmite GPS.', icon: Truck },
  { n: 6, title: 'Faturar', desc: 'Emita a NF-e em Gestão de Notas Fiscais. O sistema preenche dados automaticamente a partir do pedido.', icon: Receipt },
];

const GPS_TUTORIAL_STEPS = [
  {
    n: 1,
    icon: Map,
    title: 'Acessar a aba GPS / Painel do Motorista',
    desc: 'No menu lateral, clique em "Painel do Motorista". A página mostra suas entregas do dia e os dois modos de visualização: Lista e Mapa GPS.',
  },
  {
    n: 2,
    icon: Route,
    title: 'Ver e adicionar rotas de entrega',
    desc: 'Para adicionar rotas, acesse "Logística" → aba "Rotas" → clique em "+ Nova Rota". Defina nome, motorista e veículo. As paradas de CEP são gerenciadas pelo botão "Gerenciar Paradas".',
  },
  {
    n: 3,
    icon: Navigation,
    title: 'Iniciar rastreamento GPS',
    desc: 'Acesse o Painel do Motorista e clique em "Mapa GPS". O sistema solicita permissão de localização do navegador. Aceite para transmitir sua posição em tempo real. Sua localização atual aparece no mapa.',
  },
  {
    n: 4,
    icon: CheckCircle2,
    title: 'Confirmar entregas na rota',
    desc: 'Na visão "Lista", clique em cada entrega, expanda o card e use o botão "Confirmar Entrega". Adicione uma observação se necessário. O sistema marca automaticamente como "Entregue".',
  },
  {
    n: 5,
    icon: Truck,
    title: 'Testar funcionamento do GPS',
    desc: 'Para verificar se o GPS está funcionando: acesse Painel do Motorista → Mapa GPS. Se o mapa mostrar um marcador azul com sua posição, o GPS está ativo. Se não aparecer, verifique as permissões do navegador (cadeado na barra de endereço) e se o plano da empresa inclui GPS.',
  },
];

export default function AdminTreinamento() {
  const [activeSection, setActiveSection] = useState<'guide' | 'gps' | 'modules' | 'plans' | 'faq'>('guide');

  const sections = [
    { key: 'guide' as const, label: 'Início Rápido', icon: Zap },
    { key: 'gps' as const, label: 'Tutorial GPS', icon: Navigation },
    { key: 'modules' as const, label: 'Módulos do Sistema', icon: Layers },
    { key: 'plans' as const, label: 'Planos SaaS', icon: Star },
    { key: 'faq' as const, label: 'Perguntas Frequentes', icon: Info },
  ];

  return (
    <Layout>
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/25 flex-shrink-0">
            <GraduationCap className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Central de Treinamento</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Guia completo do sistema VivaFrutaz ERP — aprenda a usar todas as funcionalidades.
            </p>
          </div>
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
                O VivaFrutaz é um sistema ERP B2B completo para distribuidores de alimentos. Ele integra gestão de clientes, pedidos, logística, financeiro, NF-e, GPS e inteligência artificial em uma única plataforma multi-tenant SaaS.
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

        {activeSection === 'gps' && (
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-cyan-50 to-blue-50 dark:from-cyan-950/20 dark:to-blue-950/20 border border-cyan-200 dark:border-cyan-800 rounded-xl p-5">
              <h2 className="font-bold text-cyan-800 dark:text-cyan-300 flex items-center gap-2 mb-2">
                <Navigation className="w-5 h-5" /> Tutorial de GPS e Rastreamento
              </h2>
              <p className="text-sm text-cyan-700 dark:text-cyan-300/80">
                Siga os passos abaixo para usar o GPS e gerenciar rotas no Painel do Motorista. O GPS transmite sua localização em tempo real no mapa.
              </p>
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
                { q: 'GPS não aparece no mapa', a: 'Clique no cadeado na barra de endereço do navegador e permita "Localização".' },
                { q: 'Posição desatualizada', a: 'Recarregue a página ou aguarde alguns segundos. O GPS atualiza automaticamente.' },
                { q: 'Plano não inclui GPS', a: 'O administrador pode ativar o GPS manualmente em SaaS → Configurar Empresa.' },
                { q: 'Rota não aparece no painel', a: 'Verifique se as entregas foram criadas para a data de hoje e atribuídas ao seu usuário.' },
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

        {activeSection === 'plans' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Escolha o plano ideal para cada empresa cliente no SaaS.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PLANS.map(plan => (
                <div key={plan.name} className={`border rounded-xl p-5 ${plan.color}`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-lg">{plan.name}</h3>
                    <span className="font-semibold text-sm">{plan.price}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
              <p className="text-sm text-blue-700 dark:text-blue-300 font-medium flex items-center gap-2">
                <Info className="w-4 h-4" /> O GPS pode ser liberado manualmente pelo administrador mesmo que o plano não inclua, através de Gestão SaaS → Configurar empresa.
              </p>
            </div>
          </div>
        )}

        {activeSection === 'faq' && (
          <div className="space-y-3">
            {[
              { q: 'Como emitir uma NF-e?', a: 'Acesse Emissão de NF-e, selecione o pedido, verifique os dados do emitente e destinatário, e clique em Emitir. O sistema preenche automaticamente o código IBGE via CEP.' },
              { q: 'O motorista não está transmitindo GPS. O que fazer?', a: 'Verifique se o plano da empresa inclui GPS, se o GPS está habilitado manualmente, e se o motorista está acessando o Painel do Motorista (que transmite posição automaticamente).' },
              { q: 'Como configurar janelas de entrega por empresa?', a: 'Em Empresas → editar empresa → aba Entrega, defina os dias da semana e horários permitidos para cada empresa.' },
              { q: 'Como bloquear um usuário?', a: 'Em Usuários do Sistema, localize o usuário e desative sua conta. O sistema também bloqueia automaticamente após 5 tentativas de login falhas.' },
              { q: 'Como adicionar um módulo extra para uma empresa?', a: 'Acesse Loja de Módulos (Marketplace), selecione o módulo desejado e associe à empresa. A empresa passa a ter acesso imediato.' },
              { q: 'O que é White Label?', a: 'White Label permite personalizar logo, cores e identidade visual do sistema por empresa. Acesse SaaS → White Label para configurar.' },
              { q: 'Como treinar a IA Clara?', a: 'Em Treinar Clara (menu Inteligência), adicione pares de pergunta e resposta para que a IA aprenda sobre seu negócio.' },
              { q: 'Como ver o relatório financeiro?', a: 'Acesse Painel Financeiro para ver faturamento, contas a receber e fluxo de caixa. O Painel Financeiro SaaS mostra MRR/ARR do negócio de software.' },
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
