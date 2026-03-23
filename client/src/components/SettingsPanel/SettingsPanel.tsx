import React from 'react';
import { useAppStore } from '../../store/useAppStore';

interface SettingsPanelProps {
  onClose: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
  const { settings, updateSettings, currentModel } = useAppStore();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-bg-secondary rounded-xl border border-border-color w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Settings</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary text-2xl">
            ×
          </button>
        </div>

        <div className="space-y-6">
          {/* Model Selection */}
          <div>
            <label className="block text-sm text-text-secondary mb-2">Current Model</label>
            <div className="bg-bg-tertiary rounded-lg p-3">
              <div className="font-medium">{currentModel?.name || 'No model loaded'}</div>
              {currentModel && (
                <div className="text-sm text-text-secondary mt-1">
                  {currentModel.classes.length} classes • {(currentModel.size / 1024 / 1024).toFixed(1)}MB
                </div>
              )}
            </div>
          </div>

          {/* Input Size */}
          <div>
            <label className="block text-sm text-text-secondary mb-2">Input Size</label>
            <div className="flex gap-2">
              {[320, 480, 640].map((size) => (
                <button
                  key={size}
                  onClick={() => updateSettings({ inputSize: size as 320 | 480 | 640 })}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    settings.inputSize === size
                      ? 'bg-accent-blue text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-secondary mt-1">
              Smaller = faster, Larger = more accurate
            </p>
          </div>

          {/* IoU Threshold */}
          <div>
            <label className="block text-sm text-text-secondary mb-2">
              IoU Threshold: {(settings.iouThreshold * 100).toFixed(0)}%
            </label>
            <input
              type="range"
              min="0.1"
              max="0.9"
              step="0.05"
              value={settings.iouThreshold}
              onChange={(e) => updateSettings({ iouThreshold: parseFloat(e.target.value) })}
              className="w-full accent-accent-blue"
            />
          </div>

          {/* Display Options */}
          <div>
            <label className="block text-sm text-text-secondary mb-2">Display Options</label>
            <div className="space-y-2">
              <ToggleRow
                label="Show Labels"
                checked={settings.showLabels}
                onChange={(checked) => updateSettings({ showLabels: checked })}
              />
              <ToggleRow
                label="Show Confidence"
                checked={settings.showConfidence}
                onChange={(checked) => updateSettings({ showConfidence: checked })}
              />
            </div>
          </div>

          {/* Class Filter */}
          <div>
            <label className="block text-sm text-text-secondary mb-2">
              Class Filter {settings.selectedClassIds.length > 0 && `(${settings.selectedClassIds.length} selected)`}
            </label>
            <div className="bg-bg-tertiary rounded-lg p-3 max-h-48 overflow-y-auto">
              <p className="text-sm text-text-secondary">
                Filter coming soon - will allow selecting specific object classes to detect
              </p>
            </div>
          </div>

          {/* Reset Button */}
          <button
            onClick={() => {
              updateSettings({
                confidenceThreshold: 0.45,
                iouThreshold: 0.45,
                inputSize: 640,
                showLabels: true,
                showConfidence: true,
                selectedClassIds: [],
              });
            }}
            className="w-full py-2 bg-bg-tertiary hover:bg-border-color rounded-lg transition-colors"
          >
            Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  );
};

const ToggleRow: React.FC<{
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <div className="flex items-center justify-between">
    <span className="text-sm">{label}</span>
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <div className="w-11 h-6 bg-bg-tertiary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent-blue rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent-blue"></div>
    </label>
  </div>
);
