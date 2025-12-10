// src/worker.ts
// @ts-nocheck
import indexModule from '../index.js';

export interface Env {
    IS_CLOUDFLARE_WORKERS: string;
    // Add other bindings here
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        // Ensure initialization is complete
        // Accessing the exported promise from index.js
        if (indexModule.initPromise) {
             await indexModule.initPromise;
        }

        const url = new URL(request.url);
        const path = url.pathname;
        
        // CORS headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // Landing page
        if (path === '/' || path === '/configure') {
            return new Response(indexModule.landingHTML, {
                headers: { ...corsHeaders, 'Content-Type': 'text/html' }
            });
        }

        // Manifest
        if (path === '/manifest.json') {
            const manifest = indexModule.addonInterface.manifest;
            return new Response(JSON.stringify(manifest), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // Resource handler: /:resource/:type/:id/:extra?.json
        // Regex handles optional extra
        const match = path.match(/^\/([^/]+)\/([^/]+)\/([^/]+)(?:\/([^/]+))?\.json$/);
        
        if (match) {
            const [, resource, type, id, extraStr] = match;
            
            // Basic validation
            if (!indexModule.addonInterface.manifest.resources.includes(resource) && 
                !indexModule.addonInterface.manifest.resources.some(r => r.name === resource)) {
                return new Response('Resource not supported', { status: 404, headers: corsHeaders });
            }

            let extra = {};
            if (extraStr) {
                try {
                    // Stremio extra params parsing
                    // Usually key=value&key2=value2
                    const params = new URLSearchParams(extraStr);
                    for(const [k, v] of params) {
                        extra[k] = v;
                    }
                } catch (e) {
                    console.error("Failed to parse extra:", extraStr);
                }
            }
            
            try {
                const handler = indexModule.addonInterface.get;
                const result = await handler(resource, type, id, extra);
                
                let cacheControl = 'max-age=3600'; // Default
                if (result.cacheMaxAge) {
                    cacheControl = `max-age=${result.cacheMaxAge}`;
                    if (result.staleRevalidate) cacheControl += `, stale-while-revalidate=${result.staleRevalidate}`;
                    if (result.staleError) cacheControl += `, stale-if-error=${result.staleError}`;
                }

                return new Response(JSON.stringify(result), {
                    headers: {
                        ...corsHeaders,
                        'Content-Type': 'application/json',
                        'Cache-Control': cacheControl
                    }
                });
            } catch (err) {
                console.error('Handler error:', err);
                return new Response(JSON.stringify({ err: 'Internal Server Error' }), { status: 500, headers: corsHeaders });
            }
        }

        return new Response('Not Found', { status: 404, headers: corsHeaders });
    }
};

