import { z } from 'zod';
import { 
  insertUserSchema, users,
  insertPriceGroupSchema, priceGroups,
  insertCompanySchema, companies,
  insertProductSchema, products,
  insertProductPriceSchema, productPrices,
  insertOrderWindowSchema, orderWindows,
  insertOrderSchema, orders,
  insertOrderItemSchema, orderItems
} from './schema';

export const errorSchemas = {
  validation: z.object({ message: z.string(), field: z.string().optional() }),
  notFound: z.object({ message: z.string() }),
  internal: z.object({ message: z.string() }),
  unauthorized: z.object({ message: z.string() }),
};

export const api = {
  auth: {
    login: {
      method: 'POST' as const,
      path: '/api/auth/login' as const,
      input: z.object({ email: z.string(), password: z.string(), type: z.enum(['admin', 'company']) }),
      responses: {
        200: z.object({
          user: z.custom<typeof users.$inferSelect>().optional(),
          company: z.custom<typeof companies.$inferSelect>().optional(),
        }),
        401: errorSchemas.unauthorized,
      }
    },
    me: {
      method: 'GET' as const,
      path: '/api/auth/me' as const,
      responses: {
        200: z.object({
          user: z.custom<typeof users.$inferSelect>().optional(),
          company: z.custom<typeof companies.$inferSelect>().optional(),
        }),
        401: errorSchemas.unauthorized,
      }
    },
    logout: {
      method: 'POST' as const,
      path: '/api/auth/logout' as const,
      responses: { 200: z.object({ message: z.string() }) }
    }
  },
  users: {
    list: {
      method: 'GET' as const,
      path: '/api/users' as const,
      responses: { 200: z.array(z.custom<typeof users.$inferSelect>()) }
    },
    create: {
      method: 'POST' as const,
      path: '/api/users' as const,
      input: insertUserSchema,
      responses: { 201: z.custom<typeof users.$inferSelect>() }
    },
    update: {
      method: 'PUT' as const,
      path: '/api/users/:id' as const,
      input: insertUserSchema.partial(),
      responses: { 200: z.custom<typeof users.$inferSelect>() }
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/users/:id' as const,
      responses: { 204: z.void() }
    }
  },
  companies: {
    list: {
      method: 'GET' as const,
      path: '/api/companies' as const,
      responses: { 200: z.array(z.custom<typeof companies.$inferSelect>()) }
    },
    get: {
      method: 'GET' as const,
      path: '/api/companies/:id' as const,
      responses: { 200: z.custom<typeof companies.$inferSelect>(), 404: errorSchemas.notFound }
    },
    create: {
      method: 'POST' as const,
      path: '/api/companies' as const,
      input: insertCompanySchema,
      responses: { 201: z.custom<typeof companies.$inferSelect>() }
    },
    update: {
      method: 'PUT' as const,
      path: '/api/companies/:id' as const,
      input: insertCompanySchema.partial(),
      responses: { 200: z.custom<typeof companies.$inferSelect>() }
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/companies/:id' as const,
      responses: { 204: z.void() }
    }
  },
  priceGroups: {
    list: {
      method: 'GET' as const,
      path: '/api/price-groups' as const,
      responses: { 200: z.array(z.custom<typeof priceGroups.$inferSelect>()) }
    },
    create: {
      method: 'POST' as const,
      path: '/api/price-groups' as const,
      input: insertPriceGroupSchema,
      responses: { 201: z.custom<typeof priceGroups.$inferSelect>() }
    },
    update: {
      method: 'PUT' as const,
      path: '/api/price-groups/:id' as const,
      input: insertPriceGroupSchema.partial(),
      responses: { 200: z.custom<typeof priceGroups.$inferSelect>() }
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/price-groups/:id' as const,
      responses: { 204: z.void() }
    }
  },
  products: {
    list: {
      method: 'GET' as const,
      path: '/api/products' as const,
      responses: { 200: z.array(z.custom<typeof products.$inferSelect>()) }
    },
    create: {
      method: 'POST' as const,
      path: '/api/products' as const,
      input: insertProductSchema,
      responses: { 201: z.custom<typeof products.$inferSelect>() }
    },
    update: {
      method: 'PUT' as const,
      path: '/api/products/:id' as const,
      input: insertProductSchema.partial(),
      responses: { 200: z.custom<typeof products.$inferSelect>() }
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/products/:id' as const,
      responses: { 204: z.void() }
    }
  },
  productPrices: {
    list: {
      method: 'GET' as const,
      path: '/api/product-prices' as const,
      responses: { 200: z.array(z.custom<typeof productPrices.$inferSelect>()) }
    },
    create: {
      method: 'POST' as const,
      path: '/api/product-prices' as const,
      input: insertProductPriceSchema,
      responses: { 201: z.custom<typeof productPrices.$inferSelect>() }
    },
    update: {
      method: 'PUT' as const,
      path: '/api/product-prices/:id' as const,
      input: insertProductPriceSchema.partial(),
      responses: { 200: z.custom<typeof productPrices.$inferSelect>() }
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/product-prices/:id' as const,
      responses: { 204: z.void() }
    },
    byProduct: {
      method: 'GET' as const,
      path: '/api/products/:productId/prices' as const,
      responses: { 200: z.array(z.custom<typeof productPrices.$inferSelect>()) }
    }
  },
  orderWindows: {
    list: {
      method: 'GET' as const,
      path: '/api/order-windows' as const,
      responses: { 200: z.array(z.custom<typeof orderWindows.$inferSelect>()) }
    },
    active: {
      method: 'GET' as const,
      path: '/api/order-windows/active' as const,
      responses: { 200: z.custom<typeof orderWindows.$inferSelect>().optional() }
    },
    create: {
      method: 'POST' as const,
      path: '/api/order-windows' as const,
      input: insertOrderWindowSchema,
      responses: { 201: z.custom<typeof orderWindows.$inferSelect>() }
    },
    update: {
      method: 'PUT' as const,
      path: '/api/order-windows/:id' as const,
      input: insertOrderWindowSchema.partial(),
      responses: { 200: z.custom<typeof orderWindows.$inferSelect>() }
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/order-windows/:id' as const,
      responses: { 204: z.void() }
    }
  },
  orders: {
    list: {
      method: 'GET' as const,
      path: '/api/orders' as const,
      responses: { 200: z.array(z.custom<typeof orders.$inferSelect>()) }
    },
    get: {
      method: 'GET' as const,
      path: '/api/orders/:id' as const,
      responses: { 200: z.object({
        order: z.custom<typeof orders.$inferSelect>(),
        items: z.array(z.custom<typeof orderItems.$inferSelect>())
      }) }
    },
    create: {
      method: 'POST' as const,
      path: '/api/orders' as const,
      input: z.object({
        order: insertOrderSchema,
        items: z.array(insertOrderItemSchema)
      }),
      responses: { 201: z.custom<typeof orders.$inferSelect>() }
    },
    companyOrders: {
      method: 'GET' as const,
      path: '/api/companies/:companyId/orders' as const,
      responses: { 200: z.array(z.custom<typeof orders.$inferSelect>()) }
    }
  },
  reports: {
    purchasing: {
      method: 'GET' as const,
      path: '/api/reports/purchasing' as const,
      input: z.object({ weekReference: z.string().optional() }).optional(),
      responses: {
        200: z.array(z.object({
          productId: z.number(),
          productName: z.string(),
          totalQuantity: z.number(),
          unit: z.string()
        }))
      }
    },
    financial: {
      method: 'GET' as const,
      path: '/api/reports/financial' as const,
      responses: {
        200: z.object({
          weeklyRevenue: z.number(),
          monthlyRevenue: z.number(),
          topCompanies: z.array(z.object({ companyName: z.string(), totalSpent: z.number() })),
          topSellingFruits: z.array(z.object({ productName: z.string(), totalSold: z.number() }))
        })
      }
    }
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}