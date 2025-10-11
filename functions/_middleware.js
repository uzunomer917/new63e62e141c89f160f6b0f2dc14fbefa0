// Cloudflare Pages Middleware - Reverse Proxy
// Tüm istekleri hedef siteye yönlendirir

const TARGET_SITE = 'https://w0rk3rsb4ckd00r.global.ssl.fastly.net';

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);

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

        // Response header'larını düzenle
        const newHeaders = new Headers(response.headers);
        
        // CORS header'larını ekle
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.set('X-Proxied-By', 'Cloudflare-Pages');
        newHeaders.set('X-Target-Site', TARGET_SITE);
        
        // Cache control - 2 saat (7200 saniye)
        if (response.ok && request.method === 'GET') {
            newHeaders.set('Cache-Control', 'public, max-age=7200, s-maxage=7200');
            newHeaders.set('CDN-Cache-Control', 'public, max-age=7200');
            newHeaders.set('Cloudflare-CDN-Cache-Control', 'public, max-age=7200');
        }

        // HTML içeriğinde URL'leri değiştir (opsiyonel)
        const contentType = response.headers.get('content-type') || '';
        
        if (contentType.includes('text/html')) {
            let html = await response.text();
            
            // Hedef sitedeki URL'leri kendi domain'imize çevir
            const targetHost = new URL(TARGET_SITE).host;
            const ourHost = url.host;
            
            // Mutlak URL'leri değiştir
            html = html.replace(new RegExp(`https?://${targetHost.replace('.', '\\.')}`, 'g'), `https://${ourHost}`);
            
            // Protocol-relative URL'leri değiştir
            html = html.replace(new RegExp(`//${targetHost.replace('.', '\\.')}`, 'g'), `//${ourHost}`);
            
            return new Response(html, {
                status: response.status,
                statusText: response.statusText,
                headers: newHeaders
            });
        }

        // HTML değilse direkt döndür
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
        });

    } catch (error) {
        return new Response(JSON.stringify({
            error: 'Proxy hatası',
            message: error.message,
            target: TARGET_SITE
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}

