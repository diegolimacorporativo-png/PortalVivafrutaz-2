import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, User, Settings, Bot, Shield } from 'lucide-react';

const TestClaraPage: React.FC = () => {
  const [status, setStatus] = useState<'Ativa' | 'Inativa'>('Ativa');
  const [version, setVersion] = useState('1.0.0');
  const [user, setUser] = useState('Não logado');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [functions, setFunctions] = useState<string[]>([]);

  useEffect(() => {
    // Simular carregamento de dados
    setVersion('1.2.3');
    setUser('Admin Teste');
    setPermissions(['Chat livre', 'Criar tarefas', 'Exportar dados', 'Gerenciar usuários']);
    setFunctions(['Responder chat', 'Contar piadas', 'Criar tarefas', 'Ensinar módulos']);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-800 mb-2">
            Status da Clara IA
          </h1>
          <p className="text-gray-600">Página de diagnóstico e monitoramento</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Status */}
          <Card className="md:col-span-2 lg:col-span-1">
            <CardHeader className="flex flex-row items-center space-y-0 pb-2">
              {status === 'Ativa' ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <XCircle className="h-5 w-5 text-red-500" />
              )}
              <CardTitle className="ml-2">Status</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={status === 'Ativa' ? 'default' : 'destructive'} className="text-lg px-3 py-1">
                {status}
              </Badge>
            </CardContent>
          </Card>

          {/* Versão */}
          <Card>
            <CardHeader className="flex flex-row items-center space-y-0 pb-2">
              <Settings className="h-5 w-5 text-blue-500" />
              <CardTitle className="ml-2">Versão</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-blue-600">{version}</p>
            </CardContent>
          </Card>

          {/* Usuário */}
          <Card>
            <CardHeader className="flex flex-row items-center space-y-0 pb-2">
              <User className="h-5 w-5 text-purple-500" />
              <CardTitle className="ml-2">Usuário</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-medium">{user}</p>
            </CardContent>
          </Card>

          {/* Funções */}
          <Card className="md:col-span-2">
            <CardHeader className="flex flex-row items-center space-y-0 pb-2">
              <Bot className="h-5 w-5 text-green-500" />
              <CardTitle className="ml-2">Funções da IA</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {functions.map((func, index) => (
                  <Badge key={index} variant="outline" className="justify-start">
                    <CheckCircle className="h-3 w-3 mr-1 text-green-500" />
                    {func}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Permissões */}
          <Card className="md:col-span-2 lg:col-span-1">
            <CardHeader className="flex flex-row items-center space-y-0 pb-2">
              <Shield className="h-5 w-5 text-orange-500" />
              <CardTitle className="ml-2">Permissões</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {permissions.map((perm, index) => (
                  <Badge key={index} variant="secondary" className="block text-left">
                    {perm}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 text-center">
          <Button
            onClick={() => window.location.href = '/'}
            className="mr-4"
          >
            Voltar ao Sistema
          </Button>
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
          >
            Atualizar Status
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TestClaraPage;