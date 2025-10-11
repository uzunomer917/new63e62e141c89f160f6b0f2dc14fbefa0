// Cloudflare Pages Middleware - Reverse Proxy
// Tüm istekleri hedef siteye yönlendirir

const TARGET_SITE = 'http://cdn.gali.futbol/';

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

        // Hedef siteye istek yap - Cloudflare cache ile
        const response = await fetch(targetUrl.toString(), {
            method: request.method,
            headers: headers,
            body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
            redirect: 'manual',
            cf: {
                // Cloudflare edge cache ayarları
                cacheTtl: 7200,              // 2 saat cache (saniye)
                cacheEverything: true,        // Her şeyi cache'le
                cacheKey: targetUrl.toString() // Cache key
            }
        });

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
        
        // Cache control - 2 saat (7200 saniye)
        if (response.ok && request.method === 'GET') {
            newHeaders.set('Cache-Control', 'public, max-age=7200, s-maxage=86400');
        }
        
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
