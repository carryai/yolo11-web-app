# Getting Started with WebGPU YOLO Application

## Prerequisites

1. **Node.js and npm** - For running the development server
2. **Python and pip** - For model conversion (optional)
3. **Ultralytics** - For model conversion (optional)

## Obtaining the YOLO ONNX Model

The application requires a YOLO ONNX model file to function. Here are the ways to obtain one:

### Option 1: Using Ultralytics (Recommended)

```bash
# Install ultralytics
pip install ultralytics

# Download and export a YOLO model to ONNX format
python -c "
from ultralytics import YOLO
model = YOLO('yolo11n.pt')  # Download pre-trained model
model.export(format='onnx', opset=11, dynamic=False, half=False)
"
```

### Option 2: Download Pre-converted Model

Visit the Ultralytics releases page to download a pre-converted ONNX model:
- https://github.com/ultralytics/assets/releases
- Look for YOLOv8 or YOLOv11 models with `.onnx` format

### Option 3: Manual Model Placement

Place your ONNX model file in the `client/public/models/` directory and name it `yolo11n.onnx`.

## Model Requirements

- **Format**: ONNX (Open Neural Network Exchange)
- **Architecture**: YOLO (v5, v8, or v11 recommended)
- **Input Shape**: [1, 3, 640, 640] (for standard YOLO models)
- **Output**: Compatible with COCO dataset classes (80 classes)

## Setting Up the Application

1. Ensure you have the ONNX model in `client/public/models/yolo11n.onnx`
2. Install dependencies: `npm install` (from the client directory)
3. Start the development server: `npm run dev`
4. Access the application at `http://localhost:5173`

## Troubleshooting

### Common Issues:

1. **"Expected magic word" error**: The model file is not a proper ONNX file. Ensure you have an actual ONNX model, not a PyTorch or other format.

2. **"Failed to load model"**: Check that the model file is placed in the correct location (`client/public/models/yolo11n.onnx`) and is a valid ONNX model.

3. **WebAssembly errors**: These typically indicate the model file is corrupted or in an unsupported format.

## Model Validation

To validate your ONNX model, you can use the ONNX library:

```python
import onnx

# Load and check the model
model = onnx.load('path/to/your/model.onnx')
onnx.checker.check_model(model)
print("Model is valid!")
```

## Supported Execution Providers

The application attempts to use these execution providers in order:
1. WebGPU (fastest, modern browsers)
2. WebGL (good performance)
3. WASM (fallback)
4. CPU (slowest, fallback)

For best performance, use a modern browser that supports WebGPU.