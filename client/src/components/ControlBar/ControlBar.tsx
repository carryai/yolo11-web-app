import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { InputSourceType } from '../../../../shared/types';

interface ControlBarProps {
  onStart: (source: InputSourceType) => void;
  onStop: () => void;
  onImageUpload: (file: File) => void;
  onRTSPUrlChange?: (url: string) => void;
}

export const ControlBar: React.FC<ControlBarProps> = ({ onStart, onStop, onImageUpload, onRTSPUrlChange }) => {
  const { isDetecting, isPaused, settings, updateSettings } = useAppStore();
  const [showRTSPInput, setShowRTSPInput] = useState(false);
  const [rtspUrl, setRtspUrl] = useState('');

  const handleSourceSelect = (source: InputSourceType) => {
    if (source === 'rtsp') {
      setShowRTSPInput(true);
    } else {
      setShowRTSPInput(false);
      onStart(source);
    }
  };

  const handleRTSPConnect = () => {
    if (rtspUrl.trim()) {
      onRTSPUrlChange?.(rtspUrl);
      onStart('rtsp');
      setShowRTSPInput(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onImageUpload(file);
    }
  };

  return (
    <div className="bg-bg-secondary rounded-xl border border-border-color p-4">
      <div className="flex flex-wrap items-center gap-4">
        {/* Input Source Selector */}
        <div className="flex items-center gap-2">
          <span className="text-text-secondary text-sm">Source:</span>
          <div className="flex bg-bg-tertiary rounded-lg p-1">
            <SourceButton
              label="Webcam"
              icon="📹"
              active={!showRTSPInput && !isPaused}
              onClick={() => handleSourceSelect('webcam')}
              disabled={isDetecting}
            />
            <SourceButton
              label="Screen"
              icon="🖥️"
              active={false}
              onClick={() => handleSourceSelect('screen')}
              disabled={isDetecting}
            />
            <SourceButton
              label="RTSP"
              icon="📡"
              active={showRTSPInput}
              onClick={() => handleSourceSelect('rtsp')}
              disabled={isDetecting}
            />
            <label className="cursor-pointer">
              <input
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
                disabled={isDetecting}
              />
              <div className="px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5 transition-colors hover:text-text-primary text-text-secondary">
                <span>📁</span>
                <span>Image</span>
              </div>
            </label>
          </div>
        </div>

        {/* RTSP URL Input */}
        {showRTSPInput && (
          <div className="flex items-center gap-2 flex-1">
            <input
              type="text"
              value={rtspUrl}
              onChange={(e) => setRtspUrl(e.target.value)}
              placeholder="rtsp://username:password@ip:port/stream"
              className="flex-1 bg-bg-tertiary border border-border-color rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent-blue"
              onKeyDown={(e) => e.key === 'Enter' && handleRTSPConnect()}
            />
            <button
              onClick={handleRTSPConnect}
              className="px-3 py-1.5 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
            >
              Connect
            </button>
          </div>
        )}

        {/* Play/Stop Controls */}
        <div className="flex items-center gap-2 ml-auto">
          {!isDetecting ? (
            <button
              onClick={() => handleSourceSelect('webcam')}
              className="flex items-center gap-2 px-4 py-2 bg-accent-green text-white rounded-lg font-medium hover:bg-green-600 transition-colors"
            >
              <span>▶</span>
              <span>Start</span>
            </button>
          ) : (
            <>
              <button
                onClick={() => useAppStore.getState().setIsPaused(!isPaused)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  isPaused
                    ? 'bg-accent-green text-white hover:bg-green-600'
                    : 'bg-accent-orange text-white hover:bg-orange-600'
                }`}
              >
                {isPaused ? '▶ Resume' : '⏸ Pause'}
              </button>
              <button
                onClick={onStop}
                className="flex items-center gap-2 px-4 py-2 bg-accent-red text-white rounded-lg font-medium hover:bg-red-600 transition-colors"
              >
                <span>⏹</span>
                <span>Stop</span>
              </button>
            </>
          )}
        </div>

        {/* Confidence Threshold */}
        <div className="flex items-center gap-2">
          <span className="text-text-secondary text-sm">Confidence:</span>
          <input
            type="range"
            min="0.1"
            max="0.95"
            step="0.05"
            value={settings.confidenceThreshold}
            onChange={(e) => updateSettings({ confidenceThreshold: parseFloat(e.target.value) })}
            className="w-32 accent-accent-blue"
          />
          <span className="text-sm font-medium w-12">
            {(settings.confidenceThreshold * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
};

const SourceButton: React.FC<{
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
  disabled: boolean;
}> = ({ label, icon, active, onClick, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5 transition-colors ${
      active
        ? 'bg-accent-blue text-white'
        : 'text-text-secondary hover:text-text-primary'
    } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
  >
    <span>{icon}</span>
    <span>{label}</span>
  </button>
);
