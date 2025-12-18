/**
 * Prompt Senaryoları Yönetim Komponenti
 * Kullanıcıların tüm promptları yönetmesini sağlar (sekmeli yapı)
 */

'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';

interface PromptScenario {
  _id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  // Çeviri
  translationSystemPrompt: string;
  translationUserPrompt: string;
  titleTranslationSystemPrompt: string;
  titleTranslationUserPrompt: string;
  // Adaptasyon
  adaptationSystemPrompt: string;
  adaptationUserPrompt: string;
  titleAdaptationSystemPrompt: string;
  titleAdaptationUserPrompt: string;
  // Sahne
  sceneFirstThreeSystemPrompt: string;
  sceneFirstThreeUserPrompt: string;
  sceneRemainingSystemPrompt: string;
  sceneRemainingUserPrompt: string;
  // Görsel
  visualPromptSystemPrompt: string;
  visualPromptUserPrompt: string;
  // Metadata
  youtubeDescriptionSystemPrompt: string;
  youtubeDescriptionUserPrompt: string;
  coverTextSystemPrompt: string;
  coverTextUserPrompt: string;
}

interface ScenarioFormData {
  name: string;
  description: string;
  // Çeviri
  translationSystemPrompt: string;
  translationUserPrompt: string;
  titleTranslationSystemPrompt: string;
  titleTranslationUserPrompt: string;
  // Adaptasyon
  adaptationSystemPrompt: string;
  adaptationUserPrompt: string;
  titleAdaptationSystemPrompt: string;
  titleAdaptationUserPrompt: string;
  // Sahne
  sceneFirstThreeSystemPrompt: string;
  sceneFirstThreeUserPrompt: string;
  sceneRemainingSystemPrompt: string;
  sceneRemainingUserPrompt: string;
  // Görsel
  visualPromptSystemPrompt: string;
  visualPromptUserPrompt: string;
  // Metadata
  youtubeDescriptionSystemPrompt: string;
  youtubeDescriptionUserPrompt: string;
  coverTextSystemPrompt: string;
  coverTextUserPrompt: string;
}

type TabKey = 'translation' | 'adaptation' | 'scene' | 'visual' | 'metadata';

const emptyFormData: ScenarioFormData = {
  name: '',
  description: '',
  // Çeviri
  translationSystemPrompt: '',
  translationUserPrompt: 'ÇEVİR:\n\n{{CONTENT}}',
  titleTranslationSystemPrompt: '',
  titleTranslationUserPrompt: 'Başlık: "{{TITLE}}"',
  // Adaptasyon
  adaptationSystemPrompt: '',
  adaptationUserPrompt: 'ADAPTE ET:\n\n{{CONTENT}}',
  titleAdaptationSystemPrompt: '',
  titleAdaptationUserPrompt: 'Başlık: "{{TITLE}}"',
  // Sahne
  sceneFirstThreeSystemPrompt: '',
  sceneFirstThreeUserPrompt: 'KISALTMADAN 6 SAHNEYE BÖL',
  sceneRemainingSystemPrompt: '',
  sceneRemainingUserPrompt: 'KISALTMADAN SAHNEYE BÖL',
  // Görsel
  visualPromptSystemPrompt: '',
  visualPromptUserPrompt: 'SAHNE: "{{SCENE_TEXT}}"',
  // Metadata
  youtubeDescriptionSystemPrompt: '',
  youtubeDescriptionUserPrompt: 'Başlık: "{{TITLE}}"',
  coverTextSystemPrompt: '',
  coverTextUserPrompt: 'Başlık: "{{TITLE}}"'
};

export function PromptScenarioManager() {
  const t = useTranslations('settings');
  
  const [scenarios, setScenarios] = useState<PromptScenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingScenario, setEditingScenario] = useState<PromptScenario | null>(null);
  const [formData, setFormData] = useState<ScenarioFormData>(emptyFormData);
  const [activeTab, setActiveTab] = useState<TabKey>('translation');
  
  // Expanded scenario for viewing
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedTab, setExpandedTab] = useState<TabKey>('translation');

  // Sekmeler
  const tabs: { key: TabKey; icon: string; label: string }[] = [
    { key: 'translation', icon: '🔤', label: 'Çeviri' },
    { key: 'adaptation', icon: '🎭', label: 'Adaptasyon' },
    { key: 'scene', icon: '🎬', label: 'Sahne' },
    { key: 'visual', icon: '🖼️', label: 'Görsel' },
    { key: 'metadata', icon: '📝', label: 'Metadata' }
  ];

  // Senaryoları yükle
  useEffect(() => {
    fetchScenarios();
  }, []);

  const fetchScenarios = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/prompt-scenarios');
      const data = await response.json();
      
      if (data.success) {
        setScenarios(data.scenarios);
      } else {
        setError(data.error || 'Senaryolar yüklenemedi');
      }
    } catch (err) {
      setError('Bağlantı hatası');
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingScenario(null);
    setFormData(emptyFormData);
    setActiveTab('translation');
    setShowModal(true);
    setError(null);
  };

  const openEditModal = (scenario: PromptScenario) => {
    setEditingScenario(scenario);
    setFormData({
      name: scenario.name,
      description: scenario.description || '',
      translationSystemPrompt: scenario.translationSystemPrompt,
      translationUserPrompt: scenario.translationUserPrompt,
      titleTranslationSystemPrompt: scenario.titleTranslationSystemPrompt || '',
      titleTranslationUserPrompt: scenario.titleTranslationUserPrompt || '',
      adaptationSystemPrompt: scenario.adaptationSystemPrompt,
      adaptationUserPrompt: scenario.adaptationUserPrompt,
      titleAdaptationSystemPrompt: scenario.titleAdaptationSystemPrompt || '',
      titleAdaptationUserPrompt: scenario.titleAdaptationUserPrompt || '',
      sceneFirstThreeSystemPrompt: scenario.sceneFirstThreeSystemPrompt || '',
      sceneFirstThreeUserPrompt: scenario.sceneFirstThreeUserPrompt || '',
      sceneRemainingSystemPrompt: scenario.sceneRemainingSystemPrompt || '',
      sceneRemainingUserPrompt: scenario.sceneRemainingUserPrompt || '',
      visualPromptSystemPrompt: scenario.visualPromptSystemPrompt || '',
      visualPromptUserPrompt: scenario.visualPromptUserPrompt || '',
      youtubeDescriptionSystemPrompt: scenario.youtubeDescriptionSystemPrompt || '',
      youtubeDescriptionUserPrompt: scenario.youtubeDescriptionUserPrompt || '',
      coverTextSystemPrompt: scenario.coverTextSystemPrompt || '',
      coverTextUserPrompt: scenario.coverTextUserPrompt || ''
    });
    setActiveTab('translation');
    setShowModal(true);
    setError(null);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingScenario(null);
    setFormData(emptyFormData);
    setError(null);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.translationSystemPrompt || !formData.adaptationSystemPrompt) {
      setError('Lütfen tüm zorunlu alanları doldurun (İsim, Çeviri ve Adaptasyon System Promptları)');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const url = editingScenario 
        ? `/api/prompt-scenarios/${editingScenario._id}`
        : '/api/prompt-scenarios';
      
      const method = editingScenario ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(editingScenario ? 'Senaryo güncellendi' : 'Senaryo oluşturuldu');
        closeModal();
        fetchScenarios();
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

  const handleDelete = async (scenario: PromptScenario) => {
    if (scenario.isDefault) {
      setError('Varsayılan senaryolar silinemez');
      setTimeout(() => setError(null), 3000);
      return;
    }

    if (!confirm(`"${scenario.name}" senaryosunu silmek istediğinize emin misiniz?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/prompt-scenarios/${scenario._id}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (data.success) {
        setSuccess('Senaryo silindi');
        fetchScenarios();
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

  // Tab içeriklerini render et
  const renderTabContent = (tab: TabKey, isModal: boolean = false) => {
    const data = isModal ? formData : (expandedId ? scenarios.find(s => s._id === expandedId) : null);
    if (!data) return null;

    const fieldPrefix = isModal ? 'formData' : 'scenario';
    const isReadOnly = !isModal;

    switch (tab) {
      case 'translation':
        return (
          <div className="space-y-4">
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm mb-4">
              <strong>İçerik Çevirisi:</strong> Hikaye içeriğinin çevirisi için kullanılır
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt *</label>
              {isReadOnly ? (
                <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).translationSystemPrompt}</pre>
              ) : (
                <textarea
                  value={(data as ScenarioFormData).translationSystemPrompt}
                  onChange={(e) => setFormData({ ...formData, translationSystemPrompt: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-40 font-mono text-sm bg-white text-gray-900"
                  maxLength={15000}
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">User Prompt *</label>
              {isReadOnly ? (
                <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-20 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).translationUserPrompt}</pre>
              ) : (
                <textarea
                  value={(data as ScenarioFormData).translationUserPrompt}
                  onChange={(e) => setFormData({ ...formData, translationUserPrompt: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-20 font-mono text-sm bg-white text-gray-900"
                  maxLength={2000}
                />
              )}
            </div>
            
            <div className="border-t pt-4 mt-4">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm mb-4">
                <strong>Başlık Çevirisi:</strong> Hikaye başlığının çevirisi için kullanılır
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Başlık System Prompt</label>
                {isReadOnly ? (
                  <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).titleTranslationSystemPrompt || '-'}</pre>
                ) : (
                  <textarea
                    value={(data as ScenarioFormData).titleTranslationSystemPrompt}
                    onChange={(e) => setFormData({ ...formData, titleTranslationSystemPrompt: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-32 font-mono text-sm bg-white text-gray-900"
                    maxLength={5000}
                  />
                )}
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Başlık User Prompt</label>
                {isReadOnly ? (
                  <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-16 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).titleTranslationUserPrompt || '-'}</pre>
                ) : (
                  <textarea
                    value={(data as ScenarioFormData).titleTranslationUserPrompt}
                    onChange={(e) => setFormData({ ...formData, titleTranslationUserPrompt: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-16 font-mono text-sm bg-white text-gray-900"
                    maxLength={1000}
                  />
                )}
              </div>
            </div>
          </div>
        );

      case 'adaptation':
        return (
          <div className="space-y-4">
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm mb-4">
              <strong>İçerik Adaptasyonu:</strong> Hikaye içeriğinin kültürel adaptasyonu için kullanılır
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt *</label>
              {isReadOnly ? (
                <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).adaptationSystemPrompt}</pre>
              ) : (
                <textarea
                  value={(data as ScenarioFormData).adaptationSystemPrompt}
                  onChange={(e) => setFormData({ ...formData, adaptationSystemPrompt: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-40 font-mono text-sm bg-white text-gray-900"
                  maxLength={15000}
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">User Prompt *</label>
              {isReadOnly ? (
                <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-20 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).adaptationUserPrompt}</pre>
              ) : (
                <textarea
                  value={(data as ScenarioFormData).adaptationUserPrompt}
                  onChange={(e) => setFormData({ ...formData, adaptationUserPrompt: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-20 font-mono text-sm bg-white text-gray-900"
                  maxLength={2000}
                />
              )}
            </div>
            
            <div className="border-t pt-4 mt-4">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm mb-4">
                <strong>Başlık Adaptasyonu:</strong> Hikaye başlığının kültürel adaptasyonu için kullanılır
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Başlık System Prompt</label>
                {isReadOnly ? (
                  <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).titleAdaptationSystemPrompt || '-'}</pre>
                ) : (
                  <textarea
                    value={(data as ScenarioFormData).titleAdaptationSystemPrompt}
                    onChange={(e) => setFormData({ ...formData, titleAdaptationSystemPrompt: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-32 font-mono text-sm bg-white text-gray-900"
                    maxLength={5000}
                  />
                )}
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Başlık User Prompt</label>
                {isReadOnly ? (
                  <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-16 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).titleAdaptationUserPrompt || '-'}</pre>
                ) : (
                  <textarea
                    value={(data as ScenarioFormData).titleAdaptationUserPrompt}
                    onChange={(e) => setFormData({ ...formData, titleAdaptationUserPrompt: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-16 font-mono text-sm bg-white text-gray-900"
                    maxLength={1000}
                  />
                )}
              </div>
            </div>
          </div>
        );

      case 'scene':
        return (
          <div className="space-y-4">
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm mb-4">
              <strong>İlk 3 Dakika Sahneleri:</strong> Hikayenin ilk bölümünün sahnelere ayrılması
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt</label>
              {isReadOnly ? (
                <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).sceneFirstThreeSystemPrompt || '-'}</pre>
              ) : (
                <textarea
                  value={(data as ScenarioFormData).sceneFirstThreeSystemPrompt}
                  onChange={(e) => setFormData({ ...formData, sceneFirstThreeSystemPrompt: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-40 font-mono text-sm bg-white text-gray-900"
                  maxLength={15000}
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">User Prompt</label>
              {isReadOnly ? (
                <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-16 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).sceneFirstThreeUserPrompt || '-'}</pre>
              ) : (
                <textarea
                  value={(data as ScenarioFormData).sceneFirstThreeUserPrompt}
                  onChange={(e) => setFormData({ ...formData, sceneFirstThreeUserPrompt: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-16 font-mono text-sm bg-white text-gray-900"
                  maxLength={2000}
                />
              )}
            </div>
            
            <div className="border-t pt-4 mt-4">
              <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-sm mb-4">
                <strong>Kalan Sahneler:</strong> Hikayenin geri kalanının sahnelere ayrılması
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt</label>
                {isReadOnly ? (
                  <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).sceneRemainingSystemPrompt || '-'}</pre>
                ) : (
                  <textarea
                    value={(data as ScenarioFormData).sceneRemainingSystemPrompt}
                    onChange={(e) => setFormData({ ...formData, sceneRemainingSystemPrompt: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-40 font-mono text-sm bg-white text-gray-900"
                    maxLength={15000}
                  />
                )}
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">User Prompt</label>
                {isReadOnly ? (
                  <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-16 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).sceneRemainingUserPrompt || '-'}</pre>
                ) : (
                  <textarea
                    value={(data as ScenarioFormData).sceneRemainingUserPrompt}
                    onChange={(e) => setFormData({ ...formData, sceneRemainingUserPrompt: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-16 font-mono text-sm bg-white text-gray-900"
                    maxLength={2000}
                  />
                )}
              </div>
            </div>
          </div>
        );

      case 'visual':
        return (
          <div className="space-y-4">
            <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm mb-4">
              <strong>Görsel Prompt Oluşturma:</strong> ImageFX için görsel prompt üretimi
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt</label>
              {isReadOnly ? (
                <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).visualPromptSystemPrompt || '-'}</pre>
              ) : (
                <textarea
                  value={(data as ScenarioFormData).visualPromptSystemPrompt}
                  onChange={(e) => setFormData({ ...formData, visualPromptSystemPrompt: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-40 font-mono text-sm bg-white text-gray-900"
                  maxLength={10000}
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">User Prompt</label>
              {isReadOnly ? (
                <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-24 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).visualPromptUserPrompt || '-'}</pre>
              ) : (
                <textarea
                  value={(data as ScenarioFormData).visualPromptUserPrompt}
                  onChange={(e) => setFormData({ ...formData, visualPromptUserPrompt: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-24 font-mono text-sm bg-white text-gray-900"
                  maxLength={3000}
                />
              )}
            </div>
          </div>
        );

      case 'metadata':
        return (
          <div className="space-y-4">
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm mb-4">
              <strong>YouTube Açıklaması:</strong> Video açıklaması oluşturma
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt</label>
              {isReadOnly ? (
                <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).youtubeDescriptionSystemPrompt || '-'}</pre>
              ) : (
                <textarea
                  value={(data as ScenarioFormData).youtubeDescriptionSystemPrompt}
                  onChange={(e) => setFormData({ ...formData, youtubeDescriptionSystemPrompt: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-40 font-mono text-sm bg-white text-gray-900"
                  maxLength={10000}
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">User Prompt</label>
              {isReadOnly ? (
                <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-16 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).youtubeDescriptionUserPrompt || '-'}</pre>
              ) : (
                <textarea
                  value={(data as ScenarioFormData).youtubeDescriptionUserPrompt}
                  onChange={(e) => setFormData({ ...formData, youtubeDescriptionUserPrompt: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-16 font-mono text-sm bg-white text-gray-900"
                  maxLength={2000}
                />
              )}
            </div>
            
            <div className="border-t pt-4 mt-4">
              <div className="p-3 bg-pink-50 border border-pink-200 rounded-lg text-sm mb-4">
                <strong>Kapak Yazısı:</strong> Video thumbnail için yazı oluşturma
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt</label>
                {isReadOnly ? (
                  <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).coverTextSystemPrompt || '-'}</pre>
                ) : (
                  <textarea
                    value={(data as ScenarioFormData).coverTextSystemPrompt}
                    onChange={(e) => setFormData({ ...formData, coverTextSystemPrompt: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-40 font-mono text-sm bg-white text-gray-900"
                    maxLength={10000}
                  />
                )}
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">User Prompt</label>
                {isReadOnly ? (
                  <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-16 overflow-y-auto whitespace-pre-wrap">{(data as PromptScenario).coverTextUserPrompt || '-'}</pre>
                ) : (
                  <textarea
                    value={(data as ScenarioFormData).coverTextUserPrompt}
                    onChange={(e) => setFormData({ ...formData, coverTextUserPrompt: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 h-16 font-mono text-sm bg-white text-gray-900"
                    maxLength={2000}
                  />
                )}
              </div>
            </div>
          </div>
        );

      default:
        return null;
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
            {t('promptScenarios.title')}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Tüm işlem adımları için kullanılacak prompt şablonlarını yönetin
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2"
        >
          <span>+</span>
          {t('promptScenarios.addNew')}
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

      {/* Değişken Açıklaması */}
      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
        <h4 className="font-medium text-blue-900 mb-2">📝 Kullanılabilir Değişkenler:</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-blue-800">
          <span><code className="bg-blue-100 px-1 rounded">{'{{CONTENT}}'}</code> Metin</span>
          <span><code className="bg-blue-100 px-1 rounded">{'{{TITLE}}'}</code> Başlık</span>
          <span><code className="bg-blue-100 px-1 rounded">{'{{TARGET_COUNTRY}}'}</code> Ülke</span>
          <span><code className="bg-blue-100 px-1 rounded">{'{{TARGET_LANGUAGE}}'}</code> Dil</span>
          <span><code className="bg-blue-100 px-1 rounded">{'{{SOURCE_LANG}}'}</code> Kaynak Dil</span>
          <span><code className="bg-blue-100 px-1 rounded">{'{{VARIABLES}}'}</code> Dinamik</span>
        </div>
      </div>

      {/* Senaryo Listesi */}
      <div className="space-y-3">
        {scenarios.map(scenario => (
          <div 
            key={scenario._id}
            className="border border-gray-200 rounded-lg overflow-hidden hover:border-gray-300 transition-colors"
          >
            <div className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-gray-900">{scenario.name}</h3>
                    {scenario.isDefault && (
                      <span className="px-2 py-0.5 text-xs rounded-full bg-indigo-100 text-indigo-800">
                        {t('promptScenarios.default')}
                      </span>
                    )}
                  </div>
                  {scenario.description && (
                    <p className="text-sm text-gray-500 mt-1">{scenario.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => {
                      setExpandedId(expandedId === scenario._id ? null : scenario._id);
                      setExpandedTab('translation');
                    }}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 rounded-lg"
                  >
                    {expandedId === scenario._id ? '▲ Gizle' : '▼ Göster'}
                  </button>
                  <button
                    onClick={() => openEditModal(scenario)}
                    className="px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg"
                  >
                    {t('promptScenarios.edit')}
                  </button>
                  {!scenario.isDefault && (
                    <button
                      onClick={() => handleDelete(scenario)}
                      className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      {t('promptScenarios.delete')}
                    </button>
                  )}
                </div>
              </div>
            </div>
            
            {/* Genişletilmiş Görünüm - Sekmeli */}
            {expandedId === scenario._id && (
              <div className="border-t border-gray-200 bg-gray-50">
                {/* Sekmeler */}
                <div className="flex border-b border-gray-200 overflow-x-auto">
                  {tabs.map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setExpandedTab(tab.key)}
                      className={`px-4 py-2 text-sm font-medium whitespace-nowrap ${
                        expandedTab === tab.key 
                          ? 'border-b-2 border-indigo-500 text-indigo-600 bg-white' 
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab.icon} {tab.label}
                    </button>
                  ))}
                </div>
                <div className="p-4">
                  {renderTabContent(expandedTab, false)}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingScenario ? 'Senaryo Düzenle' : 'Yeni Senaryo Ekle'}
              </h3>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm mb-4">
                  {error}
                </div>
              )}

              {/* Senaryo Adı */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('promptScenarios.form.name')} *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                    placeholder="Örn: Senaryo 4 - Özel"
                    maxLength={100}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('promptScenarios.form.description')}
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"
                    placeholder="Kısa açıklama..."
                    maxLength={500}
                  />
                </div>
              </div>

              {/* Sekmeler */}
              <div className="border-b border-gray-200 mb-4">
                <div className="flex overflow-x-auto">
                  {tabs.map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`px-4 py-3 text-sm font-medium whitespace-nowrap ${
                        activeTab === tab.key 
                          ? 'border-b-2 border-indigo-500 text-indigo-600' 
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab.icon} {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sekme İçeriği */}
              {renderTabContent(activeTab, true)}
            </div>

            <div className="p-6 border-t bg-gray-50 flex justify-end gap-3 flex-shrink-0">
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
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
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
