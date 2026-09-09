---
name: Vercel public registry
description: Restrição de portabilidade do lockfile entre o firewall de pacotes do Replit e registries externos.
---

O lockfile npm precisa manter URLs `resolved` no registry público `https://registry.npmjs.org/` para instalações fora do Replit, mesmo quando o `.npmrc` já aponta para esse registry.

**Why:** O ambiente Replit injeta `NPM_CONFIG_REGISTRY`/`npm_config_registry` apontando para o firewall interno, e instalações feitas nesse ambiente podem persistir esse host no `package-lock.json`. A URL interna não é acessível em provedores externos como a Vercel.

**How to apply:** Ao preparar deploy externo, procure hosts `package-firewall.replit.*` em `.npmrc`, lockfiles e configurações rastreadas; preserve versões e integridades, substitua apenas os endpoints por URLs públicas e valide com instalação limpa usando o registry público.