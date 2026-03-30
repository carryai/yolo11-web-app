import { create } from 'zustand';
import { Detection, AppSettings, DetectionStats, InputSource, ModelInfo, DetectionLogEntry } from '../../../shared/types';

interface AppState {
  // Input source
  inputSource: InputSource | null;
  setInputSource: (source: InputSource | null) => void;
  
  // Models
  models: ModelInfo[];
  currentModel: ModelInfo | null;
  setModels: (models: ModelInfo[]) => void;
  setCurrentModel: (model: ModelInfo | null) => void;
  
  // Settings
  settings: AppSettings;
  updateSettings: (settings: Partial<AppSettings>) => void;
  
  // Detection state
  isDetecting: boolean;
  isPaused: boolean;
  setIsDetecting: (detecting: boolean) => void;
  setIsPaused: (paused: boolean) => void;
  
  // Current detections
  currentDetections: Detection[];
  setCurrentDetections: (detections: Detection[]) => void;
  
  // Stats
  stats: DetectionStats;
  updateStats: (stats: Partial<DetectionStats>) => void;
  
  // Detection log
  detectionLog: DetectionLogEntry[];
  addToLog: (entry: DetectionLogEntry) => void;
  clearLog: () => void;
  
  // UI state
  showSettings: boolean;
  showModelLibrary: boolean;
  setShowSettings: (show: boolean) => void;
  setShowModelLibrary: (show: boolean) => void;
  
  // Error state
  error: string | null;
  setError: (error: string | null) => void;
}

const defaultSettings: AppSettings = {
  confidenceThreshold: 0.45,
  iouThreshold: 0.45,
  inputSize: 640,
  showLabels: true,
  showConfidence: true,
  selectedModelId: 'yolo11n',
  selectedClassIds: [], // empty = all classes
  show3DView: false,
  humanModelType: 'stick',
  estimate3DDepth: false,
};

// Import Mixamo character model URL from settings or use default
export const DEFAULT_MIXAMO_MODEL_URL = '/models/character.glb';

const defaultStats: DetectionStats = {
  fps: 0,
  inferenceTime: 0,
  objectCount: 0,
  lastDetectionTime: 0,
};

export const useAppStore = create<AppState>((set) => ({
  // Input source
  inputSource: null,
  setInputSource: (source) => set({ inputSource: source }),
  
  // Models
  models: [],
  currentModel: null,
  setModels: (models) => set({ models }),
  setCurrentModel: (model) => set({ currentModel: model }),
  
  // Settings
  settings: defaultSettings,
  updateSettings: (newSettings) => set((state) => ({
    settings: { ...state.settings, ...newSettings }
  })),
  
  // Detection state
  isDetecting: false,
  isPaused: false,
  setIsDetecting: (detecting) => set({ isDetecting: detecting }),
  setIsPaused: (paused) => set({ isPaused: paused }),
  
  // Current detections
  currentDetections: [],
  setCurrentDetections: (detections) => set({ currentDetections: detections }),
  
  // Stats
  stats: defaultStats,
  updateStats: (newStats) => set((state) => ({
    stats: { ...state.stats, ...newStats }
  })),
  
  // Detection log
  detectionLog: [],
  addToLog: (entry) => set((state) => ({
    detectionLog: [entry, ...state.detectionLog].slice(0, 100) // Keep last 100 entries
  })),
  clearLog: () => set({ detectionLog: [] }),
  
  // UI state
  showSettings: false,
  showModelLibrary: false,
  setShowSettings: (show) => set({ showSettings: show }),
  setShowModelLibrary: (show) => set({ showModelLibrary: show }),
  
  // Error state
  error: null,
  setError: (error) => set({ error }),
}));
