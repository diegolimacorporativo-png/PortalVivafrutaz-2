export async function getNFePreflight(orderId: number) {
  const res = await fetch(`/api/nfe/preflight/${orderId}`, {
    credentials: 'include',
  });

  const body = await res.json();

  if (res.status === 401 || res.status === 403) {
    throw new Error(body?.error?.message || body?.message || 'Não autorizado');
  }

  return body;
}

export async function getNFeDiagnostics(orderId: number) {
  const res = await fetch(`/api/nfe/diagnostics/${orderId}`, {
    credentials: 'include',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || err?.error?.message || 'Erro ao buscar diagnóstico');
  }

  return res.json();
}
