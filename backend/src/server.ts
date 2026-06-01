import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { logger as honoLogger } from 'hono/logger'
import { authMiddleware } from './middleware/auth'
import { apiRoutes } from './routes/index'
import { logger } from './lib/logger'

const serverLogger = logger.child({ component: 'server' })
// Importing the scheduler starts its 30s polling loop at boot (module side-effect),
// exactly as it did inside the Next.js server process. It is a no-op in the browser
// and is skipped under NODE_ENV=test (see lib/scheduler).
import './lib/scheduler'

const PORT = Number(process.env.PORT) || 3000
const PUBLIC_DIR = process.env.PUBLIC_DIR || './public'

const app = new Hono()

app.onError((err, c) => {
  serverLogger.error('Unhandled error', {
    path: c.req.path,
    error: err instanceof Error ? err.message : String(err),
  })
  return c.json({ error: 'Internal server error' }, 500)
})

app.use('*', honoLogger())

// Liveness probe (also exposed under /api/health for the ALB target group).
app.get('/health', (c) => c.text('ok'))

// All /api/* traffic passes the passcode auth gate (which itself allows the
// public candidate-facing and auth/health paths through).
app.use('/api/*', authMiddleware)
app.route('/api', apiRoutes)

// Static SPA bundle (built frontend), baked into the image at ./public.
app.use('/assets/*', serveStatic({ root: PUBLIC_DIR }))
app.use('/favicon.ico', serveStatic({ path: `${PUBLIC_DIR}/favicon.ico` }))

// SPA fallback: any non-/api, non-asset GET returns index.html so client-side
// routing (React Router) can take over.
app.get('*', serveStatic({ path: `${PUBLIC_DIR}/index.html` }))

serve({ fetch: app.fetch, port: PORT }, (info) => {
  serverLogger.info(`Prequel backend listening on :${info.port}`)
})

export { app }
