export class MJPEGPlayer {
  private isConnected = false;
  private streamUrl: string | null = null;
  private imageElement: HTMLImageElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private onErrorCallback?: (error: string) => void;

  async connect(rtspUrl: string, serverUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.streamUrl = `${serverUrl}/api/stream/mjpeg?url=${encodeURIComponent(rtspUrl)}`;

        // Create image element for MJPEG stream
        const img = document.createElement('img');

        let loadTimeout: NodeJS.Timeout;

        img.onload = () => {
          if (!this.isConnected) {
            this.isConnected = true;
            clearTimeout(loadTimeout);
            resolve();
          }
        };

        img.onerror = () => {
          if (this.isConnected) {
            this.isConnected = false;
            this.onErrorCallback?.('Stream disconnected');
          } else {
            clearTimeout(loadTimeout);
            reject(new Error('Failed to connect to MJPEG stream'));
          }
        };

        // Start loading MJPEG stream
        img.src = this.streamUrl;
        img.style.maxWidth = '100%';
        img.style.maxHeight = '100%';
        img.style.objectFit = 'contain';
        img.style.display = 'block';

        this.imageElement = img;

        // Timeout for connection
        loadTimeout = setTimeout(() => {
          if (!this.isConnected) {
            reject(new Error('Connection timeout'));
          }
        }, 10000);
      } catch (error) {
        reject(error);
      }
    });
  }

  getImageElement(): HTMLImageElement | null {
    return this.imageElement;
  }

  // Get canvas with current frame for detection
  getCanvas(): HTMLCanvasElement | null {
    if (!this.imageElement || !this.imageElement.complete) return null;

    // Create canvas if it doesn't exist
    if (!this.canvasElement) {
      this.canvasElement = document.createElement('canvas');
    }

    const canvas = this.canvasElement;
    const img = this.imageElement;

    canvas.width = img.naturalWidth || 640;
    canvas.height = img.naturalHeight || 480;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0);
    }

    return canvas;
  }

  // Get ImageData for ONNX inference
  getImageData(): ImageData | null {
    const canvas = this.getCanvas();
    if (!canvas) return null;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  getStreamUrl(): string | null {
    return this.streamUrl;
  }

  disconnect() {
    if (this.imageElement) {
      this.imageElement.src = '';
      this.imageElement.onload = null;
      this.imageElement.onerror = null;
      if (this.imageElement.parentNode) {
        this.imageElement.parentNode.removeChild(this.imageElement);
      }
      this.imageElement = null;
    }

    if (this.canvasElement) {
      this.canvasElement = null;
    }

    this.isConnected = false;
  }

  isReady(): boolean {
    return this.isConnected && this.imageElement !== null;
  }

  isConnectedState(): boolean {
    return this.isConnected;
  }

  // Attach image element to a container for display
  attachTo(container: HTMLElement) {
    if (this.imageElement && !container.contains(this.imageElement)) {
      // Clear container first
      container.innerHTML = '';
      container.appendChild(this.imageElement);
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'center';
      container.style.backgroundColor = '#000';
    }
  }

  onError(callback: (error: string) => void) {
    this.onErrorCallback = callback;
    return () => {
      this.onErrorCallback = undefined;
    };
  }
}

export const mjpegPlayer = new MJPEGPlayer();
