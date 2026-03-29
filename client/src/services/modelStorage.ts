import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { ModelInfo } from '../../../shared/types';

interface ModelDB extends DBSchema {
  models: {
    key: string;
    value: {
      id: string;
      name: string;
      modelData: ArrayBuffer;  // Store as ArrayBuffer since Blobs can't be stored directly in IndexedDB
      metadata: ModelInfo;
      uploadDate: number;
    };
    indexes: { 'by-upload-date': number };
  };
}

const DB_NAME = 'yolo11-models';
const DB_VERSION = 1;
const STORE_NAME = 'models';

let db: IDBPDatabase<ModelDB> | null = null;

async function getDB(): Promise<IDBPDatabase<ModelDB>> {
  if (db) return db;
  
  db = await openDB<ModelDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('by-upload-date', 'uploadDate');
    },
  });
  
  return db;
}

export async function saveModel(id: string, name: string, blob: Blob, metadata: ModelInfo): Promise<void> {
  const database = await getDB();
  // Convert Blob to ArrayBuffer for storage in IndexedDB
  const modelData = await blob.arrayBuffer();
  await database.put(STORE_NAME, {
    id,
    name,
    modelData,
    metadata,
    uploadDate: Date.now(),
  });
}

export async function getModel(id: string): Promise<{ blob: Blob; metadata: ModelInfo } | null> {
  const database = await getDB();
  const model = await database.get(STORE_NAME, id);
  if (!model) return null;
  // Convert ArrayBuffer back to Blob when retrieving from IndexedDB
  const blob = new Blob([model.modelData], { type: 'application/octet-stream' });
  return { blob, metadata: model.metadata };
}

export async function getAllModels(): Promise<ModelInfo[]> {
  const database = await getDB();
  const allModels = await database.getAll(STORE_NAME);
  return allModels.map(m => ({
    ...m.metadata,
    uploadDate: m.uploadDate,
  }));
}

export async function deleteModel(id: string): Promise<void> {
  const database = await getDB();
  await database.delete(STORE_NAME, id);
}

export async function updateModelMetadata(id: string, updates: Partial<ModelInfo>): Promise<void> {
  const database = await getDB();
  const existing = await database.get(STORE_NAME, id);
  if (existing) {
    await database.put(STORE_NAME, {
      ...existing,
      metadata: { ...existing.metadata, ...updates },
    });
  }
}

export async function getModelUsage(id: string): Promise<number> {
  const database = await getDB();
  const model = await database.get(STORE_NAME, id);
  return model?.metadata.usageCount || 0;
}

export async function incrementModelUsage(id: string): Promise<void> {
  const database = await getDB();
  const existing = await database.get(STORE_NAME, id);
  if (existing) {
    const newCount = (existing.metadata.usageCount || 0) + 1;
    await database.put(STORE_NAME, {
      ...existing,
      metadata: { ...existing.metadata, usageCount: newCount },
    });
  }
}

export async function getStorageUsage(): Promise<{ used: number; quota: number }> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    return {
      used: estimate.usage || 0,
      quota: estimate.quota || 0,
    };
  }
  return { used: 0, quota: 0 };
}

// Known model configurations for automatic detection
const KNOWN_MODELS: { [key: string]: { name: string; size: number; outputShape: number[]; classes: string[]; keypoints?: string[] } } = {
  'yolo11n': {
    name: 'YOLO11n (Nano)',
    size: 6400000,
    outputShape: [1, 84, 8400],
    classes: getCOCOClasses(),
  },
  'yolo11n-pose': {
    name: 'YOLO11n Pose (Nano)',
    size: 6800000,
    outputShape: [1, 56, 8400],
    classes: ['person'],
    keypoints: getCOCOKeypoints(),
  },
  'yolo12n': {
    name: 'YOLO12n (Nano)',
    size: 6500000,
    outputShape: [1, 84, 8400],
    classes: getCOCOClasses(),
  },
  'yolo26n': {
    name: 'YOLO26n (Nano)',
    size: 6600000,
    outputShape: [1, 84, 8400],
    classes: getCOCOClasses(),
  },
  'yolo26n-pose': {
    name: 'YOLO26n Pose (Nano)',
    size: 7000000,
    outputShape: [1, 56, 8400],
    classes: ['person'],
    keypoints: getCOCOKeypoints(),
  },
};

// Default bundled models - will be merged with discovered models
export const DEFAULT_MODELS: ModelInfo[] = [
  {
    id: 'yolo11n',
    name: 'YOLO11n (Nano)',
    size: 6400000,
    inputShape: [1, 3, 640, 640],
    outputShape: [1, 84, 8400],
    classes: getCOCOClasses(),
    isDefault: true,
    usageCount: 0,
  },
  {
    id: 'yolo11n-pose',
    name: 'YOLO11n Pose (Nano)',
    size: 6800000,
    inputShape: [1, 3, 640, 640],
    outputShape: [1, 56, 8400],
    classes: ['person'],
    keypoints: getCOCOKeypoints(),
    isDefault: false,
    usageCount: 0,
  },
];

/**
 * Discover available models in the public/models folder
 * Returns a list of ModelInfo for all .onnx files found
 */
export async function discoverAvailableModels(): Promise<ModelInfo[]> {
  const discovered: ModelInfo[] = [];
  const modelNames = Object.keys(KNOWN_MODELS);

  // Check each known model
  for (const modelName of modelNames) {
    try {
      const config = KNOWN_MODELS[modelName];
      // Use GET with range header to avoid downloading full model
      const response = await fetch(`/models/${modelName}.onnx`, {
        method: 'HEAD',
        cache: 'no-cache'
      });
      if (response.ok) {
        discovered.push({
          id: modelName,
          name: config.name,
          size: config.size,
          inputShape: [1, 3, 640, 640],
          outputShape: config.outputShape,
          classes: config.classes,
          keypoints: config.keypoints,
          isDefault: modelName === 'yolo11n',
          usageCount: 0,
        });
      } else {
        console.log(`Model ${modelName} not found (HEAD returned ${response.status})`);
      }
    } catch (error) {
      console.log(`Model ${modelName} not available:`, error);
      // Model not available, skip
    }
  }

  console.log('Discovered models:', discovered.map(m => m.id));
  return discovered;
}

function getCOCOClasses(): string[] {
  return [
    'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
    'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
    'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
    'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
    'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
    'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
    'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
    'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
    'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
    'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
    'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
    'toothbrush'
  ];
}

export function getCOCOKeypoints(): string[] {
  return [
    'nose',
    'left_eye',
    'right_eye',
    'left_ear',
    'right_ear',
    'left_shoulder',
    'right_shoulder',
    'left_elbow',
    'right_elbow',
    'left_wrist',
    'right_wrist',
    'left_hip',
    'right_hip',
    'left_knee',
    'right_knee',
    'left_ankle',
    'right_ankle'
  ];
}

export function getClassColor(classId: number): string {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7DC6F', '#BB8FCE', '#F1948A', '#82E0AA', '#85C1E9',
    '#F0B27A', '#D7BDE2', '#A3E4D7', '#F5B7B1', '#D2B4DE',
    '#AED6F1', '#FAD7A0', '#D5DBDB', '#ABEBC6', '#F9E79F'
  ];
  return colors[classId % colors.length];
}
