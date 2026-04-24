# VivaFrutaz B2B Ordering ERP SaaS

## Overview
VivaFrutaz is a B2B corporate fruit ordering ERP SaaS platform in Brazilian Portuguese (PT-BR). It offers a comprehensive solution for managing fruit ordering processes, featuring a dual-portal system for administrators and client companies. The platform supports role-based access, time-windowed ordering, detailed reporting, and advanced logistics with GPS tracking. Key capabilities include NF-e 4.00 fiscal emission, AI-powered operational intelligence (Clara IA), White Label customization per company, robust SaaS plan management, and a Marketplace de Módulos. The project aims to streamline B2B fruit procurement, enhance operational efficiency, and provide scalable solutions for businesses in Brazil.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript and Vite.
- **Routing**: Wouter, with `ProtectedRoute` for access control.
- **State Management**: TanStack React Query for server state.
- **UI Components**: shadcn/ui (New York style) based on Radix UI, styled with Tailwind CSS (green/orange palette).
- **Forms**: React Hook Form with Zod validation.
- **Charts**: Recharts for data visualization.
- **Authentication**: `useAuth` hook and `ProtectedRoute` manage session types and access.
- **PWA Support**: Manifest and service worker for offline capabilities.
- **Push Notifications**: Integrated system for event-driven notifications.

### Backend Architecture
- **Runtime**: Node.js with Express 5.
- **Language**: TypeScript.
- **Session Management**: `express-session` with `memorystore`.
- **API Design**: Centralized, typed API definitions with Zod schemas for validation.
- **Storage Layer**: `IStorage` interface implemented using Drizzle ORM and PostgreSQL.

### Data Storage
- **Database**: PostgreSQL, accessed via Drizzle ORM.
- **Key Tables**: `users`, `companies`, `products`, `orders`, `system_settings`, `nfe_emissoes`, `bank_accounts`, `scope_simulations`, `planos`, `assinaturas`, `billing_events`, among others, to support all core features.

### Authentication & Authorization
- Session-based authentication with `express-session`.
- Role-based access control for `admin` (ADMIN, OPERATIONS_MANAGER, PURCHASE_MANAGER, LOGISTICS, FINANCEIRO, DIRECTOR, DEVELOPER, MASTER) and `company` user types, enforced by `ProtectedRoute` and `tabPermissions`.
- Account lockout mechanism after failed login attempts.

### Core Features
- **Dual Portal System**: Separate interfaces for client companies and internal administration.
- **Role-Based Access**: Granular permissions across various user roles.
- **Price Management**: Dynamic pricing via price groups and administrative fees.
- **Ordering System**: Time-windowed orders, special orders, cart functionality, and order workflow management.
- **Reporting & Exports**: Comprehensive purchasing and financial reports, CSV export, DANFE Internal PDF, ERP Bling Export, and Fiscal Export Module (XML/XLSX).
- **Logistics Module**: Route, driver, vehicle management, maintenance, quotations, and a Route Assistant with geocoding for optimized delivery. GPS tracking and control per plan.
- **Contratual Client Module**: Dedicated experience for contract clients, including scope viewing, change requests, and restricted ordering.
- **Virtual Assistant (Clara IA)**: AI-powered assistant for queries, smart exports, intelligence modules (commercial risk, financial forecast), and a trainable chat mode. Includes an automated diagnostics and bug-fixing feature.
- **Incident Management**: Tracks client and internal incidents.
- **White Label**: Company-specific branding and customization.
- **SaaS Multi-Tenant Platform**: Master control panel for managing companies, plans, subscriptions, billing, and users within a multi-tenant SaaS environment.
- **NF-e 4.00 Emission Module**: Full XML generation, SEFAZ transmission, DANFE PDF, and cancellation capabilities.
- **Itaú Bank Integration**: Bank account management, OAuth2 authentication, statement fetching, boleto issuance, and reconciliation.
- **AI Developer Module**: No-LLM tool for system health monitoring, API testing, code analysis (Auto Corrigir), E2E user flow simulation, documentation generation, and module scaffolding.
- **Advanced Permissions System**: Granular flag-based permissions configurable per user.
- **Login Security & Account Lockout**: Automated account locking after multiple failed login attempts with admin unlock capability.
- **Security Logs**: Centralized logging and viewing of security events (login attempts, account lockouts, frontend errors).
- **Simulação de Escopo Comercial**: Module for managing B2B prospect simulations, including company info, dynamic scope builder, and financial analysis, with conversion to client functionality.
- **Central de Treinamento**: In-app training guide with quick start, module documentation, SaaS plans, and FAQ.
- **Inventory Module**: Comprehensive system for managing inventory entries, movements, physical counts, and low-stock alerts.
- **Maintenance Mode**: System-wide maintenance mode with client-side blocking and staff access.
- **Per-User Test Mode**: Allows individual users to operate in a test environment without affecting live data.

## External Dependencies

### Core Infrastructure
- **PostgreSQL**: Primary relational database.
- **Node.js / Express 5**: Backend runtime and web application framework.

### Key npm Packages
- `drizzle-orm`, `drizzle-zod`, `drizzle-kit`: ORM and database schema tools.
- `@tanstack/react-query`: Data fetching and state management.
- `react-hook-form`, `zod`: Form management and validation.
- `recharts`: Charting library.
- `jspdf`, `jspdf-autotable`: Client-side PDF generation.
- `qrcode`: QR code generation.
- `xlsx`: Excel file handling.
- `pdfkit`, `node-forge`, `xml-crypto`: Server-side PDF generation and NF-e digital signature.
- `axios`: HTTP client for external APIs (e.g., Itaú Bank).
- `nanoid`, `uuid`: Unique ID generators.

### Fonts
- Plus Jakarta Sans and Outfit via Google Fonts CDN.