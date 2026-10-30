import { securityRouter } from "./security.routes";

export const definition = {
  name: "security" as const,
  basePath: "/api/admin/security" as const,
  router: securityRouter,
};

export { securityRouter } from "./security.routes";
