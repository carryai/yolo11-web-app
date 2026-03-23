// Detection types
export interface Detection {
  bbox: [number, number, number, number]; // [x1, y1, x2, y2] normalized 0-1
  classId: number;
  className: string;
  confidence: number;
  color: string;
}

// Model types
export interface ModelInfo {
  id: string;
  name: string;
  size: number; // bytes
  inputShape: number[];
  outputShape: number[];
  classes: string[];
  isDefault: boolean;
  uploadDate?: number;
  usageCount: number;
  architecture?: string; // Optional: model architecture type (e.g., 'yolo-custom-5cls')
}

export interface ModelMetadata {
  id: string;
  name: string;
  size: number;
  inputShape: number[];
  outputShape: number[];
  classes: string[];
  mAP?: number;
  description?: string;
}

// Input source types
export type InputSourceType = 'webcam' | 'screen' | 'rtsp' | 'image' | 'video';

export interface InputSource {
  type: InputSourceType;
  deviceId?: string; // for webcam
  url?: string; // for RTSP
  stream?: MediaStream;
}

// Settings types
export interface AppSettings {
  confidenceThreshold: number;
  iouThreshold: number;
  inputSize: 320 | 480 | 640;
  showLabels: boolean;
  showConfidence: boolean;
  selectedModelId: string;
  selectedClassIds: number[]; // empty = all classes
}

// Stats types
export interface DetectionStats {
  fps: number;
  inferenceTime: number; // ms
  objectCount: number;
  lastDetectionTime: number;
}

// WebSocket message types
export interface WSClientMessage {
  type: 'start_stream' | 'stop_stream' | 'config_update' | 'model_switch';
  payload: {
    streamId?: string;
    rtspUrl?: string;
    confidenceThreshold?: number;
    classes?: string[];
    modelId?: string;
  };
}

export interface WSServerMessage {
  type: 'detection_result' | 'stream_status' | 'error' | 'model_loaded';
  payload: {
    streamId?: string;
    timestamp: number;
    fps?: number;
    detections?: Detection[];
    frame?: string; // base64 encoded (RTSP only)
    status?: 'connected' | 'disconnected' | 'loading' | 'ready' | 'error';
    error?: string;
    modelInfo?: ModelInfo;
  };
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface StreamInfo {
  streamId: string;
  url: string;
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  fps: number;
  viewers: number;
}

// Detection log entry
export interface DetectionLogEntry {
  timestamp: number;
  detections: Detection[];
  sourceType: InputSourceType;
  modelName: string;
}
