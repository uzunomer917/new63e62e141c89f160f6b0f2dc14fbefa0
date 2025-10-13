const TARGET_SITE = 'https://w0rk3rsb4ckd00r.global.ssl.fastly.net/';

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);

    const isJpg = /\.jpg$/i.test(url.pathname);
    
    if (!isJpg) {
        return new Response('Forbidden', {
            status: 403,
            headers: {
                'X-Block-Reason': 'Invalid-Extension'
            }
        });
    }

    const referer = request.headers.get('Referer') || request.headers.get('referer');
    
    if (!referer) {
        return new Response('Forbidden', {
            status: 403,
            headers: {
                'X-Block-Reason': 'No-Referer'
            }
        });
    }

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn/')) {
        return context.next();
    }

    try {
        const targetUrl = new URL(url.pathname + url.search, TARGET_SITE);

        const headers = new Headers(request.headers);
        headers.set('Host', new URL(TARGET_SITE).host);
        headers.set('Referer', TARGET_SITE);
        headers.set('Origin', TARGET_SITE);

        const cache = caches.default;
        const cacheKey = new Request(targetUrl.toString(), { method: 'GET' });
        let response = await cache.match(cacheKey);

        if (!response) {
            const originResponse = await fetch(targetUrl.toString(), {
                method: request.method,
                headers: headers,
                body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
                cf: {
                    cacheTtl: 604800,
                    cacheEverything: true,
                }
            });

            if (originResponse.ok) {
                response = originResponse.clone();
                context.waitUntil(cache.put(cacheKey, originResponse));
            } else {
                response = originResponse;
            }
        }

        const newHeaders = new Headers();
        
        const allowedHeaders = [
            'content-type',
            'content-length',
            'etag',
            'last-modified',
            'accept-ranges',
            'cf-cache-status'
        ];
        
        allowedHeaders.forEach(header => {
            const value = response.headers.get(header);
            if (value) {
                newHeaders.set(header, value);
            }
        });
        
        newHeaders.set('Access-Control-Allow-Origin', '*');
        
        if (response.ok && request.method === 'GET') {
            newHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
        }
        
        newHeaders.set('X-Cache-Status', response.headers.get('cf-cache-status') || 'MANUAL-CACHE');
        
        if (!newHeaders.has('cf-cache-status')) {
            const cacheStatus = response.headers.get('cf-cache-status');
            if (cacheStatus) {
                newHeaders.set('CF-Cache-Status', cacheStatus);
            }
        }

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
        });

    } catch (error) {
        return new Response('Internal Server Error', {
            status: 500
        });
    }
}
