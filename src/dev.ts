import { serve } from '@hono/node-server'
import app from './index.js'

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.PORT ?? '3000') }, (info) => {
  console.log(`argentina-mcp is listening at http://127.0.0.1:${info.port}/mcp`)
})
