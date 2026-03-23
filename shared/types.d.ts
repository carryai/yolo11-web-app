export interface Detection {
    bbox: [number, number, number, number];
    classId: number;
    className: string;
    confidence: number;
    color: string;
}
export interface ModelInfo {
    id: string;
    name: string;
    size: number;
    inputShape: number[];
    outputShape: number[];
    classes: string[];
    isDefault: boolean;
    uploadDate?: number;
    usageCount: number;
    architecture?: string;
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
export type InputSourceType = 'webcam' | 'screen' | 'rtsp' | 'image' | 'video';
export interface InputSource {
    type: InputSourceType;
    deviceId?: string;
    url?: string;
    stream?: MediaStream;
}
export interface AppSettings {
    confidenceThreshold: number;
    iouThreshold: number;
    inputSize: 320 | 480 | 640;
    showLabels: boolean;
    showConfidence: boolean;
    selectedModelId: string;
    selectedClassIds: number[];
}
export interface DetectionStats {
    fps: number;
    inferenceTime: number;
    objectCount: number;
    lastDetectionTime: number;
}
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
        frame?: string;
        status?: 'connected' | 'disconnected' | 'loading' | 'ready' | 'error';
        error?: string;
        modelInfo?: ModelInfo;
    };
}
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
export interface DetectionLogEntry {
    timestamp: number;
    detections: Detection[];
    sourceType: InputSourceType;
    modelName: string;
}
//# sourceMappingURL=types.d.ts.map