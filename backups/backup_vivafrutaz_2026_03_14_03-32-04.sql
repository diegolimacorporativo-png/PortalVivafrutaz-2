-- VivaFrutaz Database Backup
-- Gerado em: 2026-03-14T03:32:04.389Z
-- Sistema: VivaFrutaz B2B Ordering Platform
-- Formato: SQL INSERT statements
-- Tabelas incluídas: users, companies, price_groups, categories, products, product_prices,
--   order_windows, order_exceptions, orders, order_items, system_settings,
--   special_order_requests, tasks, client_incidents, internal_incidents,
--   logistics_drivers, logistics_vehicles, logistics_routes, logistics_maintenance, company_quotations

BEGIN;

-- Tabela: users (7 registro(s))
INSERT INTO users (id, name, email, password, role, active) VALUES (1, 'Admin User', 'admin@vivafrutaz.com', 'admin', 'ADMIN', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO users (id, name, email, password, role, active) VALUES (3, 'Purchasing', 'buy@vivafrutaz.com', 'buy', 'PURCHASE_MANAGER', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO users (id, name, email, password, role, active) VALUES (4, 'Financeiro@vivafrutaz.com', 'adm3@vivafrutaz.com.br', '123456', 'PURCHASE_MANAGER', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO users (id, name, email, password, role, active) VALUES (5, 'Desenvolvedor@vivafrutaz.com', 'desenvolvedor@vivafrutaz.com', '123456', 'DEVELOPER', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO users (id, name, email, password, role, active) VALUES (6, 'Fernando', 'Fernando@vivafrutaz.com', '123456', 'DIRECTOR', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO users (id, name, email, password, role, active) VALUES (7, 'Desenvolvedor VF', 'dev@vivafrutaz.com', 'dev', 'DEVELOPER', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO users (id, name, email, password, role, active) VALUES (2, 'Operations', 'ops@vivafrutaz.com', 'Viva2026@', 'OPERATIONS_MANAGER', TRUE) ON CONFLICT DO NOTHING;


-- Tabela: companies (5 registro(s))
INSERT INTO companies (id, companyName, contactName, email, notificationEmail, password, phone, cnpj, priceGroupId, allowedOrderDays, addressStreet, addressNumber, addressNeighborhood, addressCity, addressZip, active, clientType, minWeeklyBilling, deliveryTime, adminFee, billingTerm, billingType, billingFormat, paymentDates, financialNotes, createdAt) VALUES (2, 'Allianz', 'Allianz', 'allianzgrsa@vivafrutaz.com', NULL, '123456', NULL, NULL, 3, '["Segunda feira e quarta feira","Segunda-feira","Quarta-feira"]', NULL, NULL, NULL, NULL, NULL, TRUE, 'mensal', NULL, NULL, '27.00', NULL, NULL, NULL, NULL, NULL, '2026-03-10T17:32:28.835Z') ON CONFLICT DO NOTHING;
INSERT INTO companies (id, companyName, contactName, email, notificationEmail, password, phone, cnpj, priceGroupId, allowedOrderDays, addressStreet, addressNumber, addressNeighborhood, addressCity, addressZip, active, clientType, minWeeklyBilling, deliveryTime, adminFee, billingTerm, billingType, billingFormat, paymentDates, financialNotes, createdAt) VALUES (3, 'Pinterest', 'Anderson ', 'pinterest@vivafrutaz.com', NULL, '123456', NULL, NULL, 3, '["Segunda-feira","Quinta-feira","Sexta-feira","Quarta-feira","Terça-feira"]', NULL, NULL, NULL, NULL, NULL, TRUE, 'mensal', '500.00', '09:00', '0.00', NULL, NULL, NULL, NULL, NULL, '2026-03-11T19:51:59.602Z') ON CONFLICT DO NOTHING;
INSERT INTO companies (id, companyName, contactName, email, notificationEmail, password, phone, cnpj, priceGroupId, allowedOrderDays, addressStreet, addressNumber, addressNeighborhood, addressCity, addressZip, active, clientType, minWeeklyBilling, deliveryTime, adminFee, billingTerm, billingType, billingFormat, paymentDates, financialNotes, createdAt) VALUES (4, 'Ripple', 'Expressobox', 'Ripple@vivafrutaz.com', NULL, '123456', NULL, NULL, 5, '["Segunda-feira"]', NULL, NULL, NULL, NULL, NULL, FALSE, 'mensal', NULL, NULL, '0.00', NULL, NULL, NULL, NULL, NULL, '2026-03-12T17:26:32.981Z') ON CONFLICT DO NOTHING;
INSERT INTO companies (id, companyName, contactName, email, notificationEmail, password, phone, cnpj, priceGroupId, allowedOrderDays, addressStreet, addressNumber, addressNeighborhood, addressCity, addressZip, active, clientType, minWeeklyBilling, deliveryTime, adminFee, billingTerm, billingType, billingFormat, paymentDates, financialNotes, createdAt) VALUES (1, 'Betano GRSA', 'Betano', 'Betanogrsa@vivafrutaz.com', NULL, '123456', NULL, NULL, 3, '["Monday","Wednesday","Segunda-feira","Quarta-feira"]', NULL, NULL, NULL, NULL, NULL, TRUE, 'mensal', NULL, NULL, '12.00', NULL, NULL, NULL, NULL, NULL, '2026-03-10T16:37:36.452Z') ON CONFLICT DO NOTHING;
INSERT INTO companies (id, companyName, contactName, email, notificationEmail, password, phone, cnpj, priceGroupId, allowedOrderDays, addressStreet, addressNumber, addressNeighborhood, addressCity, addressZip, active, clientType, minWeeklyBilling, deliveryTime, adminFee, billingTerm, billingType, billingFormat, paymentDates, financialNotes, createdAt) VALUES (5, 'Google SKY ', 'Google SKY ', 'googlesky@vivafrutaz.com', 'diego.lima.corporativo@gmail.com', '123456', NULL, NULL, 4, '["Segunda-feira","Quarta-feira"]', NULL, NULL, NULL, NULL, NULL, TRUE, 'mensal', '400.00', NULL, '12.00', '15', 'deposito', 'diario', NULL, NULL, '2026-03-12T19:20:18.637Z') ON CONFLICT DO NOTHING;


-- Tabela: price_groups (6 registro(s))
INSERT INTO price_groups (id, groupName, description) VALUES (1, 'Corporate Basic', 'Standard pricing') ON CONFLICT DO NOTHING;
INSERT INTO price_groups (id, groupName, description) VALUES (2, 'Corporate Plus', 'Discounted pricing') ON CONFLICT DO NOTHING;
INSERT INTO price_groups (id, groupName, description) VALUES (3, 'GRSA', '') ON CONFLICT DO NOTHING;
INSERT INTO price_groups (id, groupName, description) VALUES (4, 'Sodexo', '') ON CONFLICT DO NOTHING;
INSERT INTO price_groups (id, groupName, description) VALUES (5, 'Tabela padrão ', '') ON CONFLICT DO NOTHING;
INSERT INTO price_groups (id, groupName, description) VALUES (6, 'Cliente testec', '') ON CONFLICT DO NOTHING;


-- Tabela: categories (12 registro(s))
INSERT INTO categories (id, name, description, active) VALUES (6, 'Industrializados', NULL, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO categories (id, name, description, active) VALUES (1, 'Frutas In Natura higienizadas (Embaladas em plastico)', NULL, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO categories (id, name, description, active) VALUES (3, 'Frutas processadas (Embalagem plástica)', '100g', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO categories (id, name, description, active) VALUES (9, 'Frutas In Natura (Não higienizadas e não embaladas)', NULL, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO categories (id, name, description, active) VALUES (2, 'Frutas In Natura (Higienizadas embaladas em biodegradável)', NULL, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO categories (id, name, description, active) VALUES (7, 'Frutas processas (Pote biodegradável)', '100g', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO categories (id, name, description, active) VALUES (8, 'Snacks Saudáveis (Embalagem biodegradavel)', NULL, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO categories (id, name, description, active) VALUES (4, 'Snacks Saudáveis (Embalagem plástica)', NULL, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO categories (id, name, description, active) VALUES (10, 'Frutas processadas (KG)', NULL, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO categories (id, name, description, active) VALUES (5, 'Linha de Oleaginosas e secas (Embalagem plástica)', NULL, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO categories (id, name, description, active) VALUES (11, 'Linha de Oleaginosas e secas (Embalagem biodegradável)', NULL, TRUE) ON CONFLICT DO NOTHING;
INSERT INTO categories (id, name, description, active) VALUES (13, 'Bebida', NULL, TRUE) ON CONFLICT DO NOTHING;


-- Tabela: products (9 registro(s))
INSERT INTO products (id, name, category, unit, active, basePrice, isIndustrialized, isSeasonal, observation, availableDays) VALUES (4, 'Banana', 'In natura ', 'piece', TRUE, '2.30', FALSE, FALSE, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO products (id, name, category, unit, active, basePrice, isIndustrialized, isSeasonal, observation, availableDays) VALUES (5, 'Banana ', 'Frutas in natura', 'unidade', TRUE, '2.30', FALSE, FALSE, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO products (id, name, category, unit, active, basePrice, isIndustrialized, isSeasonal, observation, availableDays) VALUES (6, 'Banana', 'In natura ', 'unidade', FALSE, '2.50', FALSE, FALSE, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO products (id, name, category, unit, active, basePrice, isIndustrialized, isSeasonal, observation, availableDays) VALUES (1, 'Banana', 'Fruit', 'unidade', FALSE, '2.30', FALSE, FALSE, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO products (id, name, category, unit, active, basePrice, isIndustrialized, isSeasonal, observation, availableDays) VALUES (7, 'Manga', 'Frutas In natura ', 'kg', TRUE, '3.50', FALSE, FALSE, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO products (id, name, category, unit, active, basePrice, isIndustrialized, isSeasonal, observation, availableDays) VALUES (8, 'Biscoito Integral', 'Industrializados', 'display', TRUE, '5.00', TRUE, FALSE, 'Display com 12 unidades', '["Segunda-feira"]') ON CONFLICT DO NOTHING;
INSERT INTO products (id, name, category, unit, active, basePrice, isIndustrialized, isSeasonal, observation, availableDays) VALUES (3, 'Melon in natura ', 'Frutas Higienizadas', 'unidade', TRUE, '2.30', FALSE, FALSE, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO products (id, name, category, unit, active, basePrice, isIndustrialized, isSeasonal, observation, availableDays) VALUES (2, 'Morango ', 'Frutas In Natura', 'unidade', TRUE, '2.30', FALSE, TRUE, 'Higienizadas ', '["Terça-feira"]') ON CONFLICT DO NOTHING;
INSERT INTO products (id, name, category, unit, active, basePrice, isIndustrialized, isSeasonal, observation, availableDays) VALUES (9, 'Abacaxi ', 'Frutas processas (Pote biodegradável)', 'pote', TRUE, '3.85', FALSE, FALSE, NULL, '["Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira"]') ON CONFLICT DO NOTHING;


-- Tabela: product_prices (6 registro(s))
INSERT INTO product_prices (id, productId, priceGroupId, price) VALUES (1, 1, 1, '45.00') ON CONFLICT DO NOTHING;
INSERT INTO product_prices (id, productId, priceGroupId, price) VALUES (2, 1, 2, '40.00') ON CONFLICT DO NOTHING;
INSERT INTO product_prices (id, productId, priceGroupId, price) VALUES (3, 2, 1, '45.00') ON CONFLICT DO NOTHING;
INSERT INTO product_prices (id, productId, priceGroupId, price) VALUES (4, 2, 2, '40.00') ON CONFLICT DO NOTHING;
INSERT INTO product_prices (id, productId, priceGroupId, price) VALUES (5, 3, 1, '45.00') ON CONFLICT DO NOTHING;
INSERT INTO product_prices (id, productId, priceGroupId, price) VALUES (6, 3, 2, '40.00') ON CONFLICT DO NOTHING;


-- order_windows: sem registros


-- Tabela: order_exceptions (1 registro(s))
INSERT INTO order_exceptions (id, companyId, reason, expiryDate, active, createdAt) VALUES (1, 1, 'Cliente VIP com contrato especial de pedido tardio', '2026-03-16', TRUE, '2026-03-13T17:00:09.310Z') ON CONFLICT DO NOTHING;


-- Tabela: orders (10 registro(s))
INSERT INTO orders (id, orderCode, status, adminNote, companyId, orderDate, deliveryDate, weekReference, totalValue, orderNote, allowReplication, nimbiExpiration, createdAt) VALUES (1, 'VF-2026-000001', 'ACTIVE', 'Produto enviado com avaria - desconto de R$ 5,00 aplicado', 3, '2026-03-13T12:54:44.815Z', '2026-03-17T00:00:00.000Z', 'Semana 11 - Mar 2026', '2.64', 'Banana bem madura', FALSE, NULL, '2026-03-13T12:54:44.815Z') ON CONFLICT DO NOTHING;
INSERT INTO orders (id, orderCode, status, adminNote, companyId, orderDate, deliveryDate, weekReference, totalValue, orderNote, allowReplication, nimbiExpiration, createdAt) VALUES (2, 'VF-2026-000002', 'ACTIVE', NULL, 2, '2026-03-13T13:04:19.678Z', '2026-03-17T00:00:00.000Z', 'Semana 11 - Mar 2026', '46.77', NULL, FALSE, NULL, '2026-03-13T13:04:19.678Z') ON CONFLICT DO NOTHING;
INSERT INTO orders (id, orderCode, status, adminNote, companyId, orderDate, deliveryDate, weekReference, totalValue, orderNote, allowReplication, nimbiExpiration, createdAt) VALUES (3, 'VF-2026-000003', 'ACTIVE', NULL, 2, '2026-03-13T13:04:29.324Z', '2026-03-19T00:00:00.000Z', 'Semana 11 - Mar 2026', '23.36', NULL, FALSE, NULL, '2026-03-13T13:04:29.324Z') ON CONFLICT DO NOTHING;
INSERT INTO orders (id, orderCode, status, adminNote, companyId, orderDate, deliveryDate, weekReference, totalValue, orderNote, allowReplication, nimbiExpiration, createdAt) VALUES (4, 'VF-2026-000004', 'ACTIVE', NULL, 2, '2026-03-13T17:09:46.252Z', '2026-03-17T00:00:00.000Z', 'Semana 11 - Mar 2026', '21.46', NULL, FALSE, NULL, '2026-03-13T17:09:46.252Z') ON CONFLICT DO NOTHING;
INSERT INTO orders (id, orderCode, status, adminNote, companyId, orderDate, deliveryDate, weekReference, totalValue, orderNote, allowReplication, nimbiExpiration, createdAt) VALUES (5, 'VF-2026-000005', 'ACTIVE', NULL, 1, '2026-03-13T17:41:00.949Z', '2026-03-19T00:00:00.000Z', 'Semana 11 - Mar 2026', '77.02', NULL, FALSE, NULL, '2026-03-13T17:41:00.949Z') ON CONFLICT DO NOTHING;
INSERT INTO orders (id, orderCode, status, adminNote, companyId, orderDate, deliveryDate, weekReference, totalValue, orderNote, allowReplication, nimbiExpiration, createdAt) VALUES (6, 'VF-2026-000006', 'ACTIVE', NULL, 1, '2026-03-13T17:41:20.213Z', '2026-03-17T00:00:00.000Z', 'Semana 11 - Mar 2026', '91.90', NULL, FALSE, NULL, '2026-03-13T17:41:20.213Z') ON CONFLICT DO NOTHING;
INSERT INTO orders (id, orderCode, status, adminNote, companyId, orderDate, deliveryDate, weekReference, totalValue, orderNote, allowReplication, nimbiExpiration, createdAt) VALUES (7, 'VF-2026-000007', 'ACTIVE', NULL, 1, '2026-03-13T17:41:44.836Z', '2026-03-17T00:00:00.000Z', 'Semana 11 - Mar 2026', '91.90', NULL, FALSE, NULL, '2026-03-13T17:41:44.836Z') ON CONFLICT DO NOTHING;
INSERT INTO orders (id, orderCode, status, adminNote, companyId, orderDate, deliveryDate, weekReference, totalValue, orderNote, allowReplication, nimbiExpiration, createdAt) VALUES (8, 'VF-2026-000008', 'ACTIVE', NULL, 1, '2026-03-13T20:44:50.787Z', '2026-03-17T00:00:00.000Z', 'Semana 11 - Mar 2026', '468.99', NULL, FALSE, NULL, '2026-03-13T20:44:50.787Z') ON CONFLICT DO NOTHING;
INSERT INTO orders (id, orderCode, status, adminNote, companyId, orderDate, deliveryDate, weekReference, totalValue, orderNote, allowReplication, nimbiExpiration, createdAt) VALUES (9, 'VF-2026-000009', 'ACTIVE', NULL, 1, '2026-03-13T20:47:09.232Z', '2026-03-19T00:00:00.000Z', 'Semana 11 - Mar 2026', '28.38', NULL, FALSE, NULL, '2026-03-13T20:47:09.232Z') ON CONFLICT DO NOTHING;
INSERT INTO orders (id, orderCode, status, adminNote, companyId, orderDate, deliveryDate, weekReference, totalValue, orderNote, allowReplication, nimbiExpiration, createdAt) VALUES (10, 'VF-2026-000010', 'ACTIVE', NULL, 1, '2026-03-13T23:04:01.808Z', '2026-03-16T15:00:00.000Z', 'Semana 11 - Mar 2026', '32.60', NULL, FALSE, NULL, '2026-03-13T23:04:01.808Z') ON CONFLICT DO NOTHING;


-- Tabela: order_items (30 registro(s))
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (1, 1, 1, 1, '2.64', '2.64') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (2, 2, 1, 6, '2.92', '17.52') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (3, 2, 6, 5, '3.18', '15.90') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (4, 2, 7, 3, '4.45', '13.35') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (5, 3, 1, 8, '2.92', '23.36') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (8, 4, 3, 3, '2.92', '8.76') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (9, 4, 8, 2, '6.35', '12.70') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (10, 5, 2, 6, '2.58', '15.48') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (11, 5, 3, 3, '2.58', '7.74') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (12, 5, 4, 10, '2.58', '25.80') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (13, 5, 8, 5, '5.60', '28.00') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (14, 6, 4, 6, '2.58', '15.48') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (15, 6, 5, 9, '2.58', '23.22') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (16, 6, 7, 5, '3.92', '19.60') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (17, 6, 8, 6, '5.60', '33.60') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (18, 7, 4, 6, '2.58', '15.48') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (19, 7, 5, 9, '2.58', '23.22') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (20, 7, 7, 5, '3.92', '19.60') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (21, 7, 8, 6, '5.60', '33.60') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (22, 8, 3, 5, '2.58', '12.90') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (23, 8, 4, 5, '2.58', '12.90') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (24, 8, 5, 6, '2.58', '15.48') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (25, 8, 7, 4, '3.92', '15.68') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (26, 8, 8, 2, '5.60', '11.20') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (27, 8, 9, 93, '4.31', '400.83') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (28, 9, 3, 7, '2.58', '18.06') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (29, 9, 4, 4, '2.58', '10.32') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (30, 10, 4, 1, '2.58', '2.58') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (31, 10, 5, 1, '2.58', '2.58') ON CONFLICT DO NOTHING;
INSERT INTO order_items (id, orderId, productId, quantity, unitPrice, totalPrice) VALUES (32, 10, 7, 7, '3.92', '27.44') ON CONFLICT DO NOTHING;


-- Tabela: system_settings (3 registro(s))
INSERT INTO system_settings (key, value) VALUES ('orders_enabled', 'true') ON CONFLICT DO NOTHING;
INSERT INTO system_settings (key, value) VALUES ('maintenance_mode', 'true') ON CONFLICT DO NOTHING;
INSERT INTO system_settings (key, value) VALUES ('test_mode', 'true') ON CONFLICT DO NOTHING;


-- Tabela: special_order_requests (2 registro(s))
INSERT INTO special_order_requests (id, companyId, requestedDay, description, quantity, observations, status, adminNote, createdAt, resolvedAt) VALUES (1, 1, 'Segunda-feira', '10 maçãs ', '10', 'In natura ', 'REJECTED', 'Pedido pontual recusado.', '2026-03-13T23:03:42.582Z', '2026-03-13T23:06:33.115Z') ON CONFLICT DO NOTHING;
INSERT INTO special_order_requests (id, companyId, requestedDay, description, quantity, observations, status, adminNote, createdAt, resolvedAt) VALUES (2, 1, 'Segunda-feira', '30 maçãs 20 bananas ', '179', 'Pedido pontual ', 'REJECTED', 'Pedido fora do contrato', '2026-03-14T02:56:23.070Z', '2026-03-14T03:05:13.308Z') ON CONFLICT DO NOTHING;


-- Tabela: tasks (3 registro(s))
INSERT INTO tasks (id, title, description, assignedToId, assignedToName, createdById, createdByName, deadline, priority, status, createdAt, updatedAt) VALUES (2, 'Revisar contrato', 'Verificar cláusulas do contrato', NULL, NULL, 1, 'Admin User', NULL, 'HIGH', 'IN_PROGRESS', '2026-03-14T01:08:03.131Z', '2026-03-14T02:41:46.940Z') ON CONFLICT DO NOTHING;
INSERT INTO tasks (id, title, description, assignedToId, assignedToName, createdById, createdByName, deadline, priority, status, createdAt, updatedAt) VALUES (1, 'Test', 'Desc', NULL, NULL, NULL, NULL, NULL, 'HIGH', 'IN_PROGRESS', '2026-03-14T01:05:47.070Z', '2026-03-14T02:41:48.968Z') ON CONFLICT DO NOTHING;
INSERT INTO tasks (id, title, description, assignedToId, assignedToName, createdById, createdByName, deadline, priority, status, createdAt, updatedAt) VALUES (5, 'Teste de tarefa atualizada', 'Descrição da tarefa', 1, 'Admin User', 1, 'Admin User', NULL, 'MEDIUM', 'IN_PROGRESS', '2026-03-14T03:07:08.084Z', '2026-03-14T03:23:55.229Z') ON CONFLICT DO NOTHING;


-- Tabela: client_incidents (2 registro(s))
INSERT INTO client_incidents (id, companyId, companyName, type, description, contactPhone, contactEmail, photoBase64, photoMime, status, adminNote, responseMessage, respondedByName, respondedAt, resolvedAt, createdAt) VALUES (1, 1, 'Betano GRSA', 'OTHER', 'Teste de ocorrência', '', '', NULL, NULL, 'ANALYZING', 'Estamos averiguando ', NULL, NULL, NULL, NULL, '2026-03-14T01:10:30.725Z') ON CONFLICT DO NOTHING;
INSERT INTO client_incidents (id, companyId, companyName, type, description, contactPhone, contactEmail, photoBase64, photoMime, status, adminNote, responseMessage, respondedByName, respondedAt, resolvedAt, createdAt) VALUES (2, 1, 'Betano GRSA', 'QUALITY', 'Teste resposta: produto danificado no transporte.', '', '', NULL, NULL, 'RESPONDED', NULL, 'Agradecemos o contato. Enviaremos reposição em 48h.', 'Admin User', '2026-03-14T03:11:43.844Z', NULL, '2026-03-14T03:11:04.425Z') ON CONFLICT DO NOTHING;


-- Tabela: internal_incidents (1 registro(s))
INSERT INTO internal_incidents (id, title, description, category, assignedToId, assignedToName, createdById, createdByName, priority, status, adminNote, resolvedAt, createdAt) VALUES (1, 'Sistema lento', 'Lentidão nos acessos', 'SYSTEM', NULL, NULL, 1, 'Admin User', 'HIGH', 'OPEN', NULL, NULL, '2026-03-14T01:08:28.635Z') ON CONFLICT DO NOTHING;


-- Tabela: logistics_drivers (1 registro(s))
INSERT INTO logistics_drivers (id, name, cpf, phone, email, licenseNumber, active, notes, createdAt) VALUES (1, 'João da Silva', '', '', '', '', TRUE, '', '2026-03-14T01:37:38.894Z') ON CONFLICT DO NOTHING;


-- Tabela: logistics_vehicles (1 registro(s))
INSERT INTO logistics_vehicles (id, plate, model, brand, year, type, capacity, active, notes, createdAt) VALUES (1, 'ABC-9999', 'Sprinter', 'Mercedes', NULL, 'VAN', '', TRUE, '', '2026-03-14T01:38:06.491Z') ON CONFLICT DO NOTHING;


-- logistics_routes: sem registros


-- logistics_maintenance: sem registros


-- Tabela: company_quotations (3 registro(s))
INSERT INTO company_quotations (id, companyName, contactName, contactPhone, email, cnpj, address, city, state, estimatedVolume, productInterest, logisticsNote, orderWindowIds, priceGroupId, priceGroupName, status, adminNote, createdAt, updatedAt) VALUES (1, 'Empresa ABC Ltda', 'Maria Lima', '', '', '', '', '', '', '', '', '', '[]', NULL, NULL, 'PENDING', NULL, '2026-03-14T01:38:47.288Z', '2026-03-14T01:38:47.288Z') ON CONFLICT DO NOTHING;
INSERT INTO company_quotations (id, companyName, contactName, contactPhone, email, cnpj, address, city, state, estimatedVolume, productInterest, logisticsNote, orderWindowIds, priceGroupId, priceGroupName, status, adminNote, createdAt, updatedAt) VALUES (2, 'Diego ', '11985646821', '', '', '', 'Rua João de Araújo ', '', '', '', '', '', '[]', NULL, NULL, 'PENDING', NULL, '2026-03-14T01:44:06.627Z', '2026-03-14T01:44:06.627Z') ON CONFLICT DO NOTHING;
INSERT INTO company_quotations (id, companyName, contactName, contactPhone, email, cnpj, address, city, state, estimatedVolume, productInterest, logisticsNote, orderWindowIds, priceGroupId, priceGroupName, status, adminNote, createdAt, updatedAt) VALUES (3, 'Diego corps', '11985646821', '', '', '', 'Rua João de Araújo ', '', '', '', '', '', '[]', 3, 'GRSA', 'PENDING', NULL, '2026-03-14T02:32:07.382Z', '2026-03-14T02:32:07.382Z') ON CONFLICT DO NOTHING;


COMMIT;

-- Fim do backup VivaFrutaz