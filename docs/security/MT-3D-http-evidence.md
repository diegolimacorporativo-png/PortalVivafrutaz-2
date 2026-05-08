# MT-3D — Evidência HTTP (Validação Live)

**Data:** 2026-05-08  
**Ambiente:** Desenvolvimento (localhost:5000), DB Supabase conectado  
**Método:** `curl -s -o /dev/null -w "%{http_code}"` sem cookies/sessão

---

## Resultado dos Testes

Todos os endpoints críticos testados **sem autenticação** (sem cookie de sessão):

```bash
# Execução:
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/orders          # → 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/products        # → 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/nfe             # → 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/nfe/eligible    # → 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/executive-dashboard # → 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/clara-training  # → 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/contracts/alerts # → 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/admin/alerts    # → 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/admin/policies  # → 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/master/modulos-sistema # → 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/health              # → 200
```

---

## Tabela de Resultados

| Endpoint | HTTP Status | Esperado | Resultado |
|---|---|---|---|
| `GET /api/orders` | **401** | 401 | ✅ PASS |
| `GET /api/products` | **401** | 401 | ✅ PASS |
| `GET /api/nfe` | **401** | 401 | ✅ PASS |
| `GET /api/nfe/eligible` | **401** | 401 | ✅ PASS |
| `GET /api/executive-dashboard` | **401** | 401 | ✅ PASS |
| `GET /api/clara-training` | **401** | 401 | ✅ PASS |
| `GET /api/contracts/alerts` | **401** | 401 | ✅ PASS |
| `GET /api/admin/alerts` | **401** | 401 | ✅ PASS |
| `GET /api/admin/policies` | **401** | 401 | ✅ PASS |
| `GET /api/master/modulos-sistema` | **401** | 401 | ✅ PASS |
| `GET /health` | **200** | 200 | ✅ PASS (liveness probe público) |

---

## Cobertura por Fase

| Endpoint | Fase de Fix | MT-3A | MT-3B | MT-3C |
|---|---|---|---|---|
| `GET /api/orders` | MT-3A | ✅ | — | — |
| `GET /api/products` | MT-3A | ✅ | — | — |
| `GET /api/nfe` | MT-3A | ✅ | — | — |
| `GET /api/nfe/eligible` | MT-3C | — | — | ✅ |
| `GET /api/executive-dashboard` | MT-3C | — | — | ✅ |
| `GET /api/clara-training` | MT-3C | — | — | ✅ |
| `GET /api/contracts/alerts` | MT-3C | — | — | ✅ |
| `GET /api/admin/alerts` | Pré-MT-3 | ✅ (sempre teve) | — | — |
| `GET /api/admin/policies` | Pré-MT-3 | ✅ (sempre teve) | — | — |
| `GET /api/master/modulos-sistema` | MT-3C | — | — | ✅ |

---

## Endpoints Públicos Intencionais (sem 401)

| Endpoint | Justificativa |
|---|---|
| `GET /health` | Liveness probe — deve ser acessível sem auth para load balancers |
| `GET /api/about-us` | Conteúdo institucional público |
| `POST /api/auth/login` | Fluxo de autenticação |
| `POST /api/auth/register` | Registro de novo usuário |
| `GET /api/password-reset-requests` | Fluxo de recuperação de senha |
