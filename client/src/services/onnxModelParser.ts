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

    session = await ort.InferenceSession.create(arrayBuffer, {
      executionProviders: ['wasm'], // Use WASM for lightweight metadata extraction
      graphOptimizationLevel: 'none', // Don't optimize, just read metadata
    });

    // Extract input shape
    const inputName = session.inputNames[0];
    const inputType = session.inputTypes[inputName];

    let inputShape: number[];
    if (inputType === 'tensor') {
      const tensorType = session.inputTypes[inputName] as ort.TensorType;
      inputShape = tensorType.dims.map(d => d === -1 ? 1 : d); // Replace dynamic dims with 1
    } else {
      inputShape = [1, 3, 640, 640]; // Default fallback
    }

    // Extract output shape
    const outputName = session.outputNames[0];
    const outputType = session.outputTypes[outputName];

    let outputShape: number[];
    if (outputType === 'tensor') {
      const tensorType = session.outputTypes[outputName] as ort.TensorType;
      outputShape = tensorType.dims.map(d => d === -1 ? 1 : d);
    } else {
      outputShape = [1, 84, 8400]; // Default fallback
    }

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
 * Analyze output shape to determine number of classes and YOLO architecture
 */
function analyzeOutputShape(outputShape: number[]): { numClasses: number; numAnchors: number; architecture: string } {
  if (outputShape.length !== 3) {
    // Unknown format, return defaults
    return { numClasses: 80, numAnchors: 8400, architecture: 'unknown' };
  }

  const [batch, dim1, dim2] = outputShape;

  // Detect format: [1, 84, 8400] (transposed) or [1, 8400, 84] (standard)
  let numFeatures: number;
  let numAnchors: number;
  let isTransposed: boolean;

  if (dim1 === 84 || (dim1 > dim2 && dim1 < 200)) {
    // Transposed format: [batch, features, anchors] - YOLOv8/YOLO11/YOLO12/YOLO26
    isTransposed = true;
    numFeatures = dim1;
    numAnchors = dim2;
  } else if (dim2 === 84 || (dim2 > dim1 && dim2 < 200)) {
    // Standard format: [batch, anchors, features]
    isTransposed = false;
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
