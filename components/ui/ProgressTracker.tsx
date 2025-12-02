/**
 * Progress Tracker Component
 * İşlem durumunu ve ilerlemesini gösterir
 */

'use client';

import { useTranslations } from 'next-intl';

interface ProgressTrackerProps {
  status: string;
  progress: number;
  currentStep?: string;
  errorMessage?: string;
}

export function ProgressTracker({
  status,
  progress,
  currentStep,
  errorMessage
}: ProgressTrackerProps) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');

  const getStatusColor = () => {
    switch (status) {
      case 'completed':
        return 'bg-green-500';
      case 'failed':
        return 'bg-red-500';
      case 'processing':
      case 'queued':
        return 'bg-blue-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'completed':
        return '✅';
      case 'failed':
        return '❌';
      case 'processing':
        return '⚙️';
      case 'queued':
        return '⏳';
      default:
        return '📝';
    }
  };

  return (
    <div className="space-y-4">
      {/* Status Badge */}
      <div className="flex items-center gap-3">
        <span className="text-3xl">{getStatusIcon()}</span>
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {t(`status.${status}` as any)}
          </h3>
          {currentStep && (
            <p className="text-sm text-gray-600">{currentStep}</p>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            {tCommon('processing')}
          </span>
          <span className="text-sm font-semibold text-gray-900">
            {progress}%
          </span>
        </div>
        
        <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ease-out ${getStatusColor()}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <span className="text-red-600 text-xl">⚠️</span>
            <div>
              <h4 className="text-sm font-semibold text-red-900 mb-1">
                {tCommon('error')}
              </h4>
              <p className="text-sm text-red-700">{errorMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* Success Message */}
      {status === 'completed' && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <span className="text-green-600 text-xl">🎉</span>
            <div>
              <h4 className="text-sm font-semibold text-green-900 mb-1">
                {t('steps.completed')}
              </h4>
              <p className="text-sm text-green-700">
                Hikayeniz hazır! ZIP dosyasını indirebilirsiniz.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Processing Info */}
      {(status === 'processing' || status === 'queued') && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="animate-spin text-blue-600 text-xl">⚙️</div>
            <div>
              <h4 className="text-sm font-semibold text-blue-900 mb-1">
                {tCommon('processing')}
              </h4>
              <p className="text-sm text-blue-700">
                Bu işlem birkaç dakika sürebilir. Lütfen bekleyin...
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

