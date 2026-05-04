import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

type LoginInput = z.infer<typeof api.auth.login.input>;

export function useAuth() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const meQuery = useQuery({
    queryKey: [api.auth.me.path],
    queryFn: async () => {
      const res = await fetch(api.auth.me.path, { credentials: "include" });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error("Falha ao buscar usuário");
      return api.auth.me.responses[200].parse(await res.json());
    },
    retry: false,
    staleTime: 60000,
  });

  const loginMutation = useMutation({
    mutationFn: async (data: LoginInput) => {
      // Attach deviceId so the session is bound to this device from the start.
      // Sanitize to match the same rules as fetchWithAuth (alphanumeric + - _).
      let rawDeviceId = localStorage.getItem("device_id") || "web-client";
      const deviceId = rawDeviceId.replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 50) || "web-client";
      const res = await fetch(api.auth.login.path, {
        method: api.auth.login.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, deviceId }),
        credentials: "include",
      });

      // FASE SENHA TEMPORÁRIA — backend returns 403 when mustChangePassword is true.
      // Redirect to /change-password instead of surfacing an error to the user.
      if (res.status === 403) {
        const body = await res.json();
        if (body?.error === "PASSWORD_CHANGE_REQUIRED") {
          sessionStorage.setItem("change_password_email", body.email ?? data.email ?? "");
          setLocation("/change-password");
          return null as any;
        }
        throw new Error(body?.message || "Acesso negado.");
      }

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Falha no login");
      }
      return api.auth.login.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      // data is null when redirected to /change-password — nothing to do.
      if (!data) return;
      queryClient.setQueryData([api.auth.me.path], data);
      toast({ title: "Bem-vindo ao VivaFrutaz!" });
      const savedRedirect = sessionStorage.getItem("redirect_after_login");
      if (savedRedirect) {
        sessionStorage.removeItem("redirect_after_login");
        setLocation(savedRedirect);
      } else {
        setLocation("/");
      }
    },
    onError: (error: Error) => {
      toast({ title: "Falha no Acesso", description: error.message, variant: "destructive" });
    }
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await fetch(api.auth.logout.path, { method: "POST", credentials: "include" });
    },
    onSuccess: () => {
      queryClient.setQueryData([api.auth.me.path], null);
      queryClient.clear();
      setLocation("/login");
    }
  });

  const authData = meQuery.data;

  console.warn("[AUTH_STATE]", {
    user: authData?.user ?? null,
    company: authData?.company ?? null,
    isPending: meQuery.isPending,
    isFetching: meQuery.isFetching,
    isError: meQuery.isError,
    dataUpdatedAt: meQuery.dataUpdatedAt,
  });

  return {
    user: authData?.user,
    company: authData?.company,
    isAuthenticated: !!authData?.user || !!authData?.company,
    isStaff: !!authData?.user,
    isClient: !!authData?.company,
    role: authData?.user?.role,
    isLoading: meQuery.isPending || meQuery.isFetching,
    login: loginMutation.mutateAsync,
    isLoggingIn: loginMutation.isPending,
    logout: logoutMutation.mutate,
  };
}
