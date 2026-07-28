import { productionRouter } from "./production.routes";

export const definition = {
  name: "production",
  basePath: "/api/production",
  router: productionRouter,
} as const;
