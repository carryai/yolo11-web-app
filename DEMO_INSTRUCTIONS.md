# WebGPU + YOLO Object Detection Demo Instructions

## How to Use the Application

### 1. Access the Application
Open your modern browser (Chrome 113+ or Edge 113+) and navigate to:
```
http://localhost:8080
```

### 2. Grant Camera Permissions
- When prompted, allow camera access to enable real-time object detection
- The application will display your webcam feed with live object detection

### 3. Observe Real-time Detection
- Objects in your camera view will be highlighted with colored bounding boxes
- Each object will display its classification label and confidence percentage
- Detection happens in real-time using WebGPU acceleration

### 4. Performance Indicators
- Frame rate counter shows how many frames per second are being processed
- With WebGPU acceleration, expect 15-30 FPS on capable hardware
- The system efficiently processes frames using GPU compute shaders

## What You're Seeing

The application demonstrates several cutting-edge technologies working together:

1. **WebGPU**: Hardware-accelerated computation for optimal performance
2. **YOLO11n**: State-of-the-art object detection model running in the browser
3. **ONNX Runtime Web**: Efficient model inference directly in the browser
4. **Real-time Processing**: Continuous analysis of camera feed with immediate visualization

## Technical Highlights

- **Privacy-Preserving**: All processing happens locally in your browser
- **No Internet Required**: Once loaded, works completely offline
- **GPU Accelerated**: Leverages your computer's GPU for fast inference
- **Modern Web Standards**: Uses latest web APIs for optimal performance

## Troubleshooting

### If you don't see camera access:
- Check browser permissions and ensure camera access is allowed
- Verify you're using a supported browser (Chrome 113+ or Edge 113+)

### If performance is slow:
- Ensure WebGPU is enabled in your browser
- Close other resource-intensive applications
- The application performs best on machines with dedicated GPUs

### For best results:
- Use good lighting conditions for better object visibility
- Position objects clearly in the camera frame
- Ensure your system has sufficient GPU resources available

## Architecture Overview

This application represents a breakthrough in client-side AI, demonstrating that sophisticated machine learning models can run efficiently in browsers using hardware acceleration. Unlike traditional approaches that require server-side processing, this solution provides immediate results while maintaining complete privacy.