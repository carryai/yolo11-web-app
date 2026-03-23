# RTSP Stream with Client-Side YOLO Detection - Final Summary

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  RTSP Camera    │     │   Node.js Server │     │   Web Browser   │
│ 192.168.1.122   │────▶│   (Port 3001)    │────▶│   (Port 5173)   │
│                 │     │                  │     │                 │
│                 │     │  FFmpeg:         │     │  MJPEG Player   │
│                 │     │  RTSP → MJPEG    │     │  + ONNX Runtime │
│                 │     │                  │     │  (YOLO detection)│
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## How It Works

1. **RTSP Camera** streams video at `rtsp://jetson:nano@192.168.1.122/live`
2. **Server** uses FFmpeg to convert RTSP to MJPEG stream
3. **Browser** receives MJPEG stream and displays it via Image element
4. **Client-side ONNX Runtime** runs YOLO detection on each frame
5. **Detection overlays** are drawn on a canvas overlay

## How to Use RTSP Stream

1. **Open the web app**: http://localhost:5173

2. **Click the RTSP button** (📡 icon) in the ControlBar

3. **Enter your RTSP URL**:
   ```
   rtsp://jetson:nano@192.168.1.122/live
   ```

4. **Click "Connect"**

The MJPEG stream will display and YOLO detection will run on each frame client-side using the ONNX model already loaded in the browser.

## Key Features

| Feature | Description |
|---------|-------------|
| **Client-side inference** | All YOLO detection runs in the browser using ONNX Runtime Web |
| **MJPEG streaming** | Server converts RTSP to MJPEG for browser compatibility |
| **Confidence slider** | Adjust detection threshold in real-time |
| **Detection overlays** | Bounding boxes drawn on top of the stream |
| **Detection logging** | All detections logged with timestamps |
| **IoU threshold** | Configurable non-maximum suppression threshold |

## Files Modified/Created

| File | Purpose |
|------|---------|
| `server/src/index.ts` | Added `/api/stream/mjpeg` endpoint for RTSP to MJPEG conversion |
| `client/src/services/mjpegPlayer.ts` | MJPEG player service for connecting to and displaying streams |
| `client/src/App.tsx` | RTSP integration with detection loop, handles MJPEG frame capture |
| `client/src/components/VideoCanvas/VideoCanvas.tsx` | Display MJPEG stream with detection overlays |
| `client/src/services/webrtcPlayer.ts` | WebRTC player (alternative, not used in final implementation) |
| `client/src/services/rtspMjpegPlayer.ts` | Initial MJPEG player (replaced by mjpegPlayer.ts) |

## Server Endpoint

### GET `/api/stream/mjpeg`

Streams MJPEG video from an RTSP source.

**Query Parameters:**
- `url` (required): RTSP stream URL

**Example:**
```
GET /api/stream/mjpeg?url=rtsp://jetson:nano@192.168.1.122/live
```

**Response Headers:**
```
Content-Type: multipart/x-mixed-replace; boundary=--mjpegframe
Cache-Control: no-cache
Connection: keep-alive
```

## Configuration

### Environment Variables (Server)
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Server port |
| `HOST` | 0.0.0.0 | Server host |
| `LOG_LEVEL` | info | Logging level |

### Default Detection Settings (Client)
| Setting | Default | Range |
|---------|---------|-------|
| Confidence Threshold | 0.45 | 0.1 - 0.95 |
| IoU Threshold | 0.45 | 0.1 - 0.95 |

## Troubleshooting

### Stream not connecting
- Verify RTSP URL is correct
- Check if camera is accessible: `ffmpeg -i rtsp://...`
- Ensure server is running on port 3001

### No detections appearing
- Verify ONNX model is loaded (check browser console)
- Lower confidence threshold
- Ensure objects are in camera view

### Stream is slow/laggy
- Server FFmpeg scales to 640x480 for performance
- Reduce frame rate in server code if needed
- Check network bandwidth

## Date
2026-03-24
