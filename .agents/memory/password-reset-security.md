---
name: Password reset history
description: Regra para impedir que solicitações administrativas de reset armazenem senhas originais
---

Pedidos administrativos de recuperação de senha não devem persistir nem retornar a senha original. O valor informado pode existir apenas durante a requisição para atualizar o cadastro da empresa, cuja camada de persistência aplica bcrypt; o campo histórico legado deve ser removido em migração separada.

**Why:** guardar `newPassword` no histórico criava uma segunda cópia em texto puro mesmo quando `companies.password` era protegido por bcrypt.

**How to apply:** ao alterar esse fluxo, mantenha a senha fora do objeto de atualização do pedido, fora do tipo retornado pela API e fora do schema; qualquer coluna legada deve ser removida em uma etapa de banco explicitamente autorizada.