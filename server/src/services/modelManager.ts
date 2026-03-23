import { existsSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import * as ort from 'onnxruntime-node';
import { Logger } from 'pino';
import { ModelInfo } from '../../../shared/types.js';

const MODELS_DIR = join(process.cwd(), 'models');

// COCO classes (80 classes) - used as fallback for COCO-trained models
const COCO_CLASSES = [
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

export class ModelManager {
  private models: Map<string, ModelInfo> = new Map();
  private sessions: Map<string, ort.InferenceSession> = new Map();
  private activeModelId: string | null = null;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
    this.ensureModelsDir();
    this.loadModels();
  }

  private ensureModelsDir(): void {
    if (!existsSync(MODELS_DIR)) {
      mkdirSync(MODELS_DIR, { recursive: true });
      this.logger.info({ path: MODELS_DIR }, 'Created models directory');
    }
  }

  private async loadModels(): Promise<void> {
    try {
      const files = readdirSync(MODELS_DIR);

      for (const file of files) {
        if (file.endsWith('.onnx')) {
          const id = file.replace('.onnx', '');
          const filePath = join(MODELS_DIR, file);
          const stats = { size: 0 };

          try {
            const fsStats = require('fs').statSync(filePath);
            stats.size = fsStats.size;
          } catch {}

          // Extract model metadata from ONNX file
          const metadata = await this.extractModelMetadata(filePath);

          const modelInfo: ModelInfo = {
            id,
            name: metadata.name || id,
            size: stats.size,
            inputShape: metadata.inputShape,
            outputShape: metadata.outputShape,
            classes: metadata.classes,
            isDefault: id === 'yolo11n',
            usageCount: 0,
          };

          this.models.set(id, modelInfo);
          this.logger.info({ modelId: id, classes: metadata.classes.length }, 'Loaded model from disk');
        }
      }

      // Set default active model
      if (this.models.has('yolo11n')) {
        this.activeModelId = 'yolo11n';
      } else if (this.models.size > 0) {
        this.activeModelId = Array.from(this.models.keys())[0];
      }

    } catch (error: any) {
      this.logger.error({ error }, 'Failed to load models from disk');
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return Array.from(this.models.values());
  }

  async getModelInfo(id: string): Promise<ModelInfo | null> {
    return this.models.get(id) || null;
  }

  async uploadModel(name: string, buffer: Buffer, _mimetype: string, classes?: string[]): Promise<ModelInfo> {
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const filePath = join(MODELS_DIR, `${id}.onnx`);

    // Save model to disk
    writeFileSync(filePath, buffer);
    this.logger.info({ modelId: id, size: buffer.length }, 'Model saved to disk');

    // Extract model metadata from ONNX file
    const metadata = await this.extractModelMetadata(filePath);

    // Use provided classes or metadata classes or fallback to COCO
    const modelClasses = classes || metadata.classes || COCO_CLASSES.slice(0, metadata.numClasses || 80);

    // Create model info
    const modelInfo: ModelInfo = {
      id,
      name,
      size: buffer.length,
      inputShape: metadata.inputShape,
      outputShape: metadata.outputShape,
      classes: modelClasses,
      isDefault: false,
      uploadDate: Date.now(),
      usageCount: 0,
    };

    this.models.set(id, modelInfo);

    // Pre-load model session
    try {
      const session = await ort.InferenceSession.create(filePath, {
        executionProviders: ['cuda', 'cpu'],
        graphOptimizationLevel: 'all',
      });
      this.sessions.set(id, session);
      this.logger.info({ modelId: id, classes: modelClasses.length }, 'Model session created');
    } catch (error: any) {
      this.logger.error({ modelId: id, error }, 'Failed to create model session');
    }

    return modelInfo;
  }

  async deleteModel(id: string): Promise<void> {
    const model = this.models.get(id);
    if (!model) {
      throw new Error('Model not found');
    }

    if (model.isDefault) {
      throw new Error('Cannot delete default model');
    }

    const filePath = join(MODELS_DIR, `${id}.onnx`);
    if (existsSync(filePath)) {
      rmSync(filePath);
    }

    // Remove session
    const session = this.sessions.get(id);
    if (session) {
      await session.release();
      this.sessions.delete(id);
    }

    this.models.delete(id);
    this.logger.info({ modelId: id }, 'Model deleted');
  }

  async updateModel(id: string, updates: Partial<{ name: string; isDefault: boolean }>): Promise<ModelInfo> {
    const model = this.models.get(id);
    if (!model) {
      throw new Error('Model not found');
    }

    const updated = { ...model, ...updates };
    this.models.set(id, updated);

    return updated;
  }

  getActiveModel(): ModelInfo | null {
    if (!this.activeModelId) return null;
    return this.models.get(this.activeModelId) || null;
  }

  setActiveModel(id: string): void {
    if (this.models.has(id)) {
      this.activeModelId = id;
      this.logger.info({ modelId: id }, 'Active model changed');
    } else {
      throw new Error('Model not found');
    }
  }

  async getSession(modelId?: string): Promise<ort.InferenceSession | null> {
    const id = modelId || this.activeModelId;
    if (!id) return null;

    // Check if session exists
    let session = this.sessions.get(id);
    
    if (!session) {
      // Load model
      const model = this.models.get(id);
      if (!model) return null;

      const filePath = join(MODELS_DIR, `${id}.onnx`);
      if (!existsSync(filePath)) return null;

      try {
        session = await ort.InferenceSession.create(filePath, {
          executionProviders: ['cuda', 'cpu'],
          graphOptimizationLevel: 'all',
        });
        this.sessions.set(id, session);
      } catch (error: any) {
        this.logger.error({ modelId: id, error }, 'Failed to load model session');
        return null;
      }
    }

    return session;
  }

  /**
   * Extract metadata from ONNX model file
   * Uses a simplified approach: runs a dummy inference to get output shape
   */
  private async extractModelMetadata(filePath: string): Promise<{
    name: string;
    inputShape: number[];
    outputShape: number[];
    numClasses: number;
    classes: string[];
  }> {
    try {
      const session = await ort.InferenceSession.create(filePath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'disabled',
      });

      // Default input shape for YOLO models
      const inputShape: number[] = [1, 3, 640, 640];

      // Run a dummy inference with small input to get output shape
      const dummyData = new Float32Array(1 * 3 * 64 * 64);
      const dummyTensor = new ort.Tensor('float32', dummyData, [1, 3, 64, 64]);

      let outputShape: number[] = [1, 84, 8400];
      let numClasses = 80;

      try {
        const feeds: Record<string, ort.Tensor> = { [session.inputNames[0]]: dummyTensor };
        const results = await session.run(feeds);

        const outputName = session.outputNames[0];
        const output = results[outputName];

        if (output && output.dims && output.dims.length === 3) {
          // Scale output from 64x64 input to expected 640x640 output
          // For YOLOv8/v11/v12/v26: features dimension stays same, anchors scale
          const [, features, _] = output.dims;

          // Standard YOLO output at 640x640 has 8400 anchors
          // At 64x64 input, anchors would be roughly 84 (8400/100)
          // But we use the features dimension to calculate classes
          numClasses = features - 4; // 4 bbox params + numClasses

          // Use standard 640x640 output shape
          outputShape = [1, features, 8400];
        }
      } catch (e) {
        this.logger.warn({ error: e }, 'Dummy inference failed, using default output shape');
      }

      await session.release();

      // Generate class names
      let classes: string[];
      if (numClasses === 80) {
        classes = COCO_CLASSES;
      } else {
        classes = [];
        for (let i = 0; i < numClasses; i++) {
          classes.push(`class_${i}`);
        }
      }

      return {
        name: '',
        inputShape,
        outputShape,
        numClasses,
        classes,
      };
    } catch (error: any) {
      this.logger.error({ error }, 'Failed to extract model metadata');
      // Return defaults on error
      return {
        name: '',
        inputShape: [1, 3, 640, 640],
        outputShape: [1, 84, 8400],
        numClasses: 80,
        classes: COCO_CLASSES,
      };
    }
  }
}
