# Deployment Rehberi

YouTube Hikaye Otomasyon sistemini Vercel'e deploy etmek için adım adım rehber.

## Ön Hazırlık

### 1. API Key'leri Toplayın

Aşağıdaki servislere kayıt olun ve API key'lerinizi alın:

- **MongoDB Atlas**: [cloud.mongodb.com](https://cloud.mongodb.com)
- **OpenAI**: [platform.openai.com](https://platform.openai.com)
- **ElevenLabs**: [elevenlabs.io](https://elevenlabs.io)
- **Google Account** (ImageFX için)
- **Inngest**: [inngest.com](https://inngest.com)

### 2. Google ImageFX Cookie'sini Alın

1. [imagefx.google.com](https://imagefx.google.com) adresine gidin
2. Google hesabınızla giriş yapın
3. Chrome DevTools'u açın (F12)
4. Application tab > Cookies > `__Secure-1PSID` değerini kopyalayın

⚠️ **ÖNEMLİ**: Cookie süresi dolduğunda (genelde 1-2 hafta) yenilemeniz gerekir.

## Vercel Deployment

### 1. GitHub Repository Oluşturun

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-repo-url>
git push -u origin main
```

### 2. Vercel'e Deploy Edin

1. [vercel.com](https://vercel.com) hesabınıza giriş yapın
2. "New Project" > GitHub repo'nuzu seçin
3. Framework Preset: **Next.js** otomatik algılanır
4. "Deploy" butonuna tıklamadan önce Environment Variables ekleyin

### 3. Environment Variables

Vercel Dashboard > Project Settings > Environment Variables

Aşağıdaki tüm değişkenleri ekleyin:

```env
# MongoDB
MONGODB_URI=mongodb+srv://...

# OpenAI
OPENAI_API_KEY=sk-...

# ElevenLabs
ELEVENLABS_API_KEY=...

# ImageFX
GOOGLE_COOKIE=__Secure-1PSID=...

# Vercel Blob Storage (Deployment sonrası eklenecek)
BLOB_READ_WRITE_TOKEN=

# Inngest (Deployment sonrası eklenecek)
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# Next.js
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
NODE_ENV=production
```

### 4. İlk Deployment

"Deploy" butonuna tıklayın. İlk deployment 3-5 dakika sürer.

## Post-Deployment Konfigürasyonu

### 1. Vercel Blob Storage Kurulumu

1. Vercel Dashboard > Storage > Create Database > Blob
2. "Create" butonuna tıklayın
3. Projenize bağlayın
4. Token otomatik olarak environment variables'a eklenecek
5. Deployment'ı yeniden tetikleyin (redeploy)

### 2. Inngest Webhook Konfigürasyonu

1. [Inngest Dashboard](https://app.inngest.com) > Create Project
2. Project Settings > Webhook URL:
   ```
   https://your-app.vercel.app/api/inngest
   ```
3. Event Key ve Signing Key'leri kopyalayın
4. Vercel Environment Variables'a ekleyin:
   - `INNGEST_EVENT_KEY`
   - `INNGEST_SIGNING_KEY`
5. Deployment'ı yeniden tetikleyin

### 3. Test Edin

1. `https://your-app.vercel.app` adresine gidin
2. Basit bir hikaye oluşturun (kısa test metni)
3. Dashboard'da progress'i izleyin
4. Inngest Dashboard'da function çalışmalarını kontrol edin

## Önemli Notlar

### Rate Limits & Quotas

- **OpenAI**: Tier limitlerini kontrol edin
- **ElevenLabs**: Aylık karakter limitini takip edin
- **Vercel Blob**: Free tier 1GB/ay
- **Inngest Hobby Plan**: 
  - 50,000 function runs/ay
  - 100 paralel execution
  - Yeterli olmalı (ortalama 1 story = ~100 function call)

### Google Cookie Yenileme

Cookie süresi dolduğunda:
1. Yeni cookie alın
2. Vercel Environment Variables'ı güncelleyin
3. Redeploy gerekmez (runtime'da güncellenir)

### MongoDB Connection

Production'da:
1. IP whitelist: `0.0.0.0/0` (tüm IP'ler)
2. Database user: Read/Write yetkisi
3. Connection pooling: Default (10)

### Vercel Limitations

- **Serverless Function Timeout**: 
  - Hobby: 10 saniye
  - Pro: 60 saniye
  - ⚠️ Inngest bu sorunu çözer (background jobs)
  
- **Build Time**: 45 dakika (yeterli)

## Monitoring & Debugging

### Logs

1. **Vercel Logs**: 
   - Dashboard > Deployments > Logs
   - Real-time function logs

2. **Inngest Logs**:
   - Dashboard > Runs
   - Her function çalışmasını detaylı gösterir

3. **MongoDB Logs**:
   - Atlas Dashboard > Monitoring

### Sık Karşılaşılan Hatalar

**"Function timeout exceeded"**
- Sorun: Serverless function 10 saniyede timeout oluyor
- Çözüm: Inngest kullanıldığı için bu olmamalı. API route'larını kontrol edin.

**"MongoDB connection refused"**
- Sorun: IP whitelist veya connection string hatası
- Çözüm: Atlas'ta IP whitelist'i kontrol edin (`0.0.0.0/0`)

**"Inngest function not triggered"**
- Sorun: Webhook URL yanlış veya signing key hatalı
- Çözüm: Inngest Dashboard > Settings > Webhook URL'i kontrol edin

**"ImageFX cookie expired"**
- Sorun: Google cookie süresi dolmuş
- Çözüm: Yeni cookie alın ve env variables'ı güncelleyin

## Scaling

### Inngest Plan Upgrade (İhtiyaç Duyarsanız)

| Plan | Fiyat | Function Runs | Paralel Execution |
|------|-------|---------------|-------------------|
| Hobby | $0 | 50K/ay | 100 |
| Pro | $20/ay | 500K/ay | 500 |
| Scale | $100/ay | 5M/ay | 2000 |

### Vercel Plan Upgrade

Hobby plan çoğu kullanım için yeterli. Pro gerekirse:
- Daha uzun function timeout (60s)
- Analytics
- Team collaboration

## Backup & Recovery

### MongoDB Backup

1. Atlas Dashboard > Clusters > Backup
2. Automatic backups: Free tier'da 2 gün
3. Manual snapshot: İstediğiniz zaman

### Vercel Blob Backup

- Dosyalar kalıcıdır (Vercel tarafından yönetilir)
- ZIP indirme ile yedekleme yapabilirsiniz

## Support

Sorunlarla karşılaşırsanız:
1. GitHub Issues
2. Vercel Community
3. Inngest Discord
4. MongoDB Community Forums

---

**Son Kontrol Listesi**:
- ✅ Tüm environment variables eklendi
- ✅ Vercel Blob Storage bağlandı
- ✅ Inngest webhook konfigüre edildi
- ✅ MongoDB IP whitelist ayarlandı
- ✅ Test hikayesi başarıyla işlendi
- ✅ ZIP indirme çalışıyor

🎉 Deployment tamamlandı! Artık production'da çalışıyor.

