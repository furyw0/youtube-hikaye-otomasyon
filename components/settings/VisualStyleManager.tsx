/**
 * Görsel Stil Yönetim Komponenti
 * Kullanıcıların görsel stillerini yönetmesini sağlar
 */

'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';

interface VisualStyle {
  _id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  systemPrompt: string;
  technicalPrefix: string;
  styleSuffix: string;
}

interface StyleFormData {
  name: string;
  description: string;
  systemPrompt: string;
  technicalPrefix: string;
  styleSuffix: string;
}

const emptyFormData: StyleFormData = {
  name: '',
  description: '',
  systemPrompt: '',
  technicalPrefix: '',
  styleSuffix: '--style raw --no text, watermark, logo'
};

export function VisualStyleManager() {
  const t = useTranslations('settings');
  
  const [styles, setStyles] = useState<VisualStyle[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingStyle, setEditingStyle] = useState<VisualStyle | null>(null);
  const [formData, setFormData] = useState<StyleFormData>(emptyFormData);

  // Stilleri yükle
  useEffect(() => {
    fetchStyles();
  }, []);

  const fetchStyles = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/visual-styles');
      const data = await response.json();
      
      if (data.success) {
        setStyles(data.styles);
      } else {
        setError(data.error || 'Stiller yüklenemedi');
      }
    } catch (err) {
      setError('Bağlantı hatası');
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingStyle(null);
    setFormData(emptyFormData);
    setShowModal(true);
    setError(null);
  };

  const openEditModal = (style: VisualStyle) => {
    setEditingStyle(style);
    setFormData({
      name: style.name,
      description: style.description || '',
      systemPrompt: style.systemPrompt,
      technicalPrefix: style.technicalPrefix,
      styleSuffix: style.styleSuffix
    });
    setShowModal(true);
    setError(null);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingStyle(null);
    setFormData(emptyFormData);
    setError(null);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.systemPrompt || !formData.technicalPrefix || !formData.styleSuffix) {
      setError('Lütfen tüm zorunlu alanları doldurun');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const url = editingStyle 
        ? `/api/visual-styles/${editingStyle._id}`
        : '/api/visual-styles';
      
      const method = editingStyle ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(editingStyle ? 'Stil güncellendi' : 'Stil oluşturuldu');
        closeModal();
        fetchStyles();
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(data.error || 'İşlem başarısız');
      }
    } catch (err) {
      setError('Bağlantı hatası');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (style: VisualStyle) => {
    if (style.isDefault) {
      setError('Varsayılan stiller silinemez');
      setTimeout(() => setError(null), 3000);
      return;
    }

    if (!confirm(`"${style.name}" stilini silmek istediğinize emin misiniz?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/visual-styles/${style._id}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (data.success) {
        setSuccess('Stil silindi');
        fetchStyles();
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(data.error || 'Silme başarısız');
        setTimeout(() => setError(null), 3000);
      }
    } catch (err) {
      setError('Bağlantı hatası');
      setTimeout(() => setError(null), 3000);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-20 bg-gray-200 rounded mb-2"></div>
          <div className="h-20 bg-gray-200 rounded mb-2"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {t('visualStyles.title')}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Üretilecek görsellerin tarzını belirleyin
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <span>+</span>
          {t('visualStyles.addNew')}
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
          {success}
        </div>
      )}

      {/* Stil Listesi */}
      <div className="space-y-3">
        {styles.map(style => (
          <div 
            key={style._id}
            className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-gray-900">{style.name}</h3>
                  {style.isDefault && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800">
                      {t('visualStyles.default')}
                    </span>
                  )}
                </div>
                {style.description && (
                  <p className="text-sm text-gray-500 mt-1">{style.description}</p>
                )}
                <p className="text-xs text-gray-400 mt-2 line-clamp-1">
                  {style.systemPrompt}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button
                  onClick={() => openEditModal(style)}
                  className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
                >
                  {t('visualStyles.edit')}
                </button>
                {!style.isDefault && (
                  <button
                    onClick={() => handleDelete(style)}
                    className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    {t('visualStyles.delete')}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingStyle ? 'Stil Düzenle' : 'Yeni Stil Ekle'}
              </h3>
            </div>
            
            <div className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
                  {error}
                </div>
              )}

              {/* Stil Adı */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('visualStyles.form.name')} *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900"
                  placeholder="Örn: Vintage/Sepia"
                  maxLength={100}
                />
              </div>

              {/* Açıklama */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('visualStyles.form.description')}
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900"
                  placeholder="Kısa açıklama..."
                  maxLength={500}
                />
              </div>

              {/* Stil Tanımı (System Prompt) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('visualStyles.form.systemPrompt')} *
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  LLM'e verilen stil açıklaması. Görsel prompt oluştururken kullanılır.
                </p>
                <textarea
                  value={formData.systemPrompt}
                  onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-24 bg-white text-gray-900"
                  placeholder="Örn: Vintage sepia-toned photograph, aged film aesthetic, warm brown tones"
                  maxLength={1000}
                />
              </div>

              {/* Teknik Prefix */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('visualStyles.form.technicalPrefix')} *
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Her prompt'un başına eklenen teknik ayarlar.
                </p>
                <textarea
                  value={formData.technicalPrefix}
                  onChange={(e) => setFormData({ ...formData, technicalPrefix: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-24 bg-white text-gray-900"
                  placeholder="Örn: Vintage photograph, sepia tones, old film grain, scratched texture"
                  maxLength={1000}
                />
              </div>

              {/* Stil Suffix */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('visualStyles.form.styleSuffix')} *
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Her prompt'un sonuna eklenen negatif prompt'lar.
                </p>
                <textarea
                  value={formData.styleSuffix}
                  onChange={(e) => setFormData({ ...formData, styleSuffix: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-20 bg-white text-gray-900"
                  placeholder="Örn: --style raw --no text, watermark, logo, modern"
                  maxLength={500}
                />
              </div>
            </div>

            <div className="p-6 border-t bg-gray-50 flex justify-end gap-3">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                disabled={saving}
              >
                İptal
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
