/**
 * Dil Konuşma Hızı Yöneticisi
 * Dil bazlı TTS konuşma hızlarını ayarlar ve önizleme yapar
 */

'use client';

import { useState, useEffect } from 'react';

interface LanguageSpeed {
  code: string;
  name: string;
  speed: number;
}

// Varsayılan dil hızları
const DEFAULT_LANGUAGE_SPEEDS: LanguageSpeed[] = [
  { code: 'fr', name: 'Fransızca', speed: 0.85 },
  { code: 'es', name: 'İspanyolca', speed: 0.88 },
  { code: 'it', name: 'İtalyanca', speed: 0.88 },
  { code: 'pt', name: 'Portekizce', speed: 0.88 },
  { code: 'en', name: 'İngilizce', speed: 0.92 },
  { code: 'de', name: 'Almanca', speed: 0.95 },
  { code: 'tr', name: 'Türkçe', speed: 0.95 },
  { code: 'ru', name: 'Rusça', speed: 0.92 },
  { code: 'nl', name: 'Hollandaca', speed: 0.92 },
  { code: 'pl', name: 'Lehçe', speed: 0.92 },
  { code: 'ar', name: 'Arapça', speed: 0.90 },
  { code: 'zh-cn', name: 'Çince', speed: 0.90 },
  { code: 'ja', name: 'Japonca', speed: 0.88 },
  { code: 'ko', name: 'Korece', speed: 0.90 },
  { code: 'hi', name: 'Hintçe', speed: 0.90 },
  { code: 'cs', name: 'Çekçe', speed: 0.92 },
  { code: 'hu', name: 'Macarca', speed: 0.92 },
];

interface Props {
  languageSpeeds: LanguageSpeed[];
  onChange: (speeds: LanguageSpeed[]) => void;
  tunnelUrl?: string;
  voiceId?: string;
}

export default function LanguageSpeedManager({ 
  languageSpeeds, 
  onChange,
  tunnelUrl,
  voiceId
}: Props) {
  const [speeds, setSpeeds] = useState<LanguageSpeed[]>([]);
  const [previewingLang, setPreviewingLang] = useState<string | null>(null);
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    // Kullanıcı ayarları yoksa varsayılanları kullan
    if (languageSpeeds && languageSpeeds.length > 0) {
      setSpeeds(languageSpeeds);
    } else {
      setSpeeds(DEFAULT_LANGUAGE_SPEEDS);
    }
  }, [languageSpeeds]);

  const handleSpeedChange = (code: string, newSpeed: number) => {
    const updated = speeds.map(s => 
      s.code === code ? { ...s, speed: newSpeed } : s
    );
    setSpeeds(updated);
    onChange(updated);
  };

  const resetToDefaults = () => {
    setSpeeds(DEFAULT_LANGUAGE_SPEEDS);
    onChange(DEFAULT_LANGUAGE_SPEEDS);
  };

  const handlePreview = async (lang: LanguageSpeed) => {
    if (!tunnelUrl || !voiceId) {
      setPreviewError('Önizleme için Coqui TTS ayarlarını yapılandırın');
      return;
    }

    // Önceki önizlemeyi durdur
    if (previewAudio) {
      previewAudio.pause();
      previewAudio.src = '';
    }

    setPreviewingLang(lang.code);
    setPreviewError(null);

    try {
      const response = await fetch('/api/coqui/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: getPreviewText(lang.code),
          language: lang.code,
          speed: lang.speed
        })
      });

      if (!response.ok) {
        throw new Error('Önizleme oluşturulamadı');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      const audio = new Audio(url);
      audio.onended = () => {
        setPreviewingLang(null);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setPreviewError('Ses oynatılamadı');
        setPreviewingLang(null);
      };
      
      setPreviewAudio(audio);
      await audio.play();

    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Bilinmeyen hata');
      setPreviewingLang(null);
    }
  };

  const stopPreview = () => {
    if (previewAudio) {
      previewAudio.pause();
      previewAudio.src = '';
    }
    setPreviewingLang(null);
  };

  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            🎚️ Dil Konuşma Hızları
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Her dil için TTS konuşma hızını ayarlayın (0.5 = yavaş, 1.0 = normal, 1.5 = hızlı)
          </p>
        </div>
        <button
          onClick={resetToDefaults}
          className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md"
        >
          🔄 Varsayılanlara Dön
        </button>
      </div>

      {previewError && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-md text-sm">
          ⚠️ {previewError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {speeds.map(lang => (
          <div 
            key={lang.code}
            className="border rounded-lg p-4 hover:border-blue-300 transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium">{lang.name}</span>
              <span className="text-xs text-gray-400 uppercase">{lang.code}</span>
            </div>
            
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0.5"
                max="1.5"
                step="0.01"
                value={lang.speed}
                onChange={(e) => handleSpeedChange(lang.code, parseFloat(e.target.value))}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <input
                type="number"
                min="0.5"
                max="1.5"
                step="0.01"
                value={lang.speed}
                onChange={(e) => handleSpeedChange(lang.code, parseFloat(e.target.value) || 0.9)}
                className="w-16 px-2 py-1 text-sm border rounded text-center"
              />
            </div>
            
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-500">
                {lang.speed < 0.85 ? '🐢 Yavaş' : 
                 lang.speed > 1.1 ? '🐇 Hızlı' : 
                 '⚖️ Normal'}
              </span>
              
              {tunnelUrl && voiceId && (
                <button
                  onClick={() => previewingLang === lang.code ? stopPreview() : handlePreview(lang)}
                  disabled={previewingLang !== null && previewingLang !== lang.code}
                  className={`px-2 py-1 text-xs rounded ${
                    previewingLang === lang.code
                      ? 'bg-red-100 text-red-700 hover:bg-red-200'
                      : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                  } disabled:opacity-50`}
                >
                  {previewingLang === lang.code ? '⏹️ Durdur' : '▶️ Önizle'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 p-3 bg-blue-50 rounded-md">
        <p className="text-sm text-blue-700">
          💡 <strong>İpucu:</strong> Hızlı konuşulan dilleri (Fransızca, İspanyolca) yavaşlatmak 
          video süresini orijinale yaklaştırır. Önizleme ile test edebilirsiniz.
        </p>
      </div>
    </div>
  );
}

// Dil bazlı önizleme metinleri
function getPreviewText(langCode: string): string {
  const texts: Record<string, string> = {
    'tr': 'Bu bir test seslendirmesidir. Konuşma hızını ayarlayabilirsiniz.',
    'en': 'This is a test voice over. You can adjust the speech speed.',
    'fr': 'Ceci est un test de voix off. Vous pouvez ajuster la vitesse.',
    'de': 'Dies ist ein Test-Voiceover. Sie können die Geschwindigkeit anpassen.',
    'es': 'Esta es una prueba de voz en off. Puede ajustar la velocidad.',
    'it': 'Questa è una prova di voce fuori campo. Puoi regolare la velocità.',
    'pt': 'Este é um teste de locução. Você pode ajustar a velocidade.',
    'ru': 'Это тестовая озвучка. Вы можете настроить скорость.',
    'nl': 'Dit is een testspraak. U kunt de snelheid aanpassen.',
    'pl': 'To jest testowy głos. Możesz dostosować prędkość.',
    'ar': 'هذا اختبار للصوت. يمكنك ضبط السرعة.',
    'zh-cn': '这是一个测试配音。您可以调整速度。',
    'ja': 'これはテスト音声です。速度を調整できます。',
    'ko': '이것은 테스트 음성입니다. 속도를 조절할 수 있습니다.',
    'hi': 'यह एक परीक्षण आवाज है। आप गति को समायोजित कर सकते हैं।',
    'cs': 'Toto je testovací hlas. Můžete upravit rychlost.',
    'hu': 'Ez egy teszt hangfelvétel. Beállíthatja a sebességet.',
  };
  
  return texts[langCode] || texts['en'];
}
