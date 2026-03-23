import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from 'pino';
import { ModelManager } from './modelManager.js';
import { StreamInfo, Detection } from '../../../shared/types.js';

interface StreamSubscriber {
  clientId: string;
  callback: (frame: string, detections: Detection[]) => void;
}

interface HLSConfig {
  hls_time: number;
  hls_list_size: number;
  hls_flags: string;
}

export class RTSPStream {
  private ffmpegProcess: ChildProcess | null = null;
  private subscribers: Map<string, StreamSubscriber> = new Map();
  private frameBuffer: Buffer | null = null;
  private isRunning = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private fps = 0;
  private lastFrameTime = 0;
  private hlsSegments: Map<string, Buffer> = new Map();

  constructor(
    public streamId: string,
    public url: string,
    public name: string,
    private modelManager: ModelManager,
    private logger: Logger
  ) {}

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // FFmpeg command to read RTSP and output MJPEG frames to stdout
        const ffmpegArgs = [
          '-rtsp_transport', 'tcp',
          '-i', this.url,
          '-vf', 'fps=15,scale=640:480',
          '-f', 'image2pipe',
          '-vcodec', 'mjpeg',
          '-q:v', '2',
          '-'
        ];

        this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        this.ffmpegProcess.stdout?.on('data', (data: Buffer) => {
          this.handleFrame(data);
        });

        this.ffmpegProcess.stderr?.on('data', (data: Buffer) => {
          const output = data.toString();
          if (output.includes('Input #0')) {
            this.logger.info({ streamId: this.streamId }, 'RTSP stream connected');
            this.isRunning = true;
            this.reconnectAttempts = 0;
            resolve();
          }
          this.logger.debug({ streamId: this.streamId, output }, 'FFmpeg output');
        });

        this.ffmpegProcess.on('error', (error) => {
          this.logger.error({ streamId: this.streamId, error }, 'FFmpeg process error');
          this.isRunning = false;
          reject(error);
        });

        this.ffmpegProcess.on('close', (code) => {
          this.logger.info({ streamId: this.streamId, code }, 'FFmpeg process closed');
          this.isRunning = false;
          this.handleDisconnect();
        });

        // Timeout for connection
        setTimeout(() => {
          if (!this.isRunning) {
            reject(new Error('RTSP connection timeout'));
          }
        }, 10000);

      } catch (error: any) {
        reject(error);
      }
    });
  }

  private async handleFrame(frameData: Buffer) {
    if (this.subscribers.size === 0) return;

    this.frameBuffer = frameData;
    const now = Date.now();
    
    // Calculate FPS
    if (this.lastFrameTime) {
      const elapsed = now - this.lastFrameTime;
      this.fps = 1000 / elapsed;
    }
    this.lastFrameTime = now;

    // Run detection on frame
    try {
      const detections = await this.runDetection(frameData);
      
      // Convert frame to base64
      const base64Frame = frameData.toString('base64');

      // Send to all subscribers
      this.subscribers.forEach((subscriber) => {
        try {
          subscriber.callback(base64Frame, detections);
        } catch (error) {
          this.logger.error({ clientId: subscriber.clientId, error }, 'Subscriber callback error');
        }
      });
    } catch (error: any) {
      this.logger.error({ streamId: this.streamId, error }, 'Detection error');
    }
  }

  private async runDetection(frameData: Buffer): Promise<Detection[]> {
    const model = this.modelManager.getActiveModel();
    if (!model) return [];

    // Use sharp to process image and prepare for ONNX
    const sharp = await import('sharp');
    
    try {
      const { data, info } = await sharp.default(frameData)
        .resize(640, 640, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Run inference (simplified - in production, use ONNX Runtime Node)
      // For now, return mock detections
      return this.generateMockDetections();
    } catch (error: any) {
      this.logger.error({ error }, 'Image processing error');
      return [];
    }
  }

  private generateMockDetections(): Detection[] {
    // Placeholder - will be replaced with actual ONNX inference
    return [];
  }

  private handleDisconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.logger.info(
        { streamId: this.streamId, attempt: this.reconnectAttempts },
        'Attempting to reconnect...'
      );
      
      setTimeout(() => {
        this.start().catch((error) => {
          this.logger.error({ error }, 'Reconnect failed');
        });
      }, 5000 * this.reconnectAttempts);
    } else {
      this.logger.error({ streamId: this.streamId }, 'Max reconnect attempts reached');
      this.notifySubscribers('error', 'Stream disconnected');
    }
  }

  private notifySubscribers(type: string, message: string) {
    this.subscribers.forEach((subscriber) => {
      subscriber.callback('', []);
    });
  }

  stop(): void {
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill('SIGTERM');
      this.ffmpegProcess = null;
    }
    this.isRunning = false;
    this.subscribers.clear();
  }

  subscribe(clientId: string, callback: (frame: string, detections: Detection[]) => void): void {
    this.subscribers.set(clientId, { clientId, callback });
    this.logger.debug({ streamId: this.streamId, clientId }, 'Client subscribed');
  }

  unsubscribe(clientId: string): void {
    this.subscribers.delete(clientId);
    this.logger.debug({ streamId: this.streamId, clientId }, 'Client unsubscribed');
  }

  getStatus(): StreamInfo {
    return {
      streamId: this.streamId,
      url: this.url,
      name: this.name,
      status: this.isRunning ? 'connected' : 'disconnected',
      fps: Math.round(this.fps),
      viewers: this.subscribers.size,
    };
  }

  async getHLSPlaylist(): Promise<string> {
    return `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:EVENT
#EXTINF:2.0,
segment_0.m4s
#EXT-X-ENDLIST`;
  }

  async getSegment(segmentId: string): Promise<Buffer | null> {
    return this.hlsSegments.get(segmentId) || null;
  }
}

export class StreamManager {
  private streams: Map<string, RTSPStream> = new Map();
  private modelManager: ModelManager;
  private logger: Logger;

  constructor(modelManager: ModelManager, logger: Logger) {
    this.modelManager = modelManager;
    this.logger = logger;
  }

  async createStream(url: string, name: string): Promise<StreamInfo> {
    const streamId = uuidv4();
    const stream = new RTSPStream(streamId, url, name, this.modelManager, this.logger);
    
    await stream.start();
    this.streams.set(streamId, stream);
    
    return stream.getStatus();
  }

  getStream(streamId: string): RTSPStream | undefined {
    return this.streams.get(streamId);
  }

  listStreams(): StreamInfo[] {
    return Array.from(this.streams.values()).map((s) => s.getStatus());
  }

  async stopStream(streamId: string): Promise<void> {
    const stream = this.streams.get(streamId);
    if (stream) {
      stream.stop();
      this.streams.delete(streamId);
    }
  }

  async stopAll(): Promise<void> {
    const promises = Array.from(this.streams.keys()).map((id) => this.stopStream(id));
    await Promise.all(promises);
  }

  subscribe(
    streamId: string,
    clientId: string,
    callback: (frame: string, detections: Detection[]) => void
  ): void {
    const stream = this.streams.get(streamId);
    if (stream) {
      stream.subscribe(clientId, callback);
    }
  }

  unsubscribe(streamId: string, clientId: string): void {
    const stream = this.streams.get(streamId);
    if (stream) {
      stream.unsubscribe(clientId);
    }
  }

  switchModel(streamId: string, modelId: string): void {
    this.modelManager.setActiveModel(modelId);
    this.logger.info({ streamId, modelId }, 'Model switched for stream');
  }

  getStreamStats(streamId: string): { fps: number } | null {
    const stream = this.streams.get(streamId);
    if (stream) {
      const status = stream.getStatus();
      return { fps: status.fps };
    }
    return null;
  }
}
