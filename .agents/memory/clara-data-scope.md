---
name: Clara data scope
description: Regras duráveis para consultas ERP e escopo global da Clara.
---

A Clara operacional deve resolver o escopo no limite HTTP: tenant fixado para usuários/funcionários vinculados e leitura global explícita somente para MASTER/ADMIN sem tenant selecionado. Ausência de tenant não pode virar lista vazia com contagem zero nem leitura global implícita.

**Why:** O middleware pode representar um administrador global com `empresaId` nulo; wrappers que apenas retornam `[]` mascaram dados reais do ERP e tornam o diagnóstico impossível. Ao mesmo tempo, aceitar `?empresaId=` para qualquer sessão sem empresa cria risco de leitura entre tenants.

**How to apply:** Toda nova intenção de dados da Clara deve usar wrappers de escopo e registrar `SINGLE` ou `CROSS`; endpoints de exportação devem validar o papel global e impedir que usuários vinculados escolham outra empresa.