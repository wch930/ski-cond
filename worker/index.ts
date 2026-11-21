import { ALLOWED_WEBCAM_HOSTS, getLiveConditions } from './liveConditions.ts';

export interface Env {
  ASSETS?: {
    fetch: (input: Request | URL | string) => Promise<Response>;
  };
}

const EDGE_CACHE_SECONDS = 300; // 5 minutes at Cloudflare POP

/**
 * Pure Web-Standard API handler shared between Cloudflare Workers runtime and Vite local dev server.
 * Returns null if pathname does not match an `/api/*` endpoint.
 */
interface EdgeCacheLike {
  match: (request: Request) => Promise<Response | undefined>;
  put: (request: Request, response: Response) => Promise<void>;
}

export async function handleApiRequest(
  request: Request,
  env?: Env,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === '/api/conditions') {
    const forceRefresh = url.searchParams.get('refresh') === '1';
    const edgeCache =
      (globalThis as unknown as { caches?: { default?: EdgeCacheLike } }).caches?.default ?? null;
    const cacheKey = new Request(new URL('/api/conditions', url.origin).toString(), {
      method: 'GET',
    });

    if (!forceRefresh && edgeCache) {
      const hit = await edgeCache.match(cacheKey);
      if (hit) return hit;
    }

    try {
      const payload = await getLiveConditions({ forceRefresh });
      const body = JSON.stringify(payload);
      const response = new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': forceRefresh
            ? 'no-store'
            : `public, max-age=60, s-maxage=${EDGE_CACHE_SECONDS}`,
        },
      });

      if (edgeCache && !forceRefresh) {
        const putPromise = edgeCache.put(cacheKey, response.clone());
        if (waitUntil) waitUntil(putPromise);
        else await putPromise;
      }
      return response;
    } catch (err: unknown) {
      // Fallback to static snapshot via Cloudflare Workers ASSETS binding if available
      if (env?.ASSETS) {
        const fallbackRes = await env.ASSETS.fetch(
          new URL('/data/fallback-conditions.json', url.origin)
        );
        if (fallbackRes.ok) return fallbackRes;
      }
      const message = err instanceof Error ? err.message : 'Failed to fetch live conditions';
      return new Response(JSON.stringify({ error: message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
  }

  if (url.pathname === '/api/webcam') {
    const target = url.searchParams.get('url');
    if (!target) {
      return new Response('Missing url parameter', { status: 400 });
    }
    try {
      const targetUrl = new URL(target);
      if (!ALLOWED_WEBCAM_HOSTS.has(targetUrl.hostname)) {
        return new Response('Webcam host not allowed', { status: 403 });
      }
      const upstream = await fetch(
        targetUrl.toString(),
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PowderlineSkiConditions/1.0)',
          },
          cf: {
            cacheTtl: 60,
            cacheEverything: true,
          },
        } as RequestInit
      );
      if (!upstream.ok) {
        return new Response('Webcam unavailable', { status: upstream.status });
      }
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
          'Cache-Control': 'public, max-age=60',
        },
      });
    } catch {
      return new Response('Webcam proxy error', { status: 502 });
    }
  }

  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  return null;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: { waitUntil: (promise: Promise<unknown>) => void }
  ): Promise<Response> {
    const apiRes = await handleApiRequest(request, env, (p) => ctx.waitUntil(p));
    if (apiRes) return apiRes;

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Not Found', { status: 404 });
  },
};
