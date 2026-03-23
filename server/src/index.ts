import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';
import { registerRoutes } from './routes/index.js';
import { WebSocketHandler } from './websocket/handler.js';
import { StreamManager } from './services/streamManager.js';
import { ModelManager } from './services/modelManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Create logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // Pretty printing only in development
  ...(process.env.NODE_ENV === 'development' ? {
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  } : {}),
});

// Initialize Fastify
const fastify = Fastify({
  logger: true,
  maxParamLength: 500,
});

// Register plugins
await fastify.register(cors, {
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
});

await fastify.register(websocket, {
  options: {
    maxPayload: 10485760, // 10MB
  },
});

await fastify.register(multipart, {
  limits: {
    fileSize: 524288000, // 500MB for model uploads
  },
});

// Serve static files (client build)
await fastify.register(staticFiles, {
  root: join(__dirname, '../../client/dist'),
  prefix: '/',
});

// Initialize managers
const modelManager = new ModelManager(logger);
const streamManager = new StreamManager(modelManager, logger);
const wsHandler = new WebSocketHandler(streamManager, logger);

// Register routes
await registerRoutes(fastify, modelManager, streamManager, logger);

// WebSocket route
fastify.register(async (fastify) => {
  fastify.get('/ws/detection', { websocket: true }, (connection, req) => {
    wsHandler.handleConnection(connection as any, req);
  });
});

// MJPEG stream endpoint for RTSP
fastify.get('/api/stream/mjpeg', async (request, reply) => {
  const { url } = request.query as { url: string };

  if (!url) {
    return reply.code(400).send({ error: 'RTSP URL is required' });
  }

  const { spawn } = await import('child_process');

  // FFmpeg command to read RTSP and output MJPEG with proper boundary markers
  const ffmpegArgs = [
    '-rtsp_transport', 'tcp',
    '-i', url,
    '-vf', 'scale=640:480',
    '-f', 'mjpeg',
    '-q:v', '5',
    'pipe:1'
  ];

  const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Set headers for MJPEG stream - use the raw response
  reply.raw.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=--mjpegframe',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // FFmpeg outputs individual JPEG frames, we wrap them in multipart format
  ffmpegProcess.stdout.on('data', (data: Buffer) => {
    reply.raw.write('--mjpegframe\r\n');
    reply.raw.write('Content-Type: image/jpeg\r\n');
    reply.raw.write(`Content-Length: ${data.length}\r\n`);
    reply.raw.write('\r\n');
    reply.raw.write(data);
    reply.raw.write('\r\n');
  });

  ffmpegProcess.stderr.on('data', (data: Buffer) => {
    request.log.debug({ ffmpeg: data.toString() }, 'FFmpeg stderr');
  });

  ffmpegProcess.on('error', (error) => {
    request.log.error({ error }, 'FFmpeg process error');
  });

  // Clean up on client disconnect
  request.raw.on('close', () => {
    ffmpegProcess.kill('SIGTERM');
  });
});

// Health check
fastify.get('/api/health', async () => ({
  status: 'ok',
  version: '1.0.0',
  timestamp: Date.now(),
}));

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  
  try {
    await streamManager.stopAll();
    await fastify.close();
    logger.info('Server closed');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
try {
  await fastify.listen({ port: Number(PORT), host: HOST });
  logger.info(`🚀 YOLO11 Server running at http://${HOST}:${PORT}`);
  logger.info(`📡 WebSocket endpoint: ws://${HOST}:${PORT}/ws/detection`);
} catch (error) {
  logger.error({ error }, 'Failed to start server');
  process.exit(1);
}
