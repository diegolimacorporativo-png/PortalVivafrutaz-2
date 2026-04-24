import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Receipt, Save, Building2, MapPin, FileText, Settings2, ShieldCheck, AlertCircle, CheckCircle2, Phone
} from 'lucide-react';

const REGIME_OPTIONS = [
  { value: 'simples_nacional', label: 'Simples Nacional' },
  { value: 'lucro_presumido', label: 'Lucro Presumido' },
  { value: 'lucro_real', label: 'Lucro Real' },
  { value: 'mei', label: 'MEI' },
];

const AMBIENTE_OPTIONS = [
  { value: 'homologacao', label: 'Homologação (Testes)' },
  { value: 'producao', label: 'Produção' },
];

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border/50 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border/30">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <h2 className="font-bold text-foreground text-sm">{title}</h2>
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function FiscalConfigPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAllowed = user?.role === 'ADMIN' || user?.role === 'DIRECTOR' || user?.role === 'DEVELOPER';

  const [form, setForm] = useState({
    companyName: '',
    fantasyName: '',
    cnpj: '',
    stateRegistration: '',
    address: '',
    addressNumber: '',
    neighborhood: '',
    city: '',
    state: '',
    cep: '',
    phone: '',
    defaultCfop: '5102',
    defaultNatureza: 'Venda de mercadoria adquirida',
    regimeTributario: 'simples_nacional',
    aliquotaPadrao: '0',
    ambienteFiscal: 'homologacao',
    informacoesAdicionais: '',
  });

  const { data: config, isLoading } = useQuery<any>({
    queryKey: ['/api/company-config'],
    queryFn: async () => {
      const res = await fetch('/api/company-config', { credentials: 'include' });
      if (!res.ok) return {};
      return res.json();
    },
  });

  useEffect(() => {
    if (!config) return;
    setForm({
      companyName: config.companyName || '',
      fantasyName: config.fantasyName || '',
      cnpj: config.cnpj || '',
      stateRegistration: config.stateRegistration || '',
      address: config.address || '',
      addressNumber: config.addressNumber || '',
      neighborhood: config.neighborhood || '',
      city: config.city || '',
      state: config.state || '',
      cep: config.cep || '',
      phone: config.phone || '',
      defaultCfop: config.defaultCfop || '5102',
      defaultNatureza: config.defaultNatureza || 'Venda de mercadoria adquirida',
      regimeTributario: config.regimeTributario || 'simples_nacional',
      aliquotaPadrao: config.aliquotaPadrao || '0',
      ambienteFiscal: config.ambienteFiscal || 'homologacao',
      informacoesAdicionais: config.informacoesAdicionais || '',
    });
  }, [config]);

  const mutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest('PATCH', '/api/company-config', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/company-config'] });
      toast({ title: 'Configurações fiscais salvas com sucesso' });
    },
    onError: () => toast({ title: 'Erro ao salvar configurações', variant: 'destructive' }),
  });

  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAllowed) return;
    mutation.mutate(form);
  };

  const isProducao = form.ambienteFiscal === 'producao';

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Receipt className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Configurações Fiscais</h1>
            <p className="text-sm text-muted-foreground">Dados da empresa emissora, CFOP e regime tributário</p>
          </div>
        </div>
        {isAllowed && (
          <Button type="submit" disabled={mutation.isPending} data-testid="button-save-fiscal-config"
            className="flex items-center gap-2">
            <Save className="w-4 h-4" />
            {mutation.isPending ? 'Salvando...' : 'Salvar Configurações'}
          </Button>
        )}
      </div>

      {!isAllowed && (
        <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/20 rounded-xl p-4">
          <ShieldCheck className="w-5 h-5 text-destructive flex-shrink-0" />
          <p className="text-sm text-destructive font-medium">Apenas administradores e diretores podem editar as configurações fiscais.</p>
        </div>
      )}

      {isProducao && (
        <div className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl p-4">
          <AlertCircle className="w-5 h-5 text-orange-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-orange-700">Ambiente de Produção ativo</p>
            <p className="text-xs text-orange-600">As notas fiscais emitidas terão validade legal. Certifique-se de que todos os dados estão corretos.</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Carregando configurações...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Dados da empresa */}
          <Section icon={Building2} title="Dados da Empresa Emissora">
            <Field label="Razão Social">
              <Input data-testid="input-fiscal-company-name" value={form.companyName} onChange={e => set('companyName', e.target.value)} disabled={!isAllowed} placeholder="Ex: VivaFrutaz Comércio de Frutas Ltda" />
            </Field>
            <Field label="Nome Fantasia">
              <Input data-testid="input-fiscal-fantasy-name" value={form.fantasyName} onChange={e => set('fantasyName', e.target.value)} disabled={!isAllowed} placeholder="Ex: VivaFrutaz" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="CNPJ">
                <Input data-testid="input-fiscal-cnpj" value={form.cnpj} onChange={e => set('cnpj', e.target.value)} disabled={!isAllowed} placeholder="00.000.000/0000-00" />
              </Field>
              <Field label="Inscrição Estadual">
                <Input data-testid="input-fiscal-state-reg" value={form.stateRegistration} onChange={e => set('stateRegistration', e.target.value)} disabled={!isAllowed} placeholder="000.000.000.000" />
              </Field>
            </div>
          </Section>

          {/* Endereço */}
          <Section icon={MapPin} title="Endereço da Empresa Emissora">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label="Logradouro">
                  <Input data-testid="input-fiscal-address" value={form.address} onChange={e => set('address', e.target.value)} disabled={!isAllowed} placeholder="Rua, Av., etc." />
                </Field>
              </div>
              <Field label="Número">
                <Input data-testid="input-fiscal-address-number" value={form.addressNumber} onChange={e => set('addressNumber', e.target.value)} disabled={!isAllowed} placeholder="100" />
              </Field>
            </div>
            <Field label="Bairro">
              <Input data-testid="input-fiscal-neighborhood" value={form.neighborhood} onChange={e => set('neighborhood', e.target.value)} disabled={!isAllowed} placeholder="Centro" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cidade">
                <Input data-testid="input-fiscal-city" value={form.city} onChange={e => set('city', e.target.value)} disabled={!isAllowed} placeholder="São Paulo" />
              </Field>
              <Field label="Estado (UF)">
                <Input data-testid="input-fiscal-state" value={form.state} onChange={e => set('state', e.target.value)} disabled={!isAllowed} placeholder="SP" maxLength={2} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="CEP">
                <Input data-testid="input-fiscal-cep" value={form.cep} onChange={e => set('cep', e.target.value)} disabled={!isAllowed} placeholder="00000-000" />
              </Field>
              <Field label="Telefone">
                <Input data-testid="input-fiscal-phone" value={form.phone} onChange={e => set('phone', e.target.value)} disabled={!isAllowed} placeholder="(11) 99999-9999" />
              </Field>
            </div>
          </Section>

          {/* Dados fiscais */}
          <Section icon={FileText} title="Configuração Fiscal Padrão">
            <div className="grid grid-cols-2 gap-3">
              <Field label="CFOP Padrão" hint="Código Fiscal de Operações e Prestações">
                <Input data-testid="input-fiscal-cfop" value={form.defaultCfop} onChange={e => set('defaultCfop', e.target.value)} disabled={!isAllowed} placeholder="5102" maxLength={4} />
              </Field>
              <Field label="Alíquota Padrão (%)" hint="Percentual padrão para cálculo">
                <Input data-testid="input-fiscal-aliquota" type="number" step="0.01" min="0" max="100" value={form.aliquotaPadrao} onChange={e => set('aliquotaPadrao', e.target.value)} disabled={!isAllowed} placeholder="0.00" />
              </Field>
            </div>
            <Field label="Natureza da Operação">
              <Input data-testid="input-fiscal-natureza" value={form.defaultNatureza} onChange={e => set('defaultNatureza', e.target.value)} disabled={!isAllowed} placeholder="Venda de mercadoria adquirida" />
            </Field>
            <Field label="Informações Adicionais" hint="Texto livre exibido no rodapé da NF-e (ex: tributação, observações)">
              <Textarea
                data-testid="input-fiscal-info-adicionais"
                value={form.informacoesAdicionais}
                onChange={e => set('informacoesAdicionais', e.target.value)}
                disabled={!isAllowed}
                placeholder="Ex: Documento emitido por ME optante pelo Simples Nacional. Não gera direito a crédito fiscal de IPI."
                rows={3}
                className="resize-none text-sm"
              />
            </Field>
            <Field label="Regime Tributário">
              <select
                data-testid="select-fiscal-regime"
                value={form.regimeTributario}
                onChange={e => set('regimeTributario', e.target.value)}
                disabled={!isAllowed}
                className="w-full px-3 py-2 text-sm border border-input rounded-xl bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
              >
                {REGIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </Section>

          {/* Ambiente */}
          <Section icon={Settings2} title="Ambiente de Emissão">
            <p className="text-xs text-muted-foreground -mt-1">Define se as NFs geradas têm validade legal ou são apenas para testes.</p>
            <div className="space-y-3">
              {AMBIENTE_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    form.ambienteFiscal === opt.value
                      ? opt.value === 'producao'
                        ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/20'
                        : 'border-primary/50 bg-primary/5'
                      : 'border-border/50 hover:bg-muted/30'
                  } ${!isAllowed ? 'opacity-60 cursor-not-allowed' : ''}`}
                  data-testid={`radio-ambiente-${opt.value}`}
                >
                  <input
                    type="radio"
                    name="ambiente"
                    value={opt.value}
                    checked={form.ambienteFiscal === opt.value}
                    onChange={() => set('ambienteFiscal', opt.value)}
                    disabled={!isAllowed}
                    className="accent-primary"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-foreground">{opt.label}</p>
                    {opt.value === 'homologacao' && (
                      <p className="text-xs text-muted-foreground">Ideal para testes. As notas não têm validade fiscal.</p>
                    )}
                    {opt.value === 'producao' && (
                      <p className="text-xs text-orange-600 font-medium">Notas com validade legal. Use somente quando pronto para emissão real.</p>
                    )}
                  </div>
                  {form.ambienteFiscal === opt.value && (
                    <CheckCircle2 className={`w-4 h-4 flex-shrink-0 ${opt.value === 'producao' ? 'text-orange-500' : 'text-primary'}`} />
                  )}
                </label>
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* Summary card */}
      {!isLoading && (
        <div className="bg-muted/30 border border-border/50 rounded-2xl p-4">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">Resumo das Configurações Ativas</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'CNPJ', value: form.cnpj || '—' },
              { label: 'CFOP Padrão', value: form.defaultCfop || '5102' },
              { label: 'Regime', value: REGIME_OPTIONS.find(r => r.value === form.regimeTributario)?.label || '—' },
              { label: 'Ambiente', value: form.ambienteFiscal === 'producao' ? '🟠 Produção' : '🔵 Homologação' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-card rounded-xl p-3 border border-border/30">
                <p className="text-[10px] text-muted-foreground font-medium mb-1">{label}</p>
                <p className="text-sm font-bold text-foreground truncate">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}
