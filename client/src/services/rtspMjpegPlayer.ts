export class RTSPMJPEGPlayer {
  private videoElement: HTMLVideoElement | null = null;
  private streamUrl: string | null = null;
  private isConnected = false;
  private abortController: AbortController | null = null;

  async connect(rtspUrl: string, serverUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.streamUrl = `${serverUrl}/api/stream/mjpeg?url=${encodeURIComponent(rtspUrl)}`;

        // For MJPEG, we can use an Image element or fetch the stream
        // Using fetch with ReadableStream for better control
        this.abortController = new AbortController();

        fetch(this.streamUrl, {
          signal: this.abortController.signal,
          headers: {
            'Accept': 'multipart/x-mixed-replace',
          },
        })
          .then((response) => {
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            if (!response.body) {
              throw new Error('ReadableStream not supported');
            }

            this.isConnected = true;
            resolve();
            this.readStream(response.body!);
          })
          .catch((error) => {
            if (error.name === 'AbortError') {
              // Expected - stream was aborted
              return;
            }
            this.isConnected = false;
            reject(error);
          });
      } catch (error) {
        this.isConnected = false;
        reject(error);
      }
    });
  }

  private async readStream(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    let buffer = new Uint8Array(0);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Append new data to buffer
        const newBuffer = new Uint8Array(buffer.length + value.length);
        newBuffer.set(buffer);
        newBuffer.set(value, buffer.length);
        buffer = newBuffer;

        // Process complete JPEG frames
        this.processFrames(buffer);
      }
    } catch (error) {
      console.error('Error reading stream:', error);
    }
  }

  private processFrames(buffer: Uint8Array): Uint8Array {
    // Find JPEG frame boundaries (FF D8 ... FF D9)
    let pos = 0;
    while (pos < buffer.length - 1) {
      if (buffer[pos] === 0xff && buffer[pos + 1] === 0xd8) {
        // Start of JPEG
        let endPos = pos + 2;
        while (endPos < buffer.length - 1) {
          if (buffer[endPos] === 0xff && buffer[endPos + 1] === 0xd9) {
            // End of JPEG found
            const frame = buffer.slice(pos, endPos + 2);
            this.displayFrame(frame);
            pos = endPos + 2;
            break;
          }
          endPos++;
        }
        if (endPos >= buffer.length - 1) {
          // Incomplete frame, keep in buffer
          break;
        }
      } else {
        pos++;
      }
    }

    // Return remaining buffer
    return buffer.slice(pos);
  }

  private displayFrame(jpegData: Uint8Array) {
    if (!this.videoElement) return;

    const blob = new Blob([jpegData.buffer.slice(jpegData.byteOffset, jpegData.byteOffset + jpegData.byteLength) as ArrayBuffer], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      // Draw to canvas via video element
      if (this.videoElement) {
        // The video element is used to display the canvas
        // We'll draw the image to a canvas that's synced with the video element
        const canvas = this.videoElement.nextElementSibling as HTMLCanvasElement;
        if (canvas && canvas.getContext) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
          }
        }
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  setVideoElement(element: HTMLVideoElement) {
    this.videoElement = element;
  }

  disconnect() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isConnected = false;
  }

  isReady(): boolean {
    return this.isConnected;
  }
}

// Simpler MJPEG player using Image element
export class SimpleMJPEGPlayer {
  private imgElement: HTMLImageElement | null = null;
  private isConnected = false;
  private streamUrl: string | null = null;

  connect(rtspUrl: string, serverUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.streamUrl = `${serverUrl}/api/stream/mjpeg?url=${encodeURIComponent(rtspUrl)}`;

      const img = document.createElement('img');

      img.onload = () => {
        this.isConnected = true;
        resolve();
      };

      img.onerror = () => {
        this.isConnected = false;
        reject(new Error('Failed to load MJPEG stream'));
      };

      img.src = this.streamUrl;
      this.imgElement = img;
    });
  }

  setVideoElement(element: HTMLVideoElement) {
    // Hide video element and show image element instead
    element.style.display = 'none';
    if (this.imgElement) {
      element.parentNode?.replaceChild(this.imgElement, element);
    }
  }

  getImageElement(): HTMLImageElement | null {
    return this.imgElement;
  }

  disconnect() {
    if (this.imgElement) {
      this.imgElement.src = '';
      this.imgElement = null;
    }
    this.isConnected = false;
  }

  isReady(): boolean {
    return this.isConnected && this.imgElement !== null;
  }
}

export const rtspMjpegPlayer = new SimpleMJPEGPlayer();
