const TARGET_SITE = 'https://webr00t.global.ssl.fastly.net/';

// Pending fetch'leri takip et (aynı URL için duplicate request önleme)
const pendingFetches = new Map();

// Aynı URL için duplicate request önleme (concurrent MISS'leri azalt)
async function fetchWithDedup(url, options) {
    // Eğer aynı URL için zaten bekleyen bir fetch varsa, onu bekle
    if (pendingFetches.has(url)) {
        return await pendingFetches.get(url);
    }
    
    // Yeni fetch başlat
    const fetchPromise = fetchWithRetry(url, options);
    pendingFetches.set(url, fetchPromise);
    
    try {
        const response = await fetchPromise;
        return response;
    } finally {
        // İstek bitince map'ten sil
        pendingFetches.delete(url);
    }
}

// Retry logic ile fetch (503 bypass için) - hızlı fail
async function fetchWithRetry(url, options, maxRetries = 2) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            // Timeout ile fetch (10 saniye)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const fetchOptions = {
                ...options,
                signal: controller.signal
            };
            
            const response = await fetch(url, fetchOptions);
            clearTimeout(timeoutId);
            
            // 503 veya 429 (rate limit) alırsak tekrar dene
            if ((response.status === 503 || response.status === 429) && i < maxRetries - 1) {
                // Hızlı exponential backoff: 50ms, 150ms, 300ms
                const delay = 50 + (i * 100);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            return response;
        } catch (error) {
            // Timeout veya network hatası
            if (error.name === 'AbortError') {
                console.error(`Fetch timeout on attempt ${i + 1} for ${url}`);
            }
            
            if (i === maxRetries - 1) throw error;
            
            // Hata olursa kısa bekle
            await new Promise(resolve => setTimeout(resolve, 50 + (i * 50)));
        }
    }
}

// Stale-while-revalidate için cache yenileme fonksiyonu
async function revalidateCache(targetUrl, cacheKey, cache) {
    try {
        const headers = new Headers();
        headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        headers.set('Accept', 'image/jpeg,image/*,*/*');
        headers.set('Accept-Encoding', 'gzip, deflate, br');
        headers.set('Referer', 'https://www.google.com/');
        
        const response = await fetchWithDedup(targetUrl, {
            method: 'GET',
            headers: headers,
            cf: {
                cacheTtl: 604800,
                cacheEverything: true,
                polish: 'lossy',
                mirage: true,
                scrapeShield: false,
                apps: false,
                cacheKey: targetUrl.split('?')[0],
                image: {
                    quality: 85,
                    format: 'auto',
                    metadata: 'none',
                }
            }
        });
        
        if (response.ok) {
            const responseHeaders = new Headers();
            ['content-type', 'content-length', 'etag', 'last-modified'].forEach(header => {
                const value = response.headers.get(header);
                if (value) responseHeaders.set(header, value);
            });
            
            responseHeaders.set('Access-Control-Allow-Origin', '*');
            responseHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
            responseHeaders.set('Accept-Ranges', 'bytes');
            responseHeaders.set('Date', new Date().toUTCString());
            
            const responseToCache = new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders
            });
            
            await cache.put(cacheKey, responseToCache);
        }
    } catch (error) {
        // Yenileme başarısız olsa bile sorun değil, eski cache kullanılıyor
        console.error('Cache revalidation failed:', error);
    }
}

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);

    // CORS Preflight (OPTIONS) isteklerini handle et
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': 'Origin, Referer, Accept, Accept-Encoding, Range, User-Agent',
                'Access-Control-Max-Age': '86400',
            }
        });
    }

    const isJpg = /\.jpg$/i.test(url.pathname);
    
    if (!isJpg) {
        return new Response('Forbidden', {
            status: 403,
            headers: {
                'X-Block-Reason': 'Invalid-Extension',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }

    const referer = request.headers.get('Referer') || request.headers.get('referer');
    
    if (!referer) {
        return new Response('Forbidden', {
            status: 403,
            headers: {
                'X-Block-Reason': 'No-Referer',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }

    // rf.gd referer'ını engelle
    if (referer.includes('rf.gd')) {
        return new Response('Forbidden', {
            status: 403,
            headers: {
                'X-Block-Reason': 'Blocked-Referer',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn/')) {
        return context.next();
    }

    try {
        const targetUrl = new URL(url.pathname + url.search, TARGET_SITE);

        // ÖNEMLİ: Cache key olarak kendi URL'imizi kullan (target URL değil!)
        // Böylece aynı path için cache çalışır
        const cache = caches.default;
        
        // Range request'leri için base URL'i kullan (query string olmadan)
        const cacheKeyUrl = new URL(url.pathname, request.url);
        const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });
        
        let cachedResponse = await cache.match(cacheKey);
        
        // Cache'de varsa DIREKT dön, origin'e hiç gitme
        if (cachedResponse) {
            const newHeaders = new Headers(cachedResponse.headers);
            
            // Cache yaşını kontrol et (stale-while-revalidate için)
            const cachedDate = cachedResponse.headers.get('Date');
            const cacheAge = cachedDate ? (Date.now() - new Date(cachedDate).getTime()) / 1000 : 0;
            const isStale = cacheAge > 604800; // 7 günden eski mi? (daha uzun cache kullanımı)
            
            // Sadece gerekli header'lar
            newHeaders.set('CF-Cache-Status', 'HIT');
            newHeaders.set('Access-Control-Allow-Origin', '*');
            newHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, CF-Cache-Status');
            newHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
            newHeaders.set('Timing-Allow-Origin', '*');
            newHeaders.set('X-Content-Type-Options', 'nosniff');
            
            // Eğer cache eski ise, arka planda yenilemeyi dene (stale-while-revalidate)
            if (isStale) {
                // Arka planda yenileme yap (kullanıcıyı bekletme!)
                context.waitUntil(revalidateCache(targetUrl.toString(), cacheKey, cache));
            }
            
            // Range request ise, cache'den range'i serve et
            const rangeHeader = request.headers.get('Range');
            if (rangeHeader && cachedResponse.status === 200) {
                const contentLength = parseInt(cachedResponse.headers.get('Content-Length') || '0');
                const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
                
                if (rangeMatch && contentLength > 0) {
                    const start = parseInt(rangeMatch[1]);
                    const end = rangeMatch[2] ? parseInt(rangeMatch[2]) : contentLength - 1;
                    
                    // Body'yi slice et
                    const blob = await cachedResponse.blob();
                    const slicedBlob = blob.slice(start, end + 1);
                    
                    newHeaders.set('Content-Length', (end - start + 1).toString());
                    newHeaders.set('Content-Range', `bytes ${start}-${end}/${contentLength}`);
                    newHeaders.set('Accept-Ranges', 'bytes');
                    
                    return new Response(slicedBlob, {
                        status: 206,
                        statusText: 'Partial Content',
                        headers: newHeaders
                    });
                }
            }
            
            return new Response(cachedResponse.body, {
                status: cachedResponse.status,
                statusText: cachedResponse.statusText,
                headers: newHeaders
            });
        }

        // Cache'de yok, origin'e git (sadece bir kez)
        // ÖNEMLİ: IP forwarding YAPMIYORUZ! Tüm istekler Cloudflare IP'sinden gitsin
        // Böylece Fastly için tek bir client gibi görünürüz
        const headers = new Headers();
        
        // Sabit bir User-Agent kullan (tüm istekler aynı client gibi görünsün)
        headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        headers.set('Accept', 'image/jpeg,image/*,*/*');
        headers.set('Accept-Encoding', 'gzip, deflate, br');
        headers.set('Referer', 'https://www.google.com/');
        headers.set('Connection', 'keep-alive');

        // fetchWithDedup kullan - aynı URL için duplicate request'leri önle
        const originResponse = await fetchWithDedup(targetUrl.toString(), {
            method: 'GET',
            headers: headers,
            cf: {
                // Cache ayarları
                cacheTtl: 604800, // 7 gün cache
                cacheEverything: true,
                
                // Resim optimizasyonu (agresif)
                polish: 'lossy',
                
                // Mirage otomatik image optimization (mobil için)
                mirage: true,
                
                // Gereksiz overhead'leri kapat (daha hızlı)
                scrapeShield: false,
                apps: false,
                
                // Cache key optimizasyonu (query string ignore)
                cacheKey: targetUrl.toString().split('?')[0],
                
                // Resim optimizasyon detayları (CF Image Resizing gibi)
                image: {
                    quality: 85, // %85 kalite (hız/kalite dengesi)
                    format: 'auto', // WebP/AVIF otomatik
                    metadata: 'none', // EXIF data kaldır (küçük dosya)
                }
            }
        });

        // Cloudflare'in kendi cache durumunu kontrol et
        const cfCacheStatus = originResponse.headers.get('cf-cache-status') || 'MISS';

        // Response başarılıysa cache'e kaydet
        if (originResponse.ok) {
            // Yeni response header'ları oluştur
            const responseHeaders = new Headers();
            
            const allowedHeaders = [
                'content-type',
                'content-length',
                'etag',
                'last-modified'
            ];
            
            allowedHeaders.forEach(header => {
                const value = originResponse.headers.get(header);
                if (value) {
                    responseHeaders.set(header, value);
                }
            });
            
            responseHeaders.set('Access-Control-Allow-Origin', '*');
            responseHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, CF-Cache-Status');
            responseHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
            responseHeaders.set('Accept-Ranges', 'bytes');
            responseHeaders.set('Date', new Date().toUTCString());
            responseHeaders.set('CF-Cache-Status', cfCacheStatus);
            responseHeaders.set('Timing-Allow-Origin', '*');
            responseHeaders.set('X-Content-Type-Options', 'nosniff');

            // Response'u klonla ve cache'e kaydet
            const responseToCache = new Response(originResponse.body, {
                status: originResponse.status,
                statusText: originResponse.statusText,
                headers: responseHeaders
            });

            // ÖNEMLI: Cache'e kaydetmeden önce klonla
            const responseToReturn = responseToCache.clone();
            
            // Cache'e asenkron kaydet (BLOKLAMA YOK!)
            // waitUntil kullanarak arka planda cache'e yaz
            context.waitUntil(cache.put(cacheKey, responseToCache));
            
            return responseToReturn;
        }

        // Hata durumu (503, 429 vs.)
        // NOT: 503 genellikle origin server'ın yavaş/overloaded olduğunu gösterir
        // Bu NORMAL bir durum olabilir - cache doldukça azalır
        const errorMessage = originResponse.status === 503 
            ? 'Origin server yavaş veya overloaded (503). Cache doldukça bu hata azalacak. Retry edildi ama başarısız oldu.'
            : originResponse.status === 429
            ? 'Rate limit aşıldı (429). Lütfen birkaç saniye bekleyin.'
            : 'Origin sunucudan veri alınamadı';
            
        return new Response(errorMessage, {
            status: originResponse.status,
            statusText: originResponse.statusText,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'X-Origin-Status': originResponse.status.toString(),
                'X-Error-Type': originResponse.status === 503 ? 'service-unavailable' : 'origin-error',
                'X-Retry-Count': '2',
                'X-Retry-Delays': '50ms, 150ms (hızlı fail)',
                'X-Info': '503 hataları origin server CPU/yük nedeniyle oluyor. Cloudflare Pages CPU limiti değil.',
                'Retry-After': '3'
            }
        });

    } catch (error) {
        // Detaylı error logging
        console.error('Proxy error:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name,
            url: url.pathname
        });
        
        // Kullanıcıya daha açıklayıcı mesaj
        const errorType = error.name === 'TypeError' ? 'network-error' : 
                         error.message?.includes('timeout') ? 'timeout' :
                         error.message?.includes('cache') ? 'cache-error' :
                         'unknown-error';
        
        return new Response(`Sunucu hatası: ${error.message || 'Bilinmeyen hata'}`, {
            status: 500,
            headers: {
                'X-Error-Type': errorType,
                'X-Error-Message': error.message || 'Unknown',
                'X-Error-Name': error.name || 'Error',
                'Access-Control-Allow-Origin': '*',
                'X-Debug-Info': 'Check server logs for details'
            }
        });
    }
}
