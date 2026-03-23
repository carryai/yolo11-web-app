export class WebRTCPlayer {
  private pc: RTCPeerConnection | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private isConnected = false;

  constructor(
    private iceServers: RTCIceServer[] = [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
    ]
  ) {}

  async connect(offerUrl: string): Promise<MediaStream> {
    return new Promise((resolve, reject) => {
      try {
        this.pc = new RTCPeerConnection({
          iceServers: this.iceServers,
        });

        this.pc.onicecandidate = (event) => {
          if (event.candidate === null) {
            // ICE gathering complete
            console.log('ICE gathering complete');
          }
        };

        this.pc.ontrack = (event) => {
          console.log('Received track:', event.track.kind);
          if (!this.stream) {
            this.stream = new MediaStream();
          }
          this.stream.addTrack(event.track);
          if (this.videoElement) {
            this.videoElement.srcObject = this.stream;
          }
          // Resolve when we get video track
          if (event.track.kind === 'video') {
            this.isConnected = true;
            resolve(this.stream);
          }
        };

        this.pc.onconnectionstatechange = () => {
          console.log('Connection state:', this.pc?.connectionState);
          if (this.pc?.connectionState === 'failed' || this.pc?.connectionState === 'closed') {
            this.isConnected = false;
            reject(new Error('WebRTC connection failed'));
          }
        };

        this.pc.oniceconnectionstatechange = () => {
          console.log('ICE state:', this.pc?.iceConnectionState);
        };

        // Fetch and apply SDP offer
        this.fetchAndApplyOffer(offerUrl).catch(reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  private async fetchAndApplyOffer(offerUrl: string) {
    try {
      const response = await fetch(offerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'offer',
          sdp: '',
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const answer = await response.json();

      if (answer.sdp) {
        await this.pc?.setRemoteDescription({
          type: 'answer',
          sdp: answer.sdp,
        });
      }
    } catch (error) {
      console.error('Failed to fetch offer:', error);
      throw error;
    }
  }

  setVideoElement(element: HTMLVideoElement) {
    this.videoElement = element;
    if (this.stream) {
      element.srcObject = this.stream;
    }
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.videoElement;
  }

  disconnect() {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.isConnected = false;
  }

  isReady(): boolean {
    return this.isConnected && this.videoElement !== null;
  }
}

export const webrtcPlayer = new WebRTCPlayer();
