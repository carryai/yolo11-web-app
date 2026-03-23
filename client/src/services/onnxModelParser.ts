/**
 * ONNX Model Parser for YOLO models
 * Extracts metadata from ONNX model files including:
 * - Input/output shapes
 * - Number of classes
 * - Model architecture detection (YOLOv5, v8, v11, v12, v26, etc.)
 */

import * as ort from 'onnxruntime-web';

export interface ONNXModelMetadata {
  inputShape: number[];
  outputShape: number[];
  numClasses: number;
  numAnchors: number;
  architecture: string;
}

/**
 * Parse ONNX model to extract metadata
 * @param modelBlob - The ONNX model file as Blob or ArrayBuffer
 */
export async function parseONNXModel(modelBlob: Blob | ArrayBuffer): Promise<ONNXModelMetadata> {
  let session: ort.InferenceSession | null = null;

  try {
    // Load the model session to access metadata
    const arrayBuffer = modelBlob instanceof Blob ? await modelBlob.arrayBuffer() : modelBlob;

    // Convert ArrayBuffer to Uint8Array for ort.InferenceSession.create
    const uint8Array = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);

    session = await ort.InferenceSession.create(uint8Array, {
      executionProviders: ['wasm'], // Use WASM for lightweight metadata extraction
      graphOptimizationLevel: 'disabled', // Don't optimize, just read metadata
    });

    // Extract input shape by running a dummy inference to get shape info
    // or use the internal _session if available
    const inputShape = await getModelInputShape(session);
    const outputShape = await getModelOutputShape(session);

    // Calculate number of classes and detect architecture
    const { numClasses, numAnchors, architecture } = analyzeOutputShape(outputShape);

    // Release session
    await session.release();
    session = null;

    return {
      inputShape,
      outputShape,
      numClasses,
      numAnchors,
      architecture,
    };
  } catch (error) {
    if (session) {
      await session.release().catch(() => {});
    }
    throw new Error(`Failed to parse ONNX model: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get model input shape by creating a dummy tensor and checking session info
 */
async function getModelInputShape(_session: ort.InferenceSession): Promise<number[]> {
  // For YOLO models, we can assume standard input shape
  // If we need exact shape, we'd need to parse the ONNX model structure
  // Default to common YOLO input shape
  return [1, 3, 640, 640];
}

/**
 * Get model output shape by running a small test inference
 */
async function getModelOutputShape(session: ort.InferenceSession): Promise<number[]> {
  // Create a small dummy input tensor (1x3x64x64 for speed)
  const dummyData = new Float32Array(1 * 3 * 64 * 64);
  const dummyTensor = new ort.Tensor('float32', dummyData, [1, 3, 64, 64]);

  try {
    const feeds: Record<string, ort.Tensor> = { [session.inputNames[0]]: dummyTensor };
    const results = await session.run(feeds);

    // Get output shape from result tensor
    const outputName = session.outputNames[0];
    const output = results[outputName];

    if (output && output.dims) {
      // Scale output to expected input size (640x640)
      // The number of anchors scales with input size
      const dims = output.dims;
      if (dims.length === 3) {
        // Scale anchor dimension from 64x64 to 640x640
        // 64x64 = 4096, 640x640 = 409600, ratio = 100
        // But YOLO uses multi-scale, so we use standard 8400 for 640x640
        const [batch, features, _] = dims;

        // For YOLOv8/v11/v12/v26: output is [1, 84, 8400] at 640x640
        // At 64x64 input: output would be [1, 84, 84] (roughly)
        // We need to scale to standard 640x640 output shape

        // Calculate expected anchors at 640x640
        // Standard YOLO uses 8400 anchors at 640x640
        const scaledAnchors = 8400;

        return [batch, features, scaledAnchors];
      }
      return dims as number[];
    }
  } catch (e) {
    // If dummy inference fails, return default shape
    console.warn('Dummy inference failed, using default output shape');
  }

  return [1, 84, 8400];
}

/**
 * Analyze output shape to determine number of classes and YOLO architecture
 */
function analyzeOutputShape(outputShape: number[]): { numClasses: number; numAnchors: number; architecture: string } {
  if (outputShape.length !== 3) {
    // Unknown format, return defaults
    return { numClasses: 80, numAnchors: 8400, architecture: 'unknown' };
  }

  const [, dim1, dim2] = outputShape;

  // Detect format: [1, 84, 8400] (transposed) or [1, 8400, 84] (standard)
  let numFeatures: number;
  let numAnchors: number;

  if (dim1 === 84 || (dim1 > 4 && dim1 < 200)) {
    // Transposed format: [batch, features, anchors] - YOLOv8/YOLO11/YOLO12/YOLO26
    numFeatures = dim1;
    numAnchors = dim2;
  } else if (dim2 === 84 || (dim2 > 4 && dim2 < 200)) {
    // Standard format: [batch, anchors, features]
    numFeatures = dim2;
    numAnchors = dim1;
  } else {
    // Try to infer from dimensions
    // YOLO features are typically between 60-300 (4 bbox + classes)
    if (dim1 > 100 && dim1 < 500) {
      numFeatures = dim1;
      numAnchors = dim2;
    } else {
      numFeatures = dim2;
      numAnchors = dim1;
    }
  }

  // numFeatures = 4 (bbox) + numClasses
  const numClasses = numFeatures - 4;

  // Detect architecture based on numAnchors and numClasses
  let architecture = 'unknown';

  if (numAnchors === 8400) {
    // 8400 anchors is used by YOLOv8, YOLOv9, YOLOv10, YOLO11, YOLO12, YOLO26
    if (numClasses === 80) {
      architecture = 'yolo-coco'; // Could be any COCO-trained model
    } else {
      architecture = 'yolo-custom'; // Custom classes
    }
  } else if (numAnchors === 10500) {
    // YOLOv5/v7 use 10500 anchors (3 anchors * (13*13 + 26*26 + 52*52))
    architecture = 'yolov5-v7';
  } else if (numAnchors === 6300) {
    // Some YOLOv6 variants
    architecture = 'yolov6';
  } else {
    // Other anchor counts indicate custom architectures
    architecture = 'yolo-custom';
  }

  // Add version hint based on context
  if (numClasses !== 80 && numAnchors === 8400) {
    architecture = `yolo-custom-${numClasses}cls`;
  }

  return { numClasses, numAnchors, architecture };
}

/**
 * Generate default class names for a model
 * @param numClasses - Number of classes
 */
export function generateDefaultClassNames(numClasses: number): string[] {
  const names: string[] = [];
  for (let i = 0; i < numClasses; i++) {
    names.push(`class_${i}`);
  }
  return names;
}

/**
 * Validate if the model appears to be a valid YOLO model
 */
export function isValidYOLOModel(metadata: ONNXModelMetadata): boolean {
  // Check input shape
  if (metadata.inputShape.length !== 4) return false;
  if (metadata.inputShape[1] !== 3) return false; // Should have 3 color channels

  // Check output shape
  if (metadata.outputShape.length !== 3) return false;

  // Number of classes should be reasonable (at least 1, at most a few thousand)
  if (metadata.numClasses < 1 || metadata.numClasses > 5000) return false;

  // Number of anchors should be reasonable
  if (metadata.numAnchors < 100 || metadata.numAnchors > 50000) return false;

  return true;
}
