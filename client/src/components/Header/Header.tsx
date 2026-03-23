import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { DetectionStats } from '../../../../shared/types';
import { onnxInference } from '../../services/onnxInference';

interface HeaderProps {
  stats: DetectionStats;
  onOpenModelLibrary: () => void;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({ stats, onOpenModelLibrary, onOpenSettings }) => {
  const { currentModel, error } = useAppStore();
  const [engine, setEngine] = useState<string>('');

  useEffect(() => {
    // Update engine info when model is loaded
    const updateEngine = () => {
      if (onnxInference.isLoaded()) {
        setEngine(onnxInference.getExecutionProvider());
      }
    };
    updateEngine();
    // Check periodically in case engine detection changes
    const interval = setInterval(updateEngine, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="h-[70px] bg-bg-secondary border-b border-border-color flex items-center justify-between px-6">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-gradient-to-br from-accent-blue to-accent-purple rounded-lg flex items-center justify-center font-bold text-lg">
          Y
        </div>
        <div>
          <h1 className="text-xl font-semibold">
            YOLO11 <span className="text-accent-blue">Detect</span>
          </h1>
          <div className="flex items-center gap-2">
            {currentModel && (
              <p className="text-xs text-text-secondary">
                Model: {currentModel.name}
              </p>
            )}
            {engine && (
              <span className="text-xs bg-bg-tertiary px-2 py-0.5 rounded text-accent-blue">
                {engine}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-4">
          <StatBadge label="FPS" value={stats.fps.toFixed(0)} color="text-accent-green" />
          <StatBadge label="Objects" value={stats.objectCount.toString()} color="text-accent-blue" />
          <StatBadge label="Latency" value={`${stats.inferenceTime.toFixed(0)}ms`} color="text-accent-orange" />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 ml-4">
          <button
            onClick={onOpenModelLibrary}
            className="px-3 py-2 text-sm bg-bg-tertiary hover:bg-border-color rounded-lg transition-colors"
          >
            Models
          </button>
          <button
            onClick={onOpenSettings}
            className="px-3 py-2 text-sm bg-bg-tertiary hover:bg-border-color rounded-lg transition-colors"
          >
            Settings
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-accent-red text-white px-4 py-2 rounded-lg shadow-lg">
          {error}
        </div>
      )}
    </header>
  );
};

const StatBadge: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div className="bg-bg-tertiary rounded-lg px-3 py-2 min-w-[80px]">
    <div className="text-xs text-text-secondary uppercase tracking-wide">{label}</div>
    <div className={`text-lg font-semibold ${color}`}>{value}</div>
  </div>
);
