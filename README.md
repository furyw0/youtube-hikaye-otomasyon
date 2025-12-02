# YouTube Hikaye Otomasyon Sistemi

YouTube için hikaye videoları üretimi için tam otomatik sistem.

## 🎯 Özellikler

- ✅ **Çoklu Dil Desteği**: Herhangi bir dilde hikaye girişi, otomatik dil algılama
- ✅ **Akıllı Çeviri**: GPT-4o-mini ile chunk-based kaliteli çeviri (40K+ karakter)
- ✅ **Kültürel Adaptasyon**: Hedef ülkeye özel içerik uyarlaması
- ✅ **Otomatik Sahne Ayrımı**: İlk 3 dakikada 5 görsel + kalan 5 görsel = 10 toplam
- ✅ **AI Görsel Üretimi**: Google ImageFX (Imagen 4) ile cinematic görseller
- ✅ **Profesyonel Seslendirme**: ElevenLabs TTS ile 25+ dilde ses
- ✅ **Cloud Storage**: Vercel Blob Storage'da güvenli depolama
- ✅ **Background Jobs**: Inngest ile uzun süren işlemler
- ✅ **ZIP İndirme**: Tüm içerik (metin, görsel, ses) tek paket

## 🛠️ Teknoloji Stack

- **Framework**: Next.js 15 (App Router)
- **Database**: MongoDB + Mongoose
- **AI**: OpenAI GPT-4o-mini, Google ImageFX, ElevenLabs
- **Storage**: Vercel Blob Storage
- **Background Jobs**: Inngest
- **i18n**: next-intl
- **Validation**: Zod
- **Logging**: Winston

## 📋 Gereksinimler

- Node.js 18+
- MongoDB Atlas hesabı
- OpenAI API key
- ElevenLabs API key
- Google hesabı (ImageFX için cookie)
- Vercel hesabı (Blob Storage için)
- Inngest hesabı (background jobs için)

## 🚀 Kurulum

### 1. Depoyu klonlayın

\`\`\`bash
git clone <repo-url>
cd youtube-hikaye-otomasyon
\`\`\`

### 2. Bağımlılıkları yükleyin

\`\`\`bash
npm install --legacy-peer-deps
\`\`\`

### 3. Environment variables'ı ayarlayın

\`env.example.txt\` dosyasını \`.env.local\` olarak kopyalayın ve doldurun:

\`\`\`bash
cp env.example.txt .env.local
\`\`\`

#### Gerekli API Keys:

**MongoDB**:
1. [MongoDB Atlas](https://cloud.mongodb.com) üzerinde cluster oluşturun
2. Database user oluşturun
3. Connection string'i \`MONGODB_URI\` olarak ekleyin

**OpenAI**:
1. [OpenAI Platform](https://platform.openai.com) hesabı oluşturun
2. API key oluşturun
3. \`OPENAI_API_KEY\` olarak ekleyin

**ElevenLabs**:
1. [ElevenLabs](https://elevenlabs.io) hesabı oluşturun
2. API key alın
3. \`ELEVENLABS_API_KEY\` olarak ekleyin

**Google ImageFX Cookie**:
1. [ImageFX](https://imagefx.google.com) sitesine Google hesabınızla giriş yapın
2. Chrome DevTools açın (F12)
3. Application > Cookies > \`__Secure-1PSID\` değerini kopyalayın
4. \`GOOGLE_COOKIE\` olarak ekleyin

**Vercel Blob Storage**:
1. Vercel Dashboard > Storage > Blob
2. "Create Token" ile token oluşturun
3. \`BLOB_READ_WRITE_TOKEN\` olarak ekleyin

**Inngest**:
1. [Inngest](https://inngest.com) hesabı oluşturun
2. Project oluşturun
3. Settings'den \`INNGEST_EVENT_KEY\` ve \`INNGEST_SIGNING_KEY\` alın

### 4. Geliştirme sunucusunu başlatın

\`\`\`bash
npm run dev
\`\`\`

Tarayıcıda [http://localhost:3000](http://localhost:3000) adresini açın.

### 5. Inngest Dev Server'ı başlatın (opsiyonel, development için)

Başka bir terminalde:

\`\`\`bash
npx inngest-cli dev
\`\`\`

## 📦 Production Deploy (Vercel)

### 1. Vercel'e deploy

\`\`\`bash
vercel
\`\`\`

### 2. Environment variables ekleyin

Vercel Dashboard > Project > Settings > Environment Variables

Tüm \`.env.local\` değerlerini ekleyin.

### 3. Inngest webhook'unu yapılandırın

1. Inngest Dashboard > Project > Settings > Webhooks
2. Webhook URL: \`https://your-app.vercel.app/api/inngest\`
3. Test edin

## 📚 Kullanım

### 1. Hikaye Oluşturma

\`\`\`typescript
POST /api/stories/create

{
  "title": "Hikaye Başlığı",
  "content": "Hikaye içeriği... (min 1000 karakter)",
  "targetLanguage": "en",
  "targetCountry": "USA",
  "openaiModel": "gpt-4o-mini",
  "voiceId": "elevenlabs-voice-id",
  "voiceName": "Rachel",
  "imagefxModel": "IMAGEN_4",
  "imagefxAspectRatio": "LANDSCAPE",
  "imagefxSeed": 12345 // opsiyonel
}
\`\`\`

### 2. İşleme Başlatma

\`\`\`typescript
POST /api/stories/process

{
  "storyId": "story-id"
}
\`\`\`

### 3. Progress Takibi

\`\`\`typescript
GET /api/stories/{storyId}

// Response:
{
  "success": true,
  "story": {
    "status": "processing",
    "progress": 65,
    "currentStep": "Görseller üretiliyor (3/5)...",
    "scenes": [...]
  }
}
\`\`\`

### 4. ZIP İndirme

\`\`\`typescript
GET /api/download/{storyId}

// Direkt ZIP dosyasını indirir
\`\`\`

## 🏗️ Proje Yapısı

\`\`\`
/app
  /api                    # API Routes
    /inngest              # Inngest webhook
    /stories              # Story CRUD
    /openai               # OpenAI models
    /elevenlabs           # ElevenLabs voices
    /download             # ZIP download
  /[locale]               # i18n routes
    /page.tsx             # Ana sayfa
    /dashboard            # Dashboard

/inngest
  /client.ts              # Inngest client
  /functions
    /process-story.ts     # Ana pipeline

/services                 # Business logic
  /openai.service.ts      # OpenAI client
  /translation.service.ts # Çeviri
  /adaptation.service.ts  # Adaptasyon
  /scene.service.ts       # Sahne oluşturma
  /imagefx.service.ts     # Görsel üretimi
  /elevenlabs.service.ts  # Seslendirme
  /blob.service.ts        # Cloud storage
  /zip.service.ts         # ZIP oluşturma

/models                   # MongoDB schemas
  /Story.ts
  /Scene.ts
  /ProcessLog.ts

/lib                      # Utilities
  /mongodb.ts             # DB connection
  /constants.ts           # App constants
  /errors.ts              # Custom errors
  /logger.ts              # Winston logger
  /utils.ts               # Helper functions

/types                    # TypeScript types
  /story.types.ts
  /scene.types.ts
  /api.types.ts
\`\`\`

## 🎨 Görsel Dağılım Stratejisi

Sistem özel bir "ilk 3 dakika" stratejisi kullanır:

1. **İlk 3 Dakika (5 Görsel)**: 
   - İzleyici dikkatini çekmek için en çekici sahneler
   - Her sahne ~36 saniye
   - Çok detaylı görsel promptlar
   - Aksiyon/duygusal an vurguları

2. **Kalan Kısım (5 Görsel)**:
   - Hikayenin devamı
   - Eşit aralıklarla dağıtılmış görseller
   - Her sahne 15-20 saniye

**Toplam: 10 görsel, ~40-50 sahne**

## 🔐 Güvenlik

- API rate limiting uygulanmalı (production)
- MongoDB connection güvenliği
- API key'leri asla commit etmeyin
- Vercel Blob public access kontrolü

## 📊 Maliyet Tahmini

40K karakterlik bir hikaye için:
- **OpenAI**: ~$0.05-0.10 (GPT-4o-mini)
- **ElevenLabs**: ~$0.50-1.00 (40-50 sahne × ~$0.02)
- **ImageFX**: Ücretsiz (Google hesabı gerekli)
- **Vercel Blob**: ~$0.01 (150MB depolama)

**Toplam: ~$0.56-1.11 per story**

## 🐛 Hata Ayıklama

### Logs Kontrolü

\`\`\`bash
# Development
npm run dev

# Inngest logs
# Inngest Dashboard > Runs
\`\`\`

### Sık Karşılaşılan Hatalar

**MongoDB Connection Error**:
- Connection string'i kontrol edin
- IP whitelist kontrolü (MongoDB Atlas)

**OpenAI Rate Limit**:
- Retry mekanizması otomatik çalışır
- API quota kontrolü

**ImageFX Cookie Expired**:
- Google'a tekrar giriş yapın
- Yeni cookie alın

**ElevenLabs Quota**:
- Plan limitlerini kontrol edin
- Billing sayfasından quota artırın

## 📝 Lisans

MIT

## 🤝 Katkıda Bulunma

1. Fork edin
2. Feature branch oluşturun (\`git checkout -b feature/amazing\`)
3. Commit edin (\`git commit -m 'Add amazing feature'\`)
4. Push edin (\`git push origin feature/amazing\`)
5. Pull Request açın

## 📧 İletişim

Sorularınız için issue açabilirsiniz.

---

**NOT**: Bu proje Google ImageFX için unofficial bir kütüphane kullanmaktadır. Google'ın terms of service'ini okuyun ve uygun kullanımdan emin olun.
