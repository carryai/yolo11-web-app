interface Detection {
  bbox: [number, number, number, number];
  classId: number;
  className: string;
  confidence: number;
  color: string;
}

interface StreamConfig {
  confidenceThreshold: number;
  classes?: string[];
}

type StreamStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export class RTSPStreamService {
  private ws: WebSocket | null = null;
  private clientId: string | null = null;
  private streamId: string | null = null;
  private rtspUrl: string | null = null;
  private config: StreamConfig = {
    confidenceThreshold: 0.45,
  };
  private status: StreamStatus = 'disconnected';
  private statusListeners: Set<(status: StreamStatus) => void> = new Set();
  private frameListeners: Set<(frame: string, detections: Detection[]) => void> = new Set();
  private errorListeners: Set<(error: string) => void> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelay = 1000;

  connect(rtspUrl: string) {
    return new Promise<{ clientId: string; streamId: string }>((resolve, reject) => {
      try {
        this.status = 'connecting';
        this.rtspUrl = rtspUrl;
        this.notifyStatusChange();

        const wsUrl = this.getWebSocketUrl();
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;

          // Request to start the RTSP stream
          this.send({
            type: 'start_stream',
            payload: {
              rtspUrl,
            },
          });
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message, resolve, reject);
          } catch (error) {
            console.error('Failed to parse message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.status = 'error';
          this.notifyStatusChange();
          this.notifyError('WebSocket connection failed');
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onclose = () => {
          console.log('WebSocket disconnected');
          this.status = 'disconnected';
          this.notifyStatusChange();

          // Attempt reconnection if we were connected
          if (this.streamId && this.reconnectAttempts < this.maxReconnectAttempts && this.rtspUrl) {
            this.reconnectAttempts++;
            setTimeout(() => {
              console.log(`Attempting reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
              this.connect(this.rtspUrl).catch(() => {});
            }, this.reconnectDelay * this.reconnectAttempts);
          }
        };

        // Timeout for connection
        setTimeout(() => {
          if (this.status === 'connecting') {
            this.status = 'error';
            this.notifyStatusChange();
            reject(new Error('Connection timeout'));
          }
        }, 30000);
      } catch (error) {
        this.status = 'error';
        this.notifyStatusChange();
        reject(error);
      }
    });
  }

  private handleMessage(
    message: any,
    resolve?: (value: { clientId: string; streamId: string }) => void,
    reject?: (reason: Error) => void
  ) {
    switch (message.type) {
      case 'connected':
        this.clientId = message.payload.clientId;
        console.log('Connected with client ID:', this.clientId);
        break;

      case 'stream_status':
        if (message.payload.status === 'connected') {
          this.streamId = message.payload.streamId || null;
          this.status = 'connected';
          this.notifyStatusChange();
          console.log('Stream connected:', this.streamId);
          if (resolve) {
            resolve({
              clientId: this.clientId!,
              streamId: this.streamId!,
            });
          }
        } else if (message.payload.status === 'disconnected') {
          this.streamId = null;
          this.status = 'disconnected';
          this.notifyStatusChange();
        }
        break;

      case 'detection_result':
        if (message.payload.frame && message.payload.detections) {
          this.notifyFrame(message.payload.frame, message.payload.detections);
        }
        break;

      case 'error':
        this.status = 'error';
        this.notifyStatusChange();
        this.notifyError(message.payload.error);
        if (reject) {
          reject(new Error(message.payload.error));
        }
        break;

      case 'model_loaded':
        console.log('Model loaded:', message.payload.modelId);
        break;
    }
  }

  private getWebSocketUrl(): string {
    const host = window.location.hostname;
    const port = window.location.port || '3001';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${host}:${port}/ws/detection`;
  }

  disconnect() {
    if (this.ws) {
      this.send({
        type: 'stop_stream',
        payload: {},
      });
      this.ws.close();
      this.ws = null;
    }
    this.clientId = null;
    this.streamId = null;
    this.status = 'disconnected';
    this.notifyStatusChange();
  }

  updateConfig(config: Partial<StreamConfig>) {
    if (config.confidenceThreshold !== undefined) {
      this.config.confidenceThreshold = config.confidenceThreshold;
    }
    if (config.classes !== undefined) {
      this.config.classes = config.classes;
    }

    // Send config update to server
    this.send({
      type: 'config_update',
      payload: this.config,
    });
  }

  getStatus(): StreamStatus {
    return this.status;
  }

  onStatusChange(listener: (status: StreamStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onFrame(listener: (frame: string, detections: Detection[]) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onError(listener: (error: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  private notifyStatusChange() {
    this.statusListeners.forEach((listener) => listener(this.status));
  }

  private notifyFrame(frame: string, detections: Detection[]) {
    this.frameListeners.forEach((listener) => listener(frame, detections));
  }

  private notifyError(error: string) {
    this.errorListeners.forEach((listener) => listener(error));
  }

  private send(message: { type: string; payload: any }) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
}

export const rtspStream = new RTSPStreamService();
