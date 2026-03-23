import { WebSocket } from 'ws';
import { StreamManager } from '../services/streamManager.js';
import { Logger } from 'pino';
import { Detection } from '../../../shared/types.js';

interface WSClient {
  socket: WebSocket;
  streamId?: string;
  isAlive: boolean;
  config: {
    confidenceThreshold: number;
    classes?: string[];
  };
}

export class WebSocketHandler {
  private clients: Map<string, WSClient> = new Map();
  private pingInterval: NodeJS.Timeout;

  constructor(
    private streamManager: StreamManager,
    private logger: Logger
  ) {
    // Heartbeat to detect disconnected clients
    this.pingInterval = setInterval(() => {
      this.clients.forEach((client, id) => {
        if (!client.isAlive) {
          this.logger.info({ clientId: id }, 'Client disconnected (heartbeat timeout)');
          client.socket.terminate();
          this.clients.delete(id);
          return;
        }
        client.isAlive = false;
        client.socket.ping();
      });
    }, 30000);
  }

  handleConnection(socket: WebSocket, req: any) {
    const clientId = this.generateId();
    const client: WSClient = {
      socket,
      isAlive: true,
      config: {
        confidenceThreshold: 0.45,
      },
    };

    this.clients.set(clientId, client);
    this.logger.info({ clientId, ip: req.socket.remoteAddress }, 'WebSocket client connected');

    // Send connection confirmation
    this.send(clientId, {
      type: 'connected',
      payload: { clientId, timestamp: Date.now() },
    });

    // Handle messages
    socket.on('message', (data) => this.handleMessage(clientId, data.toString()));
    
    // Handle pong (heartbeat response)
    socket.on('pong', () => {
      client.isAlive = true;
    });

    // Handle close
    socket.on('close', () => {
      this.logger.info({ clientId }, 'WebSocket client disconnected');
      if (client.streamId) {
        this.streamManager.unsubscribe(client.streamId, clientId);
      }
      this.clients.delete(clientId);
    });

    // Handle error
    socket.on('error', (error) => {
      this.logger.error({ clientId, error }, 'WebSocket error');
    });
  }

  private handleMessage(clientId: string, message: string) {
    try {
      const msg = JSON.parse(message);
      const client = this.clients.get(clientId);
      
      if (!client) {
        this.logger.warn({ clientId }, 'Message from unknown client');
        return;
      }

      switch (msg.type) {
        case 'start_stream':
          this.handleStartStream(clientId, client, msg.payload);
          break;
        
        case 'stop_stream':
          this.handleStopStream(clientId, client);
          break;
        
        case 'config_update':
          this.handleConfigUpdate(clientId, client, msg.payload);
          break;
        
        case 'model_switch':
          this.handleModelSwitch(clientId, client, msg.payload);
          break;
        
        default:
          this.logger.warn({ clientId, type: msg.type }, 'Unknown message type');
      }
    } catch (error: any) {
      this.logger.error({ clientId, error }, 'Failed to parse message');
      this.send(clientId, {
        type: 'error',
        payload: { error: 'Invalid message format' },
      });
    }
  }

  private handleStartStream(clientId: string, client: WSClient, payload: any) {
    const { streamId, rtspUrl } = payload;

    if (rtspUrl) {
      // Create new RTSP stream
      this.streamManager
        .createStream(rtspUrl, `Stream-${clientId}`)
        .then((stream) => {
          client.streamId = stream.streamId;
          this.streamManager.subscribe(stream.streamId, clientId, (frame, detections) => {
            this.sendDetectionResult(clientId, frame, detections);
          });
          
          this.send(clientId, {
            type: 'stream_status',
            payload: {
              streamId: stream.streamId,
              status: 'connected',
              timestamp: Date.now(),
            },
          });
        })
        .catch((error: any) => {
          this.send(clientId, {
            type: 'error',
            payload: { error: error.message },
          });
        });
    } else if (streamId) {
      // Subscribe to existing stream
      client.streamId = streamId;
      this.streamManager.subscribe(streamId, clientId, (frame, detections) => {
        this.sendDetectionResult(clientId, frame, detections);
      });
      
      this.send(clientId, {
        type: 'stream_status',
        payload: {
          streamId,
          status: 'connected',
          timestamp: Date.now(),
        },
      });
    }
  }

  private handleStopStream(clientId: string, client: WSClient) {
    if (client.streamId) {
      this.streamManager.unsubscribe(client.streamId, clientId);
      client.streamId = undefined;
      
      this.send(clientId, {
        type: 'stream_status',
        payload: {
          status: 'disconnected',
          timestamp: Date.now(),
        },
      });
    }
  }

  private handleConfigUpdate(clientId: string, client: WSClient, payload: any) {
    if (payload.confidenceThreshold !== undefined) {
      client.config.confidenceThreshold = payload.confidenceThreshold;
    }
    if (payload.classes) {
      client.config.classes = payload.classes;
    }

    this.logger.debug({ clientId, config: client.config }, 'Client config updated');
  }

  private handleModelSwitch(clientId: string, client: WSClient, payload: any) {
    const { modelId } = payload;
    
    if (client.streamId) {
      this.streamManager.switchModel(client.streamId, modelId);
      
      this.send(clientId, {
        type: 'model_loaded',
        payload: {
          modelId,
          timestamp: Date.now(),
        },
      });
    }
  }

  private sendDetectionResult(clientId: string, frame: string, detections: Detection[]) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Filter detections by confidence and class
    const filteredDetections = detections.filter((d) => {
      if (d.confidence < client.config.confidenceThreshold) return false;
      if (client.config.classes && !client.config.classes.includes(d.className)) return false;
      return true;
    });

    this.send(clientId, {
      type: 'detection_result',
      payload: {
        streamId: client.streamId,
        timestamp: Date.now(),
        frame,
        detections: filteredDetections,
        fps: this.streamManager.getStreamStats(client.streamId!)?.fps || 0,
      },
    });
  }

  send(clientId: string, message: { type: string; payload: any }) {
    const client = this.clients.get(clientId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) return;

    try {
      client.socket.send(JSON.stringify(message));
    } catch (error: any) {
      this.logger.error({ clientId, error }, 'Failed to send message');
    }
  }

  broadcast(message: { type: string; payload: any }, excludeId?: string) {
    this.clients.forEach((client, id) => {
      if (id !== excludeId) {
        this.send(id, message);
      }
    });
  }

  private generateId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  cleanup() {
    clearInterval(this.pingInterval);
    this.clients.forEach((client) => {
      client.socket.close();
    });
    this.clients.clear();
  }
}
