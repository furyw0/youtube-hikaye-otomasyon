/**
 * Scene Viewer Component
 * Sahneleri görüntüler (orijinal + adapte metin, görsel, ses)
 */

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface Scene {
  sceneNumber: number;
  sceneTextOriginal: string;
  sceneTextAdapted: string;
  hasImage: boolean;
  imageIndex?: number;
  isFirstThreeMinutes: boolean;
  estimatedDuration: number;
  actualDuration?: number;
  visualDescription?: string;
  visualPrompt?: string;
  blobUrls?: {
    image?: string;
    audio?: string;
  };
  status: string;
}

interface SceneViewerProps {
  scenes: Scene[];
}

export function SceneViewer({ scenes }: SceneViewerProps) {
  const t = useTranslations('scenes');
  const [showOriginal, setShowOriginal] = useState(false);
  const [expandedScene, setExpandedScene] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">
          {t('title')} ({scenes.length})
        </h2>
        
        <button
          onClick={() => setShowOriginal(!showOriginal)}
          className="text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          {showOriginal ? t('hideOriginal') : t('showOriginal')}
        </button>
      </div>

      {/* Scenes List */}
      <div className="space-y-4">
        {scenes.map((scene) => (
          <SceneCard
            key={scene.sceneNumber}
            scene={scene}
            showOriginal={showOriginal}
            isExpanded={expandedScene === scene.sceneNumber}
            onToggleExpand={() => 
              setExpandedScene(
                expandedScene === scene.sceneNumber ? null : scene.sceneNumber
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

function SceneCard({
  scene,
  showOriginal,
  isExpanded,
  onToggleExpand
}: {
  scene: Scene;
  showOriginal: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const t = useTranslations('scenes');

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow">
      {/* Header */}
      <div
        className="bg-gray-50 px-4 py-3 flex items-center justify-between cursor-pointer"
        onClick={onToggleExpand}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-700">
            {t('sceneNumber')} {scene.sceneNumber}
          </span>
          
          {scene.isFirstThreeMinutes && (
            <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full font-medium">
              ⭐ {t('firstThreeMinutes')}
            </span>
          )}
          
          {scene.hasImage && (
            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full font-medium">
              🖼️ {t('image')} {scene.imageIndex}
            </span>
          )}

          {scene.actualDuration && (
            <span className="text-xs text-gray-500">
              ⏱️ {Math.round(scene.actualDuration)}s
            </span>
          )}
        </div>

        <span className="text-gray-400">
          {isExpanded ? '▼' : '▶'}
        </span>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* Image */}
          {scene.hasImage && scene.blobUrls?.image && (
            <div className="rounded-lg overflow-hidden">
              <img
                src={scene.blobUrls.image}
                alt={`Scene ${scene.sceneNumber}`}
                className="w-full h-auto"
                loading="lazy"
              />
            </div>
          )}

          {/* Text */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {showOriginal && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">
                  {t('original')}
                </h4>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {scene.sceneTextOriginal}
                </p>
              </div>
            )}
            
            <div className={showOriginal ? '' : 'md:col-span-2'}>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">
                {t('adapted')}
              </h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                {scene.sceneTextAdapted}
              </p>
            </div>
          </div>

          {/* Audio Player */}
          {scene.blobUrls?.audio && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">
                🎙️ {t('audio')}
              </h4>
              <audio
                controls
                className="w-full"
                preload="none"
              >
                <source src={scene.blobUrls.audio} type="audio/mpeg" />
                Tarayıcınız ses çalmayı desteklemiyor.
              </audio>
            </div>
          )}

          {/* Visual Description (if available) */}
          {scene.visualDescription && (
            <details className="text-sm">
              <summary className="font-semibold text-gray-700 cursor-pointer mb-2">
                {t('visualDescription')}
              </summary>
              <p className="text-gray-600 pl-4">
                {scene.visualDescription}
              </p>
            </details>
          )}

          {/* Visual Prompt (if available) */}
          {scene.visualPrompt && (
            <details className="text-sm">
              <summary className="font-semibold text-gray-700 cursor-pointer mb-2">
                {t('visualPrompt')}
              </summary>
              <p className="text-gray-600 pl-4 font-mono text-xs">
                {scene.visualPrompt}
              </p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

