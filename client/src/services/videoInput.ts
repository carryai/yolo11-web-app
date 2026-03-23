export class VideoInputService {
  private currentStream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;

  async startWebcam(deviceId?: string): Promise<MediaStream> {
    try {
      // Stop existing stream
      await this.stop();

      const constraints: MediaStreamConstraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.currentStream = stream;
      
      return stream;
    } catch (error) {
      console.error('Failed to access webcam:', error);
      throw new Error(`Webcam access denied: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async startScreenShare(): Promise<MediaStream> {
    try {
      // Stop existing stream
      await this.stop();

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      // Handle stream end (user stops sharing)
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        this.stop();
      });

      this.currentStream = stream;
      return stream;
    } catch (error) {
      console.error('Screen share failed:', error);
      throw new Error(`Screen share failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async startImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
  }

  setupVideoElement(videoElement: HTMLVideoElement, stream: MediaStream): void {
    this.videoElement = videoElement;
    videoElement.srcObject = stream;
    videoElement.play();
  }

  async stop(): Promise<void> {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(track => track.stop());
      this.currentStream = null;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }
  }

  async listCameras(): Promise<MediaDeviceInfo[]> {
    try {
      // Request permission first
      await navigator.mediaDevices.getUserMedia({ video: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(device => device.kind === 'videoinput');
    } catch (error) {
      console.error('Failed to list cameras:', error);
      return [];
    }
  }

  getCurrentStream(): MediaStream | null {
    return this.currentStream;
  }

  isStreamActive(): boolean {
    return this.currentStream !== null && this.currentStream.active;
  }
}

export const videoInput = new VideoInputService();
