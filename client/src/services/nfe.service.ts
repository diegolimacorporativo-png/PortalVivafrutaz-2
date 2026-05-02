export async function getNFePreflight(orderId: number) {
  const res = await fetch(`/api/nfe/preflight/${orderId}`, {
    credentials: 'include',
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err?.error?.message || 'Erro no preflight');
  }

  return res.json();
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
