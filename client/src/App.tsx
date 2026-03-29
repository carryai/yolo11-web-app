import { useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header/Header';
import { VideoCanvas } from './components/VideoCanvas/VideoCanvas';
import { ControlBar } from './components/ControlBar/ControlBar';
import { SettingsPanel } from './components/SettingsPanel/SettingsPanel';
import { ModelLibrary } from './components/ModelLibrary/ModelLibrary';
import { useAppStore } from './store/useAppStore';
import { videoInput } from './services/videoInput';
import { onnxInference } from './services/onnxInference';
import { getModel, DEFAULT_MODELS } from './services/modelStorage';
import { mjpegPlayer } from './services/mjpegPlayer';
import { DetectionLogEntry, InputSourceType } from '../../shared/types';

function App() {
  const {
    inputSource,
    setInputSource,
    currentModel,
    setCurrentModel,
    isDetecting,
    isPaused,
    setIsDetecting,
    setIsPaused,
    setCurrentDetections,
    updateStats,
    addToLog,
    showSettings,
    showModelLibrary,
    setShowSettings,
    setShowModelLibrary,
    setError,
    settings,
  } = useAppStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const settingsRef = useRef(settings);
  const rtspUrlRef = useRef<string | null>(null);

  // Keep settings ref in sync with store
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Load default model on mount
  useEffect(() => {
    loadDefaultModel();
  }, []);

  const loadDefaultModel = async () => {
    try {
      const defaultModel = DEFAULT_MODELS[0];

      // Try to load from IndexedDB first
      let modelData = await getModel(defaultModel.id);

      if (modelData) {
        // Load from IndexedDB
        await onnxInference.loadModel(
          modelData.blob,
          modelData.metadata.inputShape,
          modelData.metadata.classes,
          modelData.metadata.keypoints,
          modelData.metadata.outputShape
        );
        setCurrentModel(modelData.metadata);
      } else {
        // Fetch model from public folder as ArrayBuffer
        const response = await fetch('/models/yolo11n.onnx');
        if (response.ok) {
          // Check if it's actually a binary file and not an HTML error page
          const content = await response.arrayBuffer();

          // Check if it's an HTML error page (common with GitHub raw links)
          const decoded = new TextDecoder().decode(content.slice(0, 100));
          const isHTML = decoded.includes('<!DOCTYPE') || decoded.includes('<html');

          if (isHTML) {
            throw new Error('Model file is an HTML error page. Please ensure you have a proper ONNX model file.');
          }

          // Pass the ArrayBuffer directly to avoid MIME type issues
          await onnxInference.loadModel(
            new Blob([content]),
            defaultModel.inputShape,
            defaultModel.classes,
            defaultModel.keypoints,
            defaultModel.outputShape
          );
          setCurrentModel(defaultModel);
        } else {
          setError('Default model not found. Please upload a YOLO11 ONNX model or check the README.md for instructions on obtaining one.');
        }
      }
    } catch (error) {
      console.error('Failed to load default model:', error);
      setError('Failed to load model. ' + (error instanceof Error ? error.message : 'Please upload a YOLO11 ONNX model or check the README.md for instructions on obtaining one.'));
    }
  };

  const handleStart = useCallback(async (source: InputSourceType) => {
    try {
      setError(null);

      // Cancel any existing animation frame before starting
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }

      if (source === 'webcam') {
        const stream = await videoInput.startWebcam();
        setInputSource({ type: 'webcam', stream });

        if (videoRef.current) {
          videoInput.setupVideoElement(videoRef.current, stream);
        }
      } else if (source === 'screen') {
        const stream = await videoInput.startScreenShare();
        setInputSource({ type: 'screen', stream });

        if (videoRef.current) {
          videoInput.setupVideoElement(videoRef.current, stream);
        }
      } else if (source === 'rtsp') {
        // RTSP via MJPEG streaming
        const rtspUrl = rtspUrlRef.current;
        if (!rtspUrl) {
          setError('RTSP URL is required. Please enter the RTSP stream URL.');
          return;
        }

        try {
          // Connect to MJPEG stream
          const serverUrl = `http://${window.location.hostname}:3001`;
          await mjpegPlayer.connect(rtspUrl, serverUrl);

          setInputSource({ type: 'rtsp', url: rtspUrl });
        } catch (error) {
          console.error('Failed to connect RTSP stream:', error);
          throw new Error('Failed to connect to RTSP stream: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
      }

      setIsDetecting(true);
      setIsPaused(false);
    } catch (error) {
      console.error('Failed to start input:', error);
      setError(error instanceof Error ? error.message : 'Failed to start input');
    }
  }, [setInputSource, setIsDetecting, setIsPaused, setError]);

  const handleStop = useCallback(() => {
    // Cancel any pending animation frame first
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }

    // Disconnect MJPEG stream if active
    mjpegPlayer.disconnect();

    videoInput.stop();
    setInputSource(null);
    setIsDetecting(false);
    setIsPaused(false);
    setCurrentDetections([]);
  }, [setInputSource, setIsDetecting, setIsPaused, setCurrentDetections]);

  const handleImageUpload = useCallback(async (file: File) => {
    try {
      setError(null);

      // Cancel any existing animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }

      const img = await videoInput.startImage(file);
      setInputSource({ type: 'image' });

      // Check if model is loaded
      if (!onnxInference.isLoaded()) {
        setError('Model not loaded yet. Please wait for the model to load or upload a model first.');
        return;
      }

      // Draw image to canvas and run inference
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          // Run inference
          const detections = await onnxInference.runInference(
            imageData,
            undefined,
            undefined,
            settingsRef.current.confidenceThreshold,
            settingsRef.current.iouThreshold
          );

          setCurrentDetections(detections);
          updateStats({
            objectCount: detections.length,
            inferenceTime: 0,
            fps: 0,
          });

          // Add to log
          const logEntry: DetectionLogEntry = {
            timestamp: Date.now(),
            detections,
            sourceType: 'image',
            modelName: currentModel?.name || 'Unknown',
          };
          addToLog(logEntry);
        }
      }
    } catch (error) {
      console.error('Failed to process image:', error);
      setError('Failed to process image: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }, [setInputSource, setCurrentDetections, updateStats, addToLog, currentModel, setError]);

  const handleLoadModel = useCallback(async (modelId: string) => {
    try {
      setError(null);
      let modelData = await getModel(modelId);

      if (modelData) {
        // Load from IndexedDB
        await onnxInference.loadModel(
          modelData.blob,
          modelData.metadata.inputShape,
          modelData.metadata.classes,
          modelData.metadata.keypoints,
          modelData.metadata.outputShape
        );
        setCurrentModel(modelData.metadata);
      } else {
        // Try to load from public models folder (for discovered models)
        const response = await fetch(`/models/${modelId}.onnx`);
        if (response.ok) {
          const content = await response.arrayBuffer();

          // Check if it's an HTML error page
          const decoded = new TextDecoder().decode(content.slice(0, 100));
          const isHTML = decoded.includes('<!DOCTYPE') || decoded.includes('<html');

          if (isHTML) {
            throw new Error('Model file is an HTML error page');
          }

          // Find model config from DEFAULT_MODELS or KNOWN_MODELS
          const knownModel = DEFAULT_MODELS.find(m => m.id === modelId);
          if (knownModel) {
            await onnxInference.loadModel(
              new Blob([content]),
              knownModel.inputShape,
              knownModel.classes,
              knownModel.keypoints,
              knownModel.outputShape
            );
            setCurrentModel(knownModel);
          } else {
            throw new Error(`Model ${modelId} not found in IndexedDB or public models`);
          }
        } else {
          setError(`Model ${modelId} not found`);
        }
      }
    } catch (error) {
      console.error('Failed to load model:', error);
      setError('Failed to load model: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }, [setCurrentModel, setError]);

  // Detection loop
  useEffect(() => {
    // Clear any existing animation frame when starting a new loop
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }

    // Reset timing refs when starting fresh
    if (isDetecting && !isPaused) {
      lastTimeRef.current = 0;
      frameCountRef.current = 0;
    }

    if (!isDetecting || isPaused || !onnxInference.isLoaded()) {
      return;
    }

    let cancelled = false;

    const detect = async (timestamp: number) => {
      // Check if cancelled before processing
      if (cancelled) return;

      // Calculate FPS
      if (lastTimeRef.current) {
        frameCountRef.current++;
        const elapsed = timestamp - lastTimeRef.current;

        if (elapsed >= 1000) {
          const fps = frameCountRef.current * 1000 / elapsed;
          updateStats({ fps });
          frameCountRef.current = 0;
          lastTimeRef.current = timestamp;
        }
      } else {
        lastTimeRef.current = timestamp;
      }

      const canvas = canvasRef.current;
      const video = videoRef.current;

      // Handle RTSP/MJPEG stream
      if (inputSource?.type === 'rtsp') {
        const mjpegImg = mjpegPlayer.getImageElement();
        if (mjpegImg && mjpegImg.complete && canvas) {
          const imgWidth = mjpegImg.naturalWidth;
          const imgHeight = mjpegImg.naturalHeight;

          // Skip if image dimensions are invalid
          if (imgWidth === 0 || imgHeight === 0) {
            if (!cancelled) {
              animationFrameRef.current = requestAnimationFrame(detect);
            }
            return;
          }

          // Update canvas dimensions
          if (canvas.width !== imgWidth || canvas.height !== imgHeight) {
            canvas.width = imgWidth;
            canvas.height = imgHeight;
          }

          const ctx = canvas.getContext('2d');
          if (ctx) {
            // Draw current frame from MJPEG image
            ctx.drawImage(mjpegImg, 0, 0);

            // Run inference
            try {
              const startTime = performance.now();
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const detections = await onnxInference.runInference(
                imageData,
                undefined,
                undefined,
                settingsRef.current.confidenceThreshold,
                settingsRef.current.iouThreshold
              );
              const inferenceTime = performance.now() - startTime;

              if (!cancelled) {
                setCurrentDetections(detections);
                updateStats({
                  inferenceTime,
                  objectCount: detections.length,
                  lastDetectionTime: Date.now(),
                });

                // Add to log (throttled - every 1 second)
                if (timestamp % 1000 < 50) {
                  const logEntry: DetectionLogEntry = {
                    timestamp: Date.now(),
                    detections,
                    sourceType: 'rtsp',
                    modelName: currentModel?.name || 'Unknown',
                  };
                  addToLog(logEntry);
                }
              }
            } catch (error) {
              console.error('Inference error:', error);
            }
          }
        }
      }
      // Handle webcam/screen
      else if (video && canvas && video.readyState === 4) {
        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;

        // Skip if video dimensions are invalid
        if (videoWidth === 0 || videoHeight === 0) {
          if (!cancelled) {
            animationFrameRef.current = requestAnimationFrame(detect);
          }
          return;
        }

        // Update canvas dimensions if they don't match video
        if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
          canvas.width = videoWidth;
          canvas.height = videoHeight;
        }

        const ctx = canvas.getContext('2d');

        if (ctx) {
          ctx.drawImage(video, 0, 0);

          // Run inference
          try {
            const startTime = performance.now();
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const detections = await onnxInference.runInference(
              imageData,
              undefined,
              undefined,
              settingsRef.current.confidenceThreshold,
              settingsRef.current.iouThreshold
            );
            const inferenceTime = performance.now() - startTime;

            if (!cancelled) {
              setCurrentDetections(detections);
              updateStats({
                inferenceTime,
                objectCount: detections.length,
                lastDetectionTime: Date.now(),
              });

              // Add to log (throttled - every 1 second)
              if (timestamp % 1000 < 50) {
                const logEntry: DetectionLogEntry = {
                  timestamp: Date.now(),
                  detections,
                  sourceType: inputSource?.type || 'webcam',
                  modelName: currentModel?.name || 'Unknown',
                };
                addToLog(logEntry);
              }
            }
          } catch (error) {
            // Log inference errors but continue the loop
            console.error('Inference error:', error);
          }
        }
      }

      if (!cancelled) {
        animationFrameRef.current = requestAnimationFrame(detect);
      }
    };

    animationFrameRef.current = requestAnimationFrame(detect);

    return () => {
      cancelled = true;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
    };
  }, [isDetecting, isPaused, inputSource?.type]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      videoInput.stop();
      onnxInference.release();
    };
  }, []);

  const stats = useAppStore((state) => state.stats);

  return (
    <div className="min-h-screen bg-bg-primary flex flex-col">
      <Header
        stats={stats}
        onOpenModelLibrary={() => setShowModelLibrary(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <main className="flex-1 p-4 flex flex-col gap-4 overflow-hidden">
        <VideoCanvas
          detections={useAppStore((state) => state.currentDetections)}
          videoRef={videoRef}
          canvasRef={canvasRef}
        />
        
        <ControlBar
          onStart={handleStart}
          onStop={handleStop}
          onImageUpload={handleImageUpload}
          onRTSPUrlChange={(url) => { rtspUrlRef.current = url; }}
        />
      </main>

      {/* Modals */}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showModelLibrary && (
        <ModelLibrary
          onClose={() => setShowModelLibrary(false)}
          onLoadModel={handleLoadModel}
        />
      )}
    </div>
  );
}

export default App;
