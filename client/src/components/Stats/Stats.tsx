import React from 'react';
import { DetectionStats } from '../../../../shared/types';

interface StatsProps {
  stats: DetectionStats;
}

export const Stats: React.FC<StatsProps> = ({ stats }) => {
  return (
    <div className="bg-bg-secondary rounded-xl border border-border-color p-4">
      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
        Performance Stats
      </h3>
      <div className="space-y-3">
        <StatRow label="FPS" value={stats.fps.toFixed(1)} highlight={stats.fps >= 30} />
        <StatRow label="Inference Time" value={`${stats.inferenceTime.toFixed(2)}ms`} highlight={stats.inferenceTime < 50} />
        <StatRow label="Objects Detected" value={stats.objectCount.toString()} />
        <StatRow 
          label="Last Detection" 
          value={stats.lastDetectionTime ? `${((Date.now() - stats.lastDetectionTime) / 1000).toFixed(1)}s ago` : 'N/A'} 
        />
      </div>
    </div>
  );
};

const StatRow: React.FC<{ label: string; value: string; highlight?: boolean }> = ({ label, value, highlight }) => (
  <div className="flex items-center justify-between">
    <span className="text-sm text-text-secondary">{label}</span>
    <span className={`font-mono font-medium ${highlight ? 'text-accent-green' : ''}`}>
      {value}
    </span>
  </div>
);
