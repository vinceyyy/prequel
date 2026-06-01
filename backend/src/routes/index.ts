import { Hono } from 'hono'
import { adminRouter } from './admin'
import { apikeyPublicRouter } from './apikeyPublic'
import { apikeysRouter } from './apikeys'
import { authRouter } from './auth'
import { challengesRouter } from './challenges'
import { healthRouter } from './health'
import { interviewsRouter } from './interviews'
import { operationsRouter } from './operations'
import { takehomePublicRouter } from './takehomePublic'
import { takehomesRouter } from './takehomes'

/**
 * All API routers, mounted under /api by the server. Path prefixes here mirror
 * the original Next.js route folders 1:1 so the frontend's fetch URLs are
 * unchanged. Singular `apikey`/`takehome` are the public candidate routes;
 * plural `apikeys`/`takehomes` are the authenticated management routes.
 */
export const apiRoutes = new Hono()

apiRoutes.route('/auth', authRouter)
apiRoutes.route('/health', healthRouter)
apiRoutes.route('/interviews', interviewsRouter)
apiRoutes.route('/operations', operationsRouter)
apiRoutes.route('/takehomes', takehomesRouter)
apiRoutes.route('/takehome', takehomePublicRouter)
apiRoutes.route('/apikeys', apikeysRouter)
apiRoutes.route('/apikey', apikeyPublicRouter)
apiRoutes.route('/challenges', challengesRouter)
apiRoutes.route('/admin', adminRouter)
