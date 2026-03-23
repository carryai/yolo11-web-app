# WebGPU + YOLO Object Detection Application - Architecture

## System Overview
The application consists of three main components working together:

### 1. Frontend (Client)
- **Technology**: React + TypeScript + Vite
- **Port**: Served via Vite dev server on localhost:5173 (IPv6 binding)
- **Access Point**: Proxy server at http://localhost:8080
- **Functionality**: 
  - WebGPU device initialization
  - ONNX model loading and inference
  - Real-time video processing
  - Object detection visualization

### 2. Backend (Server)
- **Technology**: Fastify server
- **Port**: http://localhost:3001
- **API Endpoints**:
  - GET /api/health - Health check
  - GET /api/models - Model management
  - GET /api/streams - Stream management
  - WS /ws/detection - WebSocket for detection results

### 3. Proxy/Load Balancer
- **Technology**: Python-based reverse proxy
- **Port**: http://localhost:8080
- **Function**: Routes requests to appropriate backend services
- **Purpose**: Unified access point for the application

## Current Status
- ✅ Frontend server running on port 5173 (Vite dev server)
- ✅ Backend server running on port 3001 (Fastify)
- ✅ Proxy server running on port 8080 (Python)
- ✅ Application accessible at http://localhost:8080
- ✅ All API endpoints responding correctly
- ✅ WebGPU initialization ready
- ✅ YOLO11n model loaded and available

## How to Access
1. Open your browser to: http://localhost:8080
2. Click "Start Camera" to begin real-time object detection
3. View detections with bounding boxes and confidence scores
4. Adjust settings using the control panel

## Performance Expectations
- Real-time detection at 15-30 FPS depending on hardware
- WebGPU acceleration providing 2-3x performance improvement
- All processing happening client-side in the browser
- Privacy-preserving: no data leaves the browser