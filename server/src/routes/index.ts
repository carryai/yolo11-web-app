import { FastifyInstance } from 'fastify';
import { ModelManager } from '../services/modelManager.js';
import { StreamManager } from '../services/streamManager.js';
import { Logger } from 'pino';

export async function registerRoutes(
  fastify: FastifyInstance,
  modelManager: ModelManager,
  streamManager: StreamManager,
  logger: Logger
) {
  // Models API
  fastify.get('/api/models', async () => {
    const models = await modelManager.listModels();
    return { success: true, data: models };
  });

  fastify.get('/api/models/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const model = await modelManager.getModelInfo(id);
    
    if (!model) {
      return reply.code(404).send({ success: false, error: 'Model not found' });
    }
    
    return { success: true, data: model };
  });

  fastify.post('/api/models/upload', async (request, reply) => {
    try {
      const data = await request.file();
      
      if (!data || !data.filename.endsWith('.onnx')) {
        return reply.code(400).send({ 
          success: false, 
          error: 'Please upload a valid .onnx file' 
        });
      }

      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      const modelInfo = await modelManager.uploadModel(
        data.filename.replace('.onnx', ''),
        buffer,
        data.mimetype
      );

      logger.info({ modelId: modelInfo.id }, 'Model uploaded');
      
      return { success: true, data: modelInfo };
    } catch (error: any) {
      logger.error({ error }, 'Model upload failed');
      return reply.code(500).send({ 
        success: false, 
        error: error.message || 'Upload failed' 
      });
    }
  });

  fastify.delete('/api/models/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    try {
      await modelManager.deleteModel(id);
      logger.info({ modelId: id }, 'Model deleted');
      return { success: true };
    } catch (error: any) {
      logger.error({ error }, 'Model deletion failed');
      return reply.code(500).send({ 
        success: false, 
        error: error.message || 'Deletion failed' 
      });
    }
  });

  fastify.put('/api/models/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as Partial<{ name: string; isDefault: boolean }>;
    
    try {
      const model = await modelManager.updateModel(id, updates);
      return { success: true, data: model };
    } catch (error: any) {
      return reply.code(500).send({ 
        success: false, 
        error: error.message || 'Update failed' 
      });
    }
  });

  // Streams API
  fastify.post('/api/streams', async (request, reply) => {
    const { url, name } = request.body as { url: string; name: string };
    
    if (!url) {
      return reply.code(400).send({ success: false, error: 'RTSP URL is required' });
    }

    try {
      const stream = await streamManager.createStream(url, name);
      logger.info({ streamId: stream.streamId, url }, 'Stream created');
      return { success: true, data: stream };
    } catch (error: any) {
      logger.error({ error }, 'Stream creation failed');
      return reply.code(500).send({ 
        success: false, 
        error: error.message || 'Failed to create stream' 
      });
    }
  });

  fastify.get('/api/streams', async () => {
    const streams = streamManager.listStreams();
    return { success: true, data: streams };
  });

  fastify.get('/api/streams/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const stream = streamManager.getStream(id);
    
    if (!stream) {
      return reply.code(404).send({ success: false, error: 'Stream not found' });
    }
    
    return { success: true, data: stream };
  });

  fastify.delete('/api/streams/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    try {
      await streamManager.stopStream(id);
      logger.info({ streamId: id }, 'Stream stopped');
      return { success: true };
    } catch (error: any) {
      logger.error({ error }, 'Stream stop failed');
      return reply.code(500).send({ 
        success: false, 
        error: error.message || 'Failed to stop stream' 
      });
    }
  });

  // HLS stream endpoint
  fastify.get('/api/streams/:id/hls.m3u8', async (request, reply) => {
    const { id } = request.params as { id: string };
    const stream = streamManager.getStream(id);
    
    if (!stream) {
      return reply.code(404).send('Stream not found');
    }

    reply.type('application/vnd.apple.mpegurl');
    return stream.getHLSPlaylist();
  });

  fastify.get('/api/streams/:id/segment/:segment.m4s', async (request, reply) => {
    const { id, segment } = request.params as { id: string; segment: string };
    const stream = streamManager.getStream(id);

    if (!stream) {
      return reply.code(404).send('Stream not found');
    }

    const segmentData = await stream.getSegment(segment);
    if (!segmentData) {
      return reply.code(404).send('Segment not found');
    }

    reply.type('video/iso.segment');
    return segmentData;
  });

  // WebRTC signaling endpoint for RTSP streams
  fastify.post('/api/webrtc/offer', async (request, reply) => {
    const { streamUrl } = request.body as { streamUrl: string };

    if (!streamUrl) {
      return reply.code(400).send({ success: false, error: 'Stream URL is required' });
    }

    // Return the MediaMTX WebRTC URL for direct connection
    // MediaMTX should be running on port 8890
    const mediaMTXHost = process.env.MEDIAMTX_HOST || 'localhost';
    const mediaMTXWebTCPPort = process.env.MEDIAMTX_WEBRTC_PORT || '8890';

    // Extract stream name from RTSP URL
    const urlParts = streamUrl.split('/');
    const streamName = urlParts[urlParts.length - 1] || 'stream';

    reply.send({
      success: true,
      webrtcUrl: `http://${mediaMTXHost}:${mediaMTXWebTCPPort}/whip?resource=${streamName}`,
    });
  });
}
