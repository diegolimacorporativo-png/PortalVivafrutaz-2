---
name: GPS em segundo plano na PWA
description: Limites do Chrome Android para geolocalização contínua com a tela bloqueada.
---

A PWA pode retomar `watchPosition`, reenviar posições pendentes e lidar com perda de rede, mas não garante captura contínua quando o Android suspende o Chrome ou bloqueia a tela. Não usar Service Worker como substituto de geolocalização contínua.

**Why:** Moto G6, Samsung J6 e Samsung J7 podem suspender JavaScript, timers e rede em segundo plano; a garantia de rastreamento com tela bloqueada exige serviço nativo em primeiro plano.

**How to apply:** Manter o endpoint web existente para a experiência PWA e, se o requisito de tela bloqueada for obrigatório, tratar o Tracker Android com Foreground Service + Fused Location Provider como projeto separado.