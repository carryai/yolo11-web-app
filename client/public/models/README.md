# Models Directory

This directory should contain the ONNX model files for the YOLO object detection application.

## Required Model

The application expects a model file named `yolo11n.onnx`.

## How to Obtain the Model

To get the proper YOLO11n ONNX model:

1. Install Ultralytics: `pip install ultralytics`
2. Export the model: 
   ```python
   from ultralytics import YOLO
   model = YOLO('yolo11n.pt')  # Download pre-trained model
   model.export(format='onnx', opset=11)  # Export to ONNX
   ```

Or download a pre-converted model from the Ultralytics releases page.