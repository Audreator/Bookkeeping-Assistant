import type { FastifyInstance } from 'fastify'
import { registerBillRoutes } from './bills.ts'
import { registerCategoryRoutes } from './categories.ts'
import { registerDayOverrideRoutes } from './dayoverrides.ts'
import { registerEventRoutes } from './events.ts'
import { registerSettingRoutes } from './settings.ts'
import { registerTransactionRoutes } from './transactions.ts'

/** 所有业务路由统一挂 JWT 鉴权（app.authenticate） */
export function registerBusinessRoutes(app: FastifyInstance) {
  app.register(async (scope) => {
    scope.addHook('preHandler', app.authenticate)
    registerCategoryRoutes(scope)
    registerTransactionRoutes(scope)
    registerEventRoutes(scope)
    registerBillRoutes(scope)
    registerDayOverrideRoutes(scope)
    registerSettingRoutes(scope)
  })
}
