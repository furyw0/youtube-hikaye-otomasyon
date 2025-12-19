/**
 * Kanal Yönetimi Sayfası
 * YouTube kanallarını yönetme (oluşturma, düzenleme, silme)
 */

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { AuthGuard } from '@/components/auth/AuthGuard';

interface Channel {
  _id: string;
  name: string;
  description?: string;
  color: string;
  icon: string;
  youtubeChannelUrl?: string;
  isDefault?: boolean;
  storyCount: number;
  createdAt: string;
  updatedAt: string;
}

const CHANNEL_ICONS = ['📺', '🎬', '🎥', '📹', '🎞️', '📽️', '🎭', '🎪', '🌟', '⭐', '🔥', '💫', '✨', '🎯', '🚀', '💎'];

const CHANNEL_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
];

export default function ChannelsPage() {
  return (
    <AuthGuard>
      <ChannelsContent />
    </AuthGuard>
  );
}

function ChannelsContent() {
  const t = useTranslations('channels');
  
  const [channels, setChannels] = useState<Channel[]>([]);
  const [ungroupedCount, setUngroupedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [saving, setSaving] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: '#6366f1',
    icon: '📺',
    youtubeChannelUrl: ''
  });

  useEffect(() => {
    fetchChannels();
  }, []);

  const fetchChannels = async () => {
    try {
      const response = await fetch('/api/channels');
      const data = await response.json();
      
      if (data.success) {
        setChannels(data.channels || []);
        setUngroupedCount(data.ungroupedCount || 0);
      }
    } catch (error) {
      console.error('Kanallar yüklenemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingChannel(null);
    setFormData({
      name: '',
      description: '',
      color: CHANNEL_COLORS[Math.floor(Math.random() * CHANNEL_COLORS.length)],
      icon: '📺',
      youtubeChannelUrl: ''
    });
    setShowModal(true);
  };

  const openEditModal = (channel: Channel) => {
    setEditingChannel(channel);
    setFormData({
      name: channel.name,
      description: channel.description || '',
      color: channel.color,
      icon: channel.icon,
      youtubeChannelUrl: channel.youtubeChannelUrl || ''
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) return;

    setSaving(true);
    try {
      const url = editingChannel 
        ? `/api/channels/${editingChannel._id}` 
        : '/api/channels';
      
      const response = await fetch(url, {
        method: editingChannel ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (data.success) {
        if (editingChannel) {
          setChannels(channels.map(c => 
            c._id === editingChannel._id ? data.channel : c
          ));
        } else {
          setChannels([data.channel, ...channels]);
        }
        setShowModal(false);
      } else {
        alert(data.error || 'Bir hata oluştu');
      }
    } catch (error) {
      console.error('Kaydetme hatası:', error);
      alert('Bir hata oluştu');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (channelId: string) => {
    const channel = channels.find(c => c._id === channelId);
    if (!channel) return;

    const message = channel.storyCount > 0
      ? `Bu kanal "${channel.name}" silinecek ve ${channel.storyCount} hikaye gruplanmamış olacak. Devam etmek istiyor musunuz?`
      : `"${channel.name}" kanalını silmek istediğinize emin misiniz?`;

    if (!confirm(message)) return;

    try {
      const response = await fetch(`/api/channels/${channelId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        const data = await response.json();
        setChannels(channels.filter(c => c._id !== channelId));
        setUngroupedCount(prev => prev + (data.ungroupedStories || 0));
      }
    } catch (error) {
      console.error('Silme hatası:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page Header */}
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
            <p className="text-gray-600 mt-1">{t('subtitle')}</p>
          </div>
          <div className="flex gap-2">
            <Link 
              href="/stories" 
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
            >
              📚 {t('backToStories')}
            </Link>
            <button 
              onClick={openCreateModal}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2"
            >
              <span>+</span> {t('createChannel')}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-gray-500 text-sm">{t('stats.totalChannels')}</p>
            <p className="text-2xl font-bold text-gray-900">{channels.length}</p>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-gray-500 text-sm">{t('stats.groupedStories')}</p>
            <p className="text-2xl font-bold text-green-600">
              {channels.reduce((sum, c) => sum + c.storyCount, 0)}
            </p>
          </div>
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <p className="text-gray-500 text-sm">{t('stats.ungroupedStories')}</p>
            <p className="text-2xl font-bold text-orange-600">{ungroupedCount}</p>
          </div>
        </div>

        {/* Channel Grid */}
        {channels.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-lg shadow-sm">
            <div className="text-6xl mb-4">📺</div>
            <h2 className="text-xl font-semibold text-gray-700 mb-2">{t('empty')}</h2>
            <p className="text-gray-500 mb-6">{t('emptyDescription')}</p>
            <button 
              onClick={openCreateModal}
              className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              {t('createChannel')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {channels.map(channel => (
              <div 
                key={channel._id} 
                className="bg-white rounded-lg shadow-sm overflow-hidden border-l-4"
                style={{ borderLeftColor: channel.color }}
              >
                {/* Card Header */}
                <div className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-3xl">{channel.icon}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">
                        {channel.name}
                      </h3>
                      {channel.description && (
                        <p className="text-sm text-gray-500 truncate">
                          {channel.description}
                        </p>
                      )}
                    </div>
                    {channel.isDefault && (
                      <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-full">
                        Varsayılan
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">{t('storyCount')}:</span>
                    <span className="font-medium text-gray-900">{channel.storyCount}</span>
                  </div>

                  {channel.youtubeChannelUrl && (
                    <a 
                      href={channel.youtubeChannelUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 text-xs text-red-600 hover:underline flex items-center gap-1 truncate"
                    >
                      ▶️ YouTube Kanalı
                    </a>
                  )}
                </div>

                {/* Card Actions */}
                <div className="px-4 py-3 bg-gray-50 flex gap-2">
                  <Link 
                    href={`/stories?channelId=${channel._id}`}
                    className="flex-1 px-3 py-2 text-center text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    {t('viewStories')}
                  </Link>
                  <button
                    onClick={() => openEditModal(channel)}
                    className="px-3 py-2 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => handleDelete(channel._id)}
                    className="px-3 py-2 text-sm bg-red-100 text-red-600 rounded-md hover:bg-red-200"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">
                {editingChannel ? t('editChannel') : t('createChannel')}
              </h2>

              <div className="space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('form.name')} *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="örn: Ana Kanal, Eğlence, Belgesel..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                    maxLength={50}
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('form.description')}
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Kanal açıklaması (opsiyonel)"
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                    rows={2}
                    maxLength={200}
                  />
                </div>

                {/* Icon Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('form.icon')}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {CHANNEL_ICONS.map(icon => (
                      <button
                        key={icon}
                        type="button"
                        onClick={() => setFormData({ ...formData, icon })}
                        className={`w-10 h-10 text-xl rounded-md flex items-center justify-center ${
                          formData.icon === icon 
                            ? 'bg-blue-100 ring-2 ring-blue-500' 
                            : 'bg-gray-100 hover:bg-gray-200'
                        }`}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Color Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('form.color')}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {CHANNEL_COLORS.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setFormData({ ...formData, color })}
                        className={`w-8 h-8 rounded-full ${
                          formData.color === color ? 'ring-2 ring-offset-2 ring-gray-400' : ''
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                {/* YouTube URL */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('form.youtubeUrl')}
                  </label>
                  <input
                    type="url"
                    value={formData.youtubeChannelUrl}
                    onChange={(e) => setFormData({ ...formData, youtubeChannelUrl: e.target.value })}
                    placeholder="https://youtube.com/@kanaladi"
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                </div>
              </div>

              {/* Preview */}
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 mb-2">{t('form.preview')}</p>
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{formData.icon}</span>
                  <div 
                    className="w-2 h-10 rounded-full"
                    style={{ backgroundColor: formData.color }}
                  />
                  <div>
                    <p className="font-semibold text-gray-900">
                      {formData.name || 'Kanal Adı'}
                    </p>
                    <p className="text-sm text-gray-500">
                      {formData.description || 'Açıklama'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  disabled={saving}
                >
                  {t('form.cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={!formData.name.trim() || saving}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? '...' : (editingChannel ? t('form.update') : t('form.create'))}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
