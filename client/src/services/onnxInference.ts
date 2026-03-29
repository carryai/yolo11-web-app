import * as ort from 'onnxruntime-web';
import { Detection, Keypoint } from '../../../shared/types';
import { getClassColor } from './modelStorage';

export class ONNXInference {
  private session: ort.InferenceSession | null = null;
  private inputShape: number[] = [1, 3, 640, 640];
  private classes: string[] = [];
  private keypoints: string[] = [];
  private isPoseModel: boolean = false;
  private activeExecutionProvider: string = 'unknown';
  private letterboxInfo: { scale: number; padX: number; padY: number } | null = null;

  async loadModel(modelBlob: Blob | string, inputShape: number[], classes: string[], keypoints?: string[], outputShape?: number[]): Promise<void> {
    try {
      // Free previous session
      if (this.session) {
        await this.session.release();
        this.session = null;
      }

      // Handle different input types for model loading
      if (typeof modelBlob === 'string') {
        // If it's a string, treat it as a path
        this.session = await ort.InferenceSession.create(modelBlob, {
          executionProviders: ['webgpu', 'webgl', 'wasm', 'cpu'],
          graphOptimizationLevel: 'all',
          interOpNumThreads: 1,
          intraOpNumThreads: 1,
        });
      } else {
        // If it's a Blob, convert it to ArrayBuffer first
        const arrayBuffer = await modelBlob.arrayBuffer();
        this.session = await ort.InferenceSession.create(arrayBuffer, {
          executionProviders: ['webgpu', 'webgl', 'wasm', 'cpu'],
          graphOptimizationLevel: 'all',
          interOpNumThreads: 1,
          intraOpNumThreads: 1,
        });
      }

      this.inputShape = inputShape;
      this.classes = classes;
      this.keypoints = keypoints || [];
      // Detect pose model by output shape: [1, 56, 8400] where 56 = 4 bbox + 17*3 keypoints
      const hasPoseOutputShape = outputShape?.[1] === 56;
      this.isPoseModel = hasPoseOutputShape || (keypoints !== undefined && keypoints.length > 0);

      // Detect active execution provider
      this.activeExecutionProvider = this.detectExecutionProvider();

      const urlParams = new URLSearchParams(window.location.search);
      const debugMode = urlParams.get('debug') === 'true';
      if (debugMode) {
        console.log('Model loaded successfully, using engine:', this.activeExecutionProvider, this.isPoseModel ? '(pose model)' : '');
      }
    } catch (error) {
      console.error('Failed to load model:', error);

      // Check if it's a WebAssembly-related error (common with incorrect model files)
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('magic word') || errorMessage.includes('WebAssembly') || errorMessage.includes('wasm')) {
        console.warn('WebAssembly error detected - model file may be corrupted or in wrong format');
        // Still throw the error but with more context
      }

      throw error;
    }
  }

  async runInference(
    imageData: ImageData | HTMLImageElement | HTMLVideoElement,
    srcWidth?: number,
    srcHeight?: number,
    confidenceThreshold?: number,
    iouThreshold?: number
  ): Promise<Detection[]> {
    if (!this.session) {
      throw new Error('Model not loaded');
    }

    const startTime = performance.now();

    // Get source dimensions
    let width: number, height: number;
    if (imageData instanceof ImageData) {
      width = imageData.width;
      height = imageData.height;
    } else if ('videoWidth' in imageData) {
      // HTMLVideoElement
      width = srcWidth || imageData.videoWidth;
      height = srcHeight || imageData.videoHeight;
    } else {
      // HTMLImageElement
      width = srcWidth || imageData.width;
      height = srcHeight || imageData.height;
    }

    // Preprocess image with letterboxing - this sets this.letterboxInfo
    const inputTensor = this.preprocessImage(imageData, width, height);

    // Run inference
    try {
      const feeds: Record<string, ort.Tensor> = { [this.session.inputNames[0]]: inputTensor };
      const results = await this.session.run(feeds);

      // Postprocess output - use same width/height and letterboxInfo from preprocess
      const outputName = this.session.outputNames[0];
      const output = results[outputName];
      const detections = this.postprocessOutput(output, width, height, confidenceThreshold, iouThreshold);

      const endTime = performance.now();
      const inferenceTime = endTime - startTime;

      // Only log in debug mode
      const urlParams = new URLSearchParams(window.location.search);
      const debugMode = urlParams.get('debug') === 'true';
      if (debugMode) {
        console.log(`Inference completed in ${inferenceTime.toFixed(2)}ms, ${detections.length} detections, src: ${width}x${height}`);
      }

      return detections;
    } catch (error) {
      // Re-throw session errors
      if (error instanceof Error && (error.message.includes('Session') || error.message.includes('session'))) {
        throw error;
      }
      // Wrap other errors
      throw new Error(`Inference failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private preprocessImage(imageData: ImageData | HTMLImageElement | HTMLVideoElement, srcWidth: number, srcHeight: number): ort.Tensor {
    const [batch, channels, targetHeight, targetWidth] = this.inputShape;

    // Calculate letterbox parameters - preserve aspect ratio
    const scale = Math.min(targetWidth / srcWidth, targetHeight / srcHeight);
    const newWidth = Math.floor(srcWidth * scale);
    const newHeight = Math.floor(srcHeight * scale);
    const padX = Math.floor((targetWidth - newWidth) / 2);
    const padY = Math.floor((targetHeight - newHeight) / 2);

    // Store letterbox info for inverse transform
    this.letterboxInfo = { scale: scale, padX, padY };

    // Create canvas for letterboxing
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');

    // Fill with gray background (padding areas)
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    // Draw image with letterboxing (preserving aspect ratio)
    if (imageData instanceof ImageData) {
      ctx.putImageData(imageData, 0, 0);
      // Draw the ImageData content scaled and letterboxed
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = srcWidth;
      tempCanvas.height = srcHeight;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        tempCtx.putImageData(imageData, 0, 0);
        ctx.drawImage(tempCanvas, padX, padY, newWidth, newHeight);
      }
    } else {
      ctx.drawImage(imageData, padX, padY, newWidth, newHeight);
    }

    const data = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const srcData = data.data;

    // Normalize and rearrange to CHW format
    const tensorData = new Float32Array(batch * channels * targetHeight * targetWidth);

    for (let y = 0; y < targetHeight; y++) {
      for (let x = 0; x < targetWidth; x++) {
        const srcIdx = (y * targetWidth + x) * 4;
        const r = srcData[srcIdx] / 255.0;
        const g = srcData[srcIdx + 1] / 255.0;
        const b = srcData[srcIdx + 2] / 255.0;

        // CHW format
        tensorData[y * targetWidth + x] = r;
        tensorData[targetHeight * targetWidth + y * targetWidth + x] = g;
        tensorData[2 * targetHeight * targetWidth + y * targetWidth + x] = b;
      }
    }

    return new ort.Tensor('float32', tensorData, [batch, channels, targetHeight, targetWidth]);
  }

  private postprocessOutput(output: ort.Tensor, srcWidth: number, srcHeight: number, confidenceThreshold: number = 0.25, iouThreshold: number = 0.45): Detection[] {
    // YOLO output shape: [1, 84, 8400] - transposed format used by YOLOv8/YOLO11
    // YOLO-pose output shape: [1, 56, 8400] - 4 bbox + 1 obj + 17 keypoints * 3 (x, y, visibility)
    // IMPORTANT: YOLO11-pose has objectness at channel 4 (already sigmoided), keypoints start at channel 5
    const dims = output.dims;
    const data = output.data as Float32Array;

    let numAnchors: number;
    let numFeatures: number;
    let isTransposed = false;

    // Detect output layout: [1, 84, 8400] means transposed, [1, 8400, 84] means normal
    if (dims.length === 3 && dims[1] >= 56) {
      // Format: [batch, features, anchors] - transposed format used by YOLOv8/YOLO11/YOLO11-pose
      isTransposed = true;
      numFeatures = dims[1];
      numAnchors = dims[2];
    } else if (dims.length === 3 && dims[2] >= 56) {
      // Format: [batch, anchors, features] - standard format
      numFeatures = dims[2];
      numAnchors = dims[1];
    } else {
      // Fallback: assume standard interpretation
      numFeatures = dims[1];
      numAnchors = dims[2];
    }

    // DEBUG: Log raw output tensor shape and sample values
    const urlParams = new URLSearchParams(window.location.search);
    const debugMode = urlParams.get('debug') === 'true';
    if (debugMode) {
      console.log('[DEBUG] Raw output tensor shape:', dims);
      console.log('[DEBUG] isPoseModel:', this.isPoseModel);
      console.log('[DEBUG] numFeatures:', numFeatures, 'numAnchors:', numAnchors);

      // Sample raw values from first 3 anchors (all 56 channels for pose)
      const sampleSize = Math.min(3, numAnchors);
      for (let s = 0; s < sampleSize; s++) {
        const sampleData = [];
        for (let f = 0; f < Math.min(12, numFeatures); f++) {
          const idx = isTransposed ? f * numAnchors + s : s * numFeatures + f;
          sampleData.push(data[idx].toFixed(4));
        }
        console.log(`[DEBUG] Anchor ${s} channels [0-11]:`, sampleData.join(', '));
      }
    }

    // For pose models: numFeatures = 56 (4 bbox + 1 obj + 17 keypoints * 3 = 4 + 1 + 51 = 56)
    // IMPORTANT: Channel 4 is objectness, keypoints start at channel 5
    // For detection models: numFeatures = 84 (4 bbox + 80 classes)
    const numKeypoints = this.isPoseModel ? 17 : 0;
    const numClasses = this.isPoseModel ? 1 : numFeatures - 4; // Pose models only detect 'person'

    const predictions: Array<{
      bbox: [number, number, number, number];
      classId: number;
      confidence: number;
      keypoints?: Keypoint[];
    }> = [];

    let maxConfidenceFound = 0;

    for (let i = 0; i < numAnchors; i++) {
      let maxConfidence = 0;
      let maxClassId = 0;

      // For pose models, YOLO-pose output format is [1, 56, 8400] where:
      // - Channels 0-3: bbox (cx, cy, w, h) in pixel space (0-640)
      // - Channel 4: objectness score (ALREADY sigmoided, 0-1 range)
      // - Channels 5-55: 17 keypoints × 3 (x, y, visibility) = 51 channels
      // Total: 4 + 1 + 51 = 56 channels
      // IMPORTANT: Objectness and keypoint visibility are ALREADY sigmoided - do NOT apply sigmoid again!
      if (this.isPoseModel) {
        // For pose models, use objectness score (channel 4) as confidence
        // Objectness is already in 0-1 range (already sigmoided by the model)
        if (isTransposed) {
          maxConfidence = data[4 * numAnchors + i]; // Channel 4 = objectness (already sigmoided)
        } else {
          maxConfidence = data[i * numFeatures + 4]; // Channel 4 = objectness (already sigmoided)
        }
        maxClassId = 0; // Only 'person' class
      } else {
        // Find class with highest confidence (standard detection)
        for (let c = 0; c < numClasses; c++) {
          let confidence: number;

          if (isTransposed) {
            confidence = data[4 * numAnchors + c * numAnchors + i];
          } else {
            confidence = data[i * numFeatures + 4 + c];
          }

          if (confidence > maxConfidence) {
            maxConfidence = confidence;
            maxClassId = c;
          }
        }
      }

      if (maxConfidence > maxConfidenceFound) {
        maxConfidenceFound = maxConfidence;
      }

      if (maxConfidence >= confidenceThreshold) {
        // Extract bbox
        let cx: number, cy: number, w: number, h: number;

        if (isTransposed) {
          cx = data[i];
          cy = data[numAnchors + i];
          w = data[2 * numAnchors + i];
          h = data[3 * numAnchors + i];
        } else {
          cx = data[i * numFeatures];
          cy = data[i * numFeatures + 1];
          w = data[i * numFeatures + 2];
          h = data[i * numFeatures + 3];
        }

        // DEBUG: Log raw bbox values for first few detections
        if (debugMode && maxConfidence >= confidenceThreshold && i < 3) {
          console.log(`[DEBUG] Anchor ${i} raw bbox: cx=${cx.toFixed(2)}, cy=${cy.toFixed(2)}, w=${w.toFixed(2)}, h=${h.toFixed(2)}`);
        }

        // For YOLO11, bbox values are already in image space (not normalized to 640)
        // They represent center-x, center-y, width, height
        // Apply inverse letterbox transform to get coordinates in original image space
        const { scale, padX, padY } = this.letterboxInfo || { scale: 1, padX: 0, padY: 0 };

        // DEBUG: Log letterbox parameters
        if (debugMode && maxConfidence >= confidenceThreshold && i < 3) {
          console.log(`[DEBUG] Letterbox: scale=${scale.toFixed(4)}, padX=${padX}, padY=${padY}, srcSize=${srcWidth}x${srcHeight}`);
        }

        // Convert center format to corner format and remove padding/rescale
        const x1Orig = ((cx - w / 2) - padX) / scale / srcWidth;
        const y1Orig = ((cy - h / 2) - padY) / scale / srcHeight;
        const x2Orig = ((cx + w / 2) - padX) / scale / srcWidth;
        const y2Orig = ((cy + h / 2) - padY) / scale / srcHeight;

        // DEBUG: Log transformed bbox coordinates
        if (debugMode && maxConfidence >= confidenceThreshold && i < 3) {
          console.log(`[DEBUG] Anchor ${i} transformed bbox: x1=${x1Orig.toFixed(4)}, y1=${y1Orig.toFixed(4)}, x2=${x2Orig.toFixed(4)}, y2=${y2Orig.toFixed(4)}`);
        }

        // Extract keypoints for pose models
        let keypoints: Keypoint[] | undefined;
        if (this.isPoseModel && numKeypoints > 0) {
          keypoints = [];
          for (let k = 0; k < numKeypoints; k++) {
            let kx: number, ky: number, kvis: number;
            // For pose: 4 bbox + 1 obj + keypoints*3 (keypoints start at channel 5)
            const kpBase = 5 + k * 3; // 4 bbox + 1 obj + 3 per keypoint

            if (isTransposed) {
              kx = data[kpBase * numAnchors + i];
              ky = data[(kpBase + 1) * numAnchors + i];
              kvis = data[(kpBase + 2) * numAnchors + i]; // Already sigmoided (0-1 range)
            } else {
              kx = data[i * numFeatures + kpBase];
              ky = data[i * numFeatures + kpBase + 1];
              kvis = data[i * numFeatures + kpBase + 2]; // Already sigmoided (0-1 range)
            }

            // Do NOT apply sigmoid - kvis is already in 0-1 range from the model
            // Transform keypoints coordinates (same transform as bbox)
            const kxOrig = (kx - padX) / scale / srcWidth;
            const kyOrig = (ky - padY) / scale / srcHeight;

            // DEBUG: Log first keypoint for first few detections
            if (debugMode && k === 0 && maxConfidence >= confidenceThreshold) {
              console.log(`[DEBUG] Anchor ${i} keypoint[0]: x=${kx.toFixed(2)}, y=${ky.toFixed(2)}, vis=${kvis.toFixed(4)}`);
            }

            keypoints.push({
              x: Math.max(0, Math.min(1, kxOrig)),
              y: Math.max(0, Math.min(1, kyOrig)),
              visibility: kvis >= 0.5 ? 2 : 0, // threshold visibility (already 0-1)
              name: this.keypoints[k] || `keypoint_${k}`,
            });
          }
        }

        predictions.push({
          bbox: [
            Math.max(0, Math.min(1, x1Orig)),
            Math.max(0, Math.min(1, y1Orig)),
            Math.max(0, Math.min(1, x2Orig)),
            Math.max(0, Math.min(1, y2Orig))
          ],
          classId: maxClassId,
          confidence: maxConfidence,
          keypoints,
        });
      }
    }

    // Apply Non-Maximum Suppression
    const nmsResult = this.nonMaxSuppression(predictions, iouThreshold);

    // Convert to Detection format
    return nmsResult.map(d => ({
      bbox: d.bbox,
      classId: d.classId,
      className: this.classes[d.classId] || `class_${d.classId}`,
      confidence: d.confidence,
      color: getClassColor(d.classId),
      keypoints: d.keypoints,
    }));
  }

  private nonMaxSuppression(
    predictions: Array<{ bbox: [number, number, number, number]; classId: number; confidence: number; keypoints?: Keypoint[] }>,
    iouThreshold: number
  ): Array<{ bbox: [number, number, number, number]; classId: number; confidence: number; keypoints?: Keypoint[] }> {
    // Sort by confidence
    predictions.sort((a, b) => b.confidence - a.confidence);

    const selected: typeof predictions = [];

    while (predictions.length > 0) {
      const current = predictions.shift()!;
      selected.push(current);

      // Filter out boxes with high IoU
      predictions = predictions.filter(pred => {
        if (pred.classId !== current.classId) return true;
        const iou = this.calculateIoU(current.bbox, pred.bbox);
        return iou < iouThreshold;
      });
    }

    return selected;
  }

  private calculateIoU(box1: [number, number, number, number], box2: [number, number, number, number]): number {
    const [x1a, y1a, x2a, y2a] = box1;
    const [x1b, y1b, x2b, y2b] = box2;

    const x1 = Math.max(x1a, x1b);
    const y1 = Math.max(y1a, y1b);
    const x2 = Math.min(x2a, x2b);
    const y2 = Math.min(y2a, y2b);

    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const area1 = (x2a - x1a) * (y2a - y1a);
    const area2 = (x2b - x1b) * (y2b - y1b);
    const union = area1 + area2 - intersection;

    return union > 0 ? intersection / union : 0;
  }

  async release(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
  }

  isLoaded(): boolean {
    return this.session !== null;
  }

  getExecutionProvider(): string {
    return this.activeExecutionProvider;
  }

  private detectExecutionProvider(): string {
    // Try to detect which execution provider is being used
    // onnxruntime-web doesn't expose this directly, so we check backend availability
    if (ort.env.wasm) {
      // Check if WebGPU is available (highest priority in our config)
      if ('gpu' in navigator) {
        return 'WebGPU';
      }
      // Check if WebGL is available
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (gl) {
          return 'WebGL';
        }
      } catch {
        // WebGL not available
      }
      return 'WASM';
    }
    return 'Unknown';
  }
}

export const onnxInference = new ONNXInference();
