---
name: Programação Semanal feature
description: Covers the weekly-schedule implementation that replaced Novo Pedido and how it connects to the existing backend.
---

# Programação Semanal Feature

## Architecture
- Route `/client/order` now serves `WeeklySchedule` (was `ClientCreateOrder`)
- `create-order.tsx` is preserved (still imported in App.tsx as `ClientCreateOrder`) — only the route was reassigned
- New page: `client/src/pages/client/weekly-schedule.tsx`
- New hook: `useCreateProgramacao` in `client/src/hooks/use-ordering.ts`

## Backend endpoint reused
`POST /api/orders/programacao` (already existed) — accepts `{ days: [{deliveryDate, weekReference, totalValue, orderNote, items}] }`, validates minWeeklyBilling against total, creates each order through standard pipeline.

## Key design decisions
- `dayCarts: Record<dayName, Record<cartKey, qty>>` — separate cart per delivery day
- `weekAlreadySubmitted`: if any non-cancelled order shares `weekReference === activeWindow.weekReference`, shows read-only view with Solicitar Alteração buttons
- `buildEntriesForDay(products, company, dayName)` — filters by `availableDays` per day
- Cart persistence (localStorage) intentionally NOT implemented yet — see follow-up task

**Why:** Backend already had the multi-day endpoint; UI just needed to call it correctly with per-day carts.

## What changed
- `Layout.tsx` line ~178: label "Programação Semanal", icon `CalendarDays`
- `dashboard.tsx`: button text + icon updated
- `order-history.tsx`: button text + icon updated
- `App.tsx`: route `/client/order` → `WeeklySchedule`

## Known gap
`dayCarts` has no localStorage persistence (original `create-order.tsx` had it). Tracked as follow-up.
