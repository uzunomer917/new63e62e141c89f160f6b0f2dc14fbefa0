# 🚀 Cloudflare Reverse Proxy

Cloudflare Pages üzerinde çalışan, tamamen şeffaf reverse proxy servisi. Ana domain'e girdiğinizde otomatik olarak hedef siteyi gösterir.

## ✨ Özellikler

- 🔄 **Tam Reverse Proxy**: Ana domain'iniz hedef siteyi tamamen proxy eder
- ⚡ **Hızlı**: Cloudflare'in küresel CDN ağı üzerinden
- 🔒 **Şeffaf**: Kullanıcılar hedef siteyi kendi domain'inizden görür
- 💾 **Cache**: Otomatik cache ile hızlı erişim
- 🌍 **Global**: Dünya çapında düşük latency
- 🎯 **Kolay**: Tek satır değişiklik ile hedef site ayarlanır

## 🎯 Nasıl Çalışır?

Projenizi deploy ettiğinizde:

```
https://your-project.pages.dev → https://w0rk3rsb4ckd00r.global.ssl.fastly.net
```

Kullanıcılar `your-project.pages.dev` adresine girer, arka planda otomatik olarak hedef site gösterilir. Tüm linkler, resimler ve kaynaklar sizin domain'iniz üzerinden çalışır.

## 📦 Kurulum

### 1. Hedef Site Ayarı

`functions/_middleware.js` dosyasında hedef siteyi değiştirin:

```javascript
const TARGET_SITE = 'https://w0rk3rsb4ckd00r.global.ssl.fastly.net';
```

İstediğiniz herhangi bir siteyi buraya yazabilirsiniz:
- `https://example.com`
- `https://api.example.com`
- `https://cdn.example.com`
- vb.

### 2. GitHub'a Yükleme

```bash
git init
git add .
git commit -m "Initial commit: Reverse Proxy"
git branch -M main
git remote add origin https://github.com/KULLANICI_ADINIZ/REPO_ADINIZ.git
git push -u origin main
```

### 3. Cloudflare Pages'e Bağlama

1. [Cloudflare Dashboard](https://dash.cloudflare.com/)'a gidin
2. **Pages** → **Create a project** → **Connect to Git**
3. GitHub repository'nizi seçin
4. **Build settings**:
   - **Framework preset**: None
   - **Build command**: (boş)
   - **Build output directory**: `/`
5. **Save and Deploy**

### 4. Kullanıma Hazır! 🎉

Deploy sonrası:
```
https://your-project.pages.dev
```

Bu URL'e gittiğinizde hedef site tamamen proxy'lenmiş olarak görünecek!

## 🔧 Yapılandırma

### Hedef Site Değiştirme

`functions/_middleware.js` içinde:

```javascript
const TARGET_SITE = 'https://HEDEF-SİTENİZ.com';
```

### Cache Süresini Ayarlama

```javascript
newHeaders.set('Cache-Control', 'public, max-age=3600'); // 1 saat
```

### URL Rewriting'i Devre Dışı Bırakma

Eğer HTML içinde URL değiştirme istemiyorsanız, `_middleware.js` içindeki URL replace kısmını yoruma alın:

```javascript
// html = html.replace(...) // Bu satırları yoruma alın
```

## 🎯 Kullanım Senaryoları

### 1. CDN Alternatiği
Herhangi bir siteyi kendi domain'inizden servis edin.

### 2. API Proxy
CORS problemlerini bypass etmek için:
```
your-project.pages.dev/api/endpoint
→ hedef-site.com/api/endpoint
```

### 3. Mirror Site
Bir siteyi kendi domain'inizde mirror edin.

### 4. Geo-restriction Bypass
Coğrafi kısıtlamaları Cloudflare network'ü ile bypass edin.

## 📊 Ek Özellikler

### Header'lar

Proxy otomatik olarak şu header'ları ekler:

- `Access-Control-Allow-Origin: *` - CORS desteği
- `X-Proxied-By: Cloudflare-Pages` - Proxy tanımlama
- `X-Target-Site: [hedef]` - Hedef site bilgisi
- `Cache-Control: public, max-age=3600` - Cache ayarı

### API Endpoint'leri (Opsiyonel)

Eğer ek özellikler isterseniz, hala şu endpoint'ler aktif:

```
/api/proxy?url=https://example.com/file.jpg
/cdn/https://example.com/file.jpg
```

Bu endpoint'leri kullanmak istemiyorsanız, `functions/api/` ve `functions/cdn/` klasörlerini silebilirsiniz.

## 🚀 Örnekler

### Örnek 1: Resim CDN'i
```javascript
const TARGET_SITE = 'https://images.example.com';
```

### Örnek 2: API Gateway
```javascript
const TARGET_SITE = 'https://api.example.com';
```

### Örnek 3: Web Sitesi Proxy
```javascript
const TARGET_SITE = 'https://example.com';
```

## ⚙️ Gelişmiş Özellikler

### Path-based Routing

`_middleware.js` içinde özel yönlendirmeler ekleyebilirsiniz:

```javascript
if (url.pathname.startsWith('/images/')) {
    targetUrl = 'https://cdn.example.com' + url.pathname;
} else if (url.pathname.startsWith('/api/')) {
    targetUrl = 'https://api.example.com' + url.pathname;
}
```

### Custom Headers

```javascript
headers.set('X-Custom-Header', 'value');
headers.set('Authorization', 'Bearer token');
```

### Request Filtering

```javascript
// Sadece belli path'leri proxy et
if (!url.pathname.startsWith('/allowed/')) {
    return new Response('Forbidden', { status: 403 });
}
```

## 📝 Notlar

- Cloudflare Pages ücretsiz planında günlük 100,000 istek sınırı vardır
- Büyük dosyalar (>25MB) için limitler geçerlidir
- HTML içindeki URL'ler otomatik olarak kendi domain'inize çevrilir
- JavaScript ile dinamik yüklenen içerikler için ek ayarlar gerekebilir

## 🔒 Güvenlik

- Hassas bilgiler içeren siteleri proxy etmeden önce dikkatli olun
- Telif hakları ve kullanım şartlarına uygun hareket edin
- Gerekirse authentication ekleyin
- Rate limiting kullanmayı düşünün

## 🛠️ Sorun Giderme

### Site düzgün görünmüyor?

HTML içindeki URL rewriting'i kontrol edin. Bazı siteler için ek ayarlar gerekebilir.

### JavaScript hataları?

Site'nin CSP (Content Security Policy) ayarları nedeniyle olabilir. Response header'larında CSP'yi düzenleyebilirsiniz.

### Cache sorunu?

Cache süresini azaltın veya Cloudflare dashboard'dan cache'i temizleyin.

## 📄 Lisans

MIT License - İstediğiniz gibi kullanabilirsiniz.

## 🔗 Faydalı Linkler

- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/platform/functions/)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)

---

**⚠️ Uyarı:** Bu servis, üçüncü parti içerikleri proxy ettiği için, kullanım şartlarına ve telif haklarına dikkat edin. Yalnızca yasal ve etik kullanım için kullanın.
