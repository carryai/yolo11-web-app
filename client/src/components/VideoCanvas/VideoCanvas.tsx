import React, { useRef, useEffect } from 'react';
import { Detection } from '../../../../shared/types';
import { useAppStore } from '../../store/useAppStore';
import { mjpegPlayer } from '../../services/mjpegPlayer';

interface VideoCanvasProps {
  detections: Detection[];
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

export const VideoCanvas: React.FC<VideoCanvasProps> = ({ detections, videoRef, canvasRef }) => {
  const { settings, inputSource } = useAppStore();
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mjpegImgRef = useRef<HTMLImageElement | null>(null);

  // Update MJPEG image element reference when input source changes
  useEffect(() => {
    if (inputSource?.type === 'rtsp') {
      const img = mjpegPlayer.getImageElement();
      if (img && containerRef.current) {
        mjpegImgRef.current = img;
        mjpegPlayer.attachTo(containerRef.current);
      }
    }
  }, [inputSource?.type]);

  // Draw detection overlays
  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current;
    const mainCanvas = canvasRef.current;
    const container = containerRef.current;

    if (!overlayCanvas || !mainCanvas || !container) return;
    if (mainCanvas.width === 0 || mainCanvas.height === 0) return;

    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;

    // Get the actual rendered size and position of the main canvas
    const mainRect = mainCanvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Calculate the position and size of the canvas within the container
    const offsetX = mainRect.left - containerRect.left;
    const offsetY = mainRect.top - containerRect.top;
    const renderedWidth = mainRect.width;
    const renderedHeight = mainRect.height;

    // Set overlay canvas size to match container
    overlayCanvas.width = containerRect.width;
    overlayCanvas.height = containerRect.height;

    // Clear previous overlays
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Draw detections - scale from normalized bbox to overlay canvas coordinates
    // detection.bbox is normalized [x1, y1, x2, y2] in 0-1 range relative to the ORIGINAL video dimensions
    // mainCanvas.width/height are also the original video dimensions
    detections.forEach((detection) => {
      // Convert normalized bbox to canvas internal coordinates
      const x1 = detection.bbox[0] * mainCanvas.width;
      const y1 = detection.bbox[1] * mainCanvas.height;
      const x2 = detection.bbox[2] * mainCanvas.width;
      const y2 = detection.bbox[3] * mainCanvas.height;

      // Scale to rendered screen coordinates
      const scaleX = renderedWidth / mainCanvas.width;
      const scaleY = renderedHeight / mainCanvas.height;
      const x = offsetX + x1 * scaleX;
      const y = offsetY + y1 * scaleY;
      const width = (x2 - x1) * scaleX;
      const height = (y2 - y1) * scaleY;

      // Draw bounding box
      ctx.strokeStyle = detection.color;
      ctx.lineWidth = Math.max(2, renderedWidth / 320);
      ctx.strokeRect(x, y, width, height);

      // Draw label background
      if (settings.showLabels) {
        const label = settings.showConfidence
          ? `${detection.className} ${(detection.confidence * 100).toFixed(0)}%`
          : detection.className;

        ctx.font = `${Math.max(12, renderedWidth / 53)}px Inter, sans-serif`;
        const textWidth = ctx.measureText(label).width;
        const labelHeight = Math.max(20, renderedHeight / 32);

        // Background
        ctx.fillStyle = detection.color;
        ctx.fillRect(x, y - labelHeight, textWidth + 8, labelHeight);

        // Text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, x + 4, y - 6);
      }
    });
  }, [detections, settings.showLabels, settings.showConfidence]);

  // For RTSP, hide canvas and show MJPEG image
  const isRTSP = inputSource?.type === 'rtsp';

  return (
    <div ref={containerRef} className="flex-1 bg-bg-secondary rounded-xl border border-border-color overflow-hidden relative flex items-center justify-center">
      {/* Video Element (hidden, used for capture) */}
      <video
        ref={videoRef}
        className={isRTSP ? 'hidden' : 'hidden'}
        autoPlay
        playsInline
        muted
      />

      {/* Canvas for video frame - hidden for RTSP since we use the image element */}
      <canvas
        ref={canvasRef}
        className={`max-w-full max-h-full object-contain ${isRTSP ? 'opacity-0' : ''}`}
      />

      {/* Detection Overlay Canvas */}
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 pointer-events-none"
      />

      {/* Placeholder when no video */}
      {!videoRef.current?.srcObject && !mjpegImgRef.current && (
        <div className="text-center text-text-secondary">
          <div className="text-6xl mb-4 opacity-50">📷</div>
          <p className="text-lg">Select an input source to start</p>
          <p className="text-sm mt-2">Webcam, Screen Share, or RTSP Stream</p>
        </div>
      )}
    </div>
  );
};
