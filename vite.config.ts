import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { handleApiRequest } from './worker/index.ts';

function cloudflareWorkerDevBridge(): Plugin {
  const attachMiddleware = (middlewares: {
    use: (fn: (req: any, res: any, next: () => void) => void) => void;
  }) => {
    middlewares.use(async (req, res, next) => {
      if (!req.url || !req.url.startsWith('/api/')) return next();

      try {
        const origin = `http://${req.headers.host || 'localhost:5173'}`;
        const webReq = new Request(new URL(req.url, origin).toString(), {
          method: req.method || 'GET',
          headers: req.headers as Record<string, string>,
        });

        const webRes = await handleApiRequest(webReq);
        if (!webRes) return next();

        res.statusCode = webRes.status;
        webRes.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });
        const buf = Buffer.from(await webRes.arrayBuffer());
        res.end(buf);
      } catch (err: any) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: err?.message || 'Worker bridge error' }));
      }
    });
  };

  return {
    name: 'cloudflare-worker-dev-bridge',
    configureServer(server) {
      attachMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), cloudflareWorkerDevBridge()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
