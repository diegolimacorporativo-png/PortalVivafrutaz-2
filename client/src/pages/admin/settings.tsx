import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Senha atual é obrigatória'),
    newPassword: z.string().min(8, 'A nova senha deve ter pelo menos 8 caracteres'),
    confirmPassword: z.string().min(1, 'Confirmação de senha é obrigatória'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'As senhas não coincidem',
  });

type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

const ROLE_LABELS: Record<string, string> = {
  MASTER: 'Master',
  ADMIN: 'Administrador',
  DIRECTOR: 'Diretor',
  DEVELOPER: 'Desenvolvedor',
  OPERATIONS_MANAGER: 'Gerente de Operações',
  FINANCEIRO: 'Financeiro',
  LOGISTICS: 'Logística',
  PURCHASE_MANAGER: 'Compras',
  NUTRICIONISTA: 'Nutricionista',
  MOTORISTA: 'Motorista',
};

export default function AdminSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [changed, setChanged] = useState(false);

  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: ChangePasswordValues) => {
      const res = await apiRequest('POST', '/api/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || 'Erro ao alterar senha');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Senha alterada com sucesso', description: 'Sua senha foi atualizada.' });
      form.reset();
      setChanged(true);
    },
    onError: (err: Error) => {
      toast({
        title: 'Erro ao alterar senha',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const onSubmit = (values: ChangePasswordValues) => {
    setChanged(false);
    mutation.mutate(values);
  };

  return (
    <div className="max-w-xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Minha Conta</h1>
        <p className="text-sm text-muted-foreground mt-1">Gerencie suas informações e segurança</p>
      </div>

      {/* User info card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Informações do Usuário</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">E-mail</span>
            <span data-testid="text-user-email" className="text-sm font-medium">
              {user?.email ?? '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Perfil</span>
            <Badge data-testid="badge-user-role" variant="secondary">
              {ROLE_LABELS[user?.role ?? ''] ?? user?.role ?? '—'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Change password card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Alterar Senha
          </CardTitle>
          <CardDescription>
            A nova senha deve ter pelo menos 8 caracteres e ser diferente da atual.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {changed && (
            <div
              data-testid="status-password-changed"
              className="flex items-center gap-2 mb-4 p-3 rounded-md bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 text-sm"
            >
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              Senha alterada com sucesso.
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Senha atual</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          data-testid="input-current-password"
                          type={showCurrent ? 'text' : 'password'}
                          placeholder="••••••••"
                          autoComplete="current-password"
                          {...field}
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setShowCurrent((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          aria-label={showCurrent ? 'Ocultar senha' : 'Mostrar senha'}
                        >
                          {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nova senha</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          data-testid="input-new-password"
                          type={showNew ? 'text' : 'password'}
                          placeholder="••••••••"
                          autoComplete="new-password"
                          {...field}
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setShowNew((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          aria-label={showNew ? 'Ocultar senha' : 'Mostrar senha'}
                        >
                          {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirmar nova senha</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          data-testid="input-confirm-password"
                          type={showConfirm ? 'text' : 'password'}
                          placeholder="••••••••"
                          autoComplete="new-password"
                          {...field}
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setShowConfirm((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          aria-label={showConfirm ? 'Ocultar senha' : 'Mostrar senha'}
                        >
                          {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                data-testid="button-change-password"
                type="submit"
                className="w-full"
                disabled={mutation.isPending}
              >
                {mutation.isPending ? 'Alterando...' : 'Alterar senha'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
