// Cloudflare Pages Middleware - Reverse Proxy
// Tüm istekleri hedef siteye yönlendirir

const TARGET_SITE = 'https://w0rk3rsb4ckd00r.global.ssl.fastly.net/';

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);

    // Sadece .jpg uzantısına izin ver
    const isJpg = /\.jpg$/i.test(url.pathname);
    
    if (!isJpg) {
        return new Response('Forbidden', {
            status: 403,
            headers: {
                'X-Block-Reason': 'Invalid-Extension'
            }
        });
    }

    // Referer kontrolü - Hotlink Protection
    const referer = request.headers.get('Referer') || request.headers.get('referer');
    
    if (!referer) {
        return new Response('Forbidden', {
            status: 403,
            headers: {
                'X-Block-Reason': 'No-Referer'
            }
        });
    }

    // API endpoint'lerini bypass et (eğer kullanmak isterseniz)
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn/')) {
        return context.next();
    }

    try {
        // Hedef URL'i oluştur
        const targetUrl = new URL(url.pathname + url.search, TARGET_SITE);

        // Request header'larını kopyala
        const headers = new Headers(request.headers);
        headers.set('Host', new URL(TARGET_SITE).host);
        headers.set('Referer', TARGET_SITE);
        headers.set('Origin', TARGET_SITE);

        // Cache kontrolü - sadece URL'e göre
        const cache = caches.default;
        const cacheKey = new Request(targetUrl.toString(), { method: 'GET' });
        let response = await cache.match(cacheKey);

        // Cache'de yoksa fetch et
        if (!response) {
            const originResponse = await fetch(targetUrl.toString(), {
                method: request.method,
                headers: headers,
                body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
                cf: {
                    cacheTtl: 604800,  // 7 gün
                    cacheEverything: true,
                }
            });

            // Başarılıysa cache'e kaydet
            if (originResponse.ok) {
                // Clone'u ÖNCE yap, sonra cache'e at
                response = originResponse.clone();
                context.waitUntil(cache.put(cacheKey, originResponse));
            } else {
                response = originResponse;
            }
        }

        // Temiz header'lar oluştur - Fastly header'larını temizle
        const newHeaders = new Headers();
        
        // Sadece gerekli header'ları kopyala
        const allowedHeaders = [
            'content-type',
            'content-length',
            'etag',
            'last-modified',
            'accept-ranges',
            'cf-cache-status'  // Cache durumunu görmek için
        ];
        
        allowedHeaders.forEach(header => {
            const value = response.headers.get(header);
            if (value) {
                newHeaders.set(header, value);
            }
        });
        
        // CORS header
        newHeaders.set('Access-Control-Allow-Origin', '*');
        
        // Cache control - 24 saat (86400 saniye)
        if (response.ok && request.method === 'GET') {
            newHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
        }
        
        // DEBUG: Cache durumunu göster
        newHeaders.set('X-Cache-Status', response.headers.get('cf-cache-status') || 'MANUAL-CACHE');
        
        // Cloudflare cache status'u ekle (eğer yoksa)
        if (!newHeaders.has('cf-cache-status')) {
            const cacheStatus = response.headers.get('cf-cache-status');
            if (cacheStatus) {
                newHeaders.set('CF-Cache-Status', cacheStatus);
            }
        }

        // Response döndür
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

