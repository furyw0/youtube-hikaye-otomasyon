/**
 * YouTube Metadata Servisi
 * Adapte edilmiş hikaye için YouTube açıklaması ve kapak yazısı oluşturur
 */

import logger from '@/lib/logger';
import { OpenAIError } from '@/lib/errors';
import { retryOpenAI } from './retry.service';
import { createCompletion, parseJSONResponse } from './llm-router.service';
import type { LLMProvider } from './llm-router.service';

interface MetadataOptions {
  adaptedTitle: string;
  adaptedContent: string;
  originalDescription?: string;
  originalCoverText?: string;
  targetLanguage: string;
  targetCountry: string;
  model: string;
  provider: LLMProvider;
  adaptationNotes: string[];  // İsim/yer değişiklikleri
}

interface MetadataResult {
  youtubeDescription: string;
  coverText: string;
}

/**
 * YouTube açıklaması oluştur
 */
async function generateYouTubeDescription(
  options: MetadataOptions
): Promise<string> {
  const { 
    adaptedTitle, 
    adaptedContent, 
    originalDescription,
    targetLanguage, 
    targetCountry,
    model,
    provider,
    adaptationNotes 
  } = options;

  const adaptationChanges = adaptationNotes.length > 0
    ? `\n\n🔄 ADAPTİS YAPILAN DEĞİŞİKLİKLER (BUNLARI KULLAN):\n${adaptationNotes.slice(0, 10).map(n => `- ${n}`).join('\n')}`
    : '';

  const originalRef = originalDescription
    ? `\n\n📝 ORİJİNAL AÇIKLAMA (REFERANS):\n${originalDescription}\n\nBu açıklamayı referans alarak yeni açıklama oluştur. Değişen isim ve yer bilgilerini kullan.`
    : '';

  const systemPrompt = `Sen YouTube video açıklaması uzmanısın. Adapte edilmiş hikaye için SEO uyumlu, ilgi çekici YouTube açıklaması yazıyorsun.

🎯 GÖREV: Adapte edilmiş hikaye için kapsamlı YouTube açıklaması yaz.

📏 AÇIKLAMA YAPISI:
1. Çekici giriş (2-3 cümle) - Hikayenin özeti ve merak uyandırıcı
2. Hikaye hakkında (4-5 cümle) - Ana tema, karakterler, önemli olaylar
3. Neden izlemeli? (2-3 cümle) - İzleyiciye vaat
4. Hashtag'ler (5-10 adet) - #HikayeAnlatımı #${targetCountry} vb.

⛔ YASAK:
- ❌ Orijinal isim/yer bilgilerini kullanma
- ❌ Clickbait veya yanıltıcı ifadeler
- ❌ "Orijinal" veya "uyarlandı" gibi ifadeler
- ❌ Telif hakkı veya kaynak bilgisi

✅ ZORUNLU:
- ✅ Adapte edilmiş isim ve yer bilgilerini kullan
- ✅ ${targetLanguage} dilinde doğal ifadeler
- ✅ SEO dostu anahtar kelimeler
- ✅ Emoji kullanımı (ölçülü)
- ✅ 200-500 kelime arası

${adaptationChanges}${originalRef}

Hedef: ${targetCountry} / ${targetLanguage}`;

  const response = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt,
      cacheableContent: adaptedContent.substring(0, 10000), // İlk kısım context için
      cacheTTL: '1h',
      messages: [
        { 
          role: 'user', 
          content: `Başlık: "${adaptedTitle}"\n\nBu hikaye için YouTube açıklaması yaz.` 
        }
      ],
      temperature: 0.6
    }),
    'YouTube açıklaması oluşturma'
  );

  return response.trim();
}

/**
 * Kapak yazısı oluştur (dikkat çekici, clickbait tarzı)
 */
async function generateCoverText(
  options: MetadataOptions
): Promise<string> {
  const { 
    adaptedTitle, 
    adaptedContent, 
    originalCoverText,
    targetLanguage, 
    targetCountry,
    model,
    provider,
    adaptationNotes 
  } = options;

  const adaptationChanges = adaptationNotes.length > 0
    ? `\n\n🔄 ADAPTASYON DEĞİŞİKLİKLERİ:\n${adaptationNotes.slice(0, 10).map(n => `- ${n}`).join('\n')}`
    : '';

  const originalRef = originalCoverText
    ? `\n\n📝 ORİJİNAL KAPAK YAZISI (REFERANS):\n"${originalCoverText}"\n\nBu stili ve yaklaşımı referans al.`
    : '';

  const systemPrompt = `Sen YouTube thumbnail (kapak görseli) metin uzmanısın. Dikkat çekici, tıklanabilir kapak yazıları oluşturuyorsun.

🎯 GÖREV: Adapte edilmiş hikaye için YÜKSEK TIKLANABİLİRLİK sağlayan kapak yazısı yaz.

📏 KURAL VE SINIRLAR:
- Maksimum 60-80 karakter
- Kısa, anlaşılır, şok edici
- Emoji kullanımı (1-2 adet, isteğe bağlı)
- ${targetLanguage} dilinde doğal ifade

🔥 YÜKSEK TIKLANABİLİRLİK FORMÜLLERİ:
1. Soru formatı: "Gerçeği Öğrenince Neler Oldu?"
2. Tamamlanmamış: "Bu Adam 10 Yıl Sonra..."
3. Şok/Şaşkınlık: "Kimse Ona İnanmadı Ama..."
4. Merak: "Kapı Açıldığında İçeride..."
5. Zıtlık: "Fakir Adam, Zengin Oldu ve..."

⛔ YASAK:
- ❌ Orijinal isim/yer bilgileri
- ❌ Yanlış bilgi veya kandırmaca
- ❌ Çok uzun cümleler
- ❌ "Hikaye" kelimesini kullanma

✅ ZORUNLU:
- ✅ Adapte edilmiş isim/yerler
- ✅ Merak uyandırıcı
- ✅ Okuma kolaylığı
- ✅ BÜYÜK HARFLERLE başlayabilir

${adaptationChanges}${originalRef}

Hedef: ${targetCountry} / ${targetLanguage}

Sadece kapak yazısını döndür, başka açıklama ekleme.`;

  const response = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt,
      cacheableContent: adaptedContent.substring(0, 5000), // Kısa context
      cacheTTL: '1h',
      messages: [
        { 
          role: 'user', 
          content: `Başlık: "${adaptedTitle}"\n\nHikaye özeti: ${adaptedContent.substring(0, 500)}...\n\nDikkat çekici kapak yazısı oluştur.` 
        }
      ],
      temperature: 0.8 // Daha yaratıcı
    }),
    'Kapak yazısı oluşturma'
  );

  // Temizle ve tırnak/gereksiz karakterleri kaldır
  let coverText = response.trim()
    .replace(/^["']|["']$/g, '') // Başta/sonda tırnak
    .replace(/\n.*/g, ''); // Sadece ilk satır

  // Uzunluk kontrolü
  if (coverText.length > 80) {
    logger.warn('Kapak yazısı çok uzun, kısaltılıyor', {
      original: coverText.length,
      text: coverText
    });
    coverText = coverText.substring(0, 77) + '...';
  }

  return coverText;
}

/**
 * YouTube metadata oluştur (açıklama + kapak yazısı)
 */
export async function generateYouTubeMetadata(
  options: MetadataOptions
): Promise<MetadataResult> {
  logger.info('YouTube metadata oluşturma başlatılıyor', {
    targetCountry: options.targetCountry,
    targetLanguage: options.targetLanguage,
    model: options.model,
    provider: options.provider,
    hasOriginalDescription: !!options.originalDescription,
    hasOriginalCoverText: !!options.originalCoverText,
    adaptationChanges: options.adaptationNotes.length
  });

  try {
    // Paralel olarak açıklama ve kapak yazısı oluştur
    const [youtubeDescription, coverText] = await Promise.all([
      generateYouTubeDescription(options),
      generateCoverText(options)
    ]);

    logger.info('YouTube metadata oluşturuldu', {
      descriptionLength: youtubeDescription.length,
      coverTextLength: coverText.length
    });

    return {
      youtubeDescription,
      coverText
    };

  } catch (error) {
    logger.error('YouTube metadata oluşturma hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
      targetCountry: options.targetCountry
    });

    throw new OpenAIError(
      `YouTube metadata oluşturma başarısız: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`
    );
  }
}
