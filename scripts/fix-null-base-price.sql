-- SCRIPT SEGURO — CORREÇÃO DE PRODUTOS SEM PREÇO BASE
-- ATENÇÃO: NÃO executar automaticamente.
-- Executar manualmente SOMENTE após revisão e aprovação.
--
-- Objetivo: Atualizar produtos com base_price NULL para 0,
-- garantindo que nenhum produto fique sem preço utilizável.
--
-- Impacto: Apenas linhas com base_price IS NULL serão afetadas.
-- Nenhum dado real será deletado ou sobrescrito.
--
-- Para verificar quantos produtos serão afetados antes de executar:
--   SELECT id, name FROM products WHERE base_price IS NULL;
--
-- Para executar a correção:
UPDATE products
SET base_price = 0
WHERE base_price IS NULL;
