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
