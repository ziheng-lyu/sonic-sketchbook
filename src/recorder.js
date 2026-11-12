export class Microphone {
  constructor(mediaDevices, Recorder) {
    this.mediaDevices = mediaDevices;
    this.Recorder = Recorder;
  }
  release() { this.stream?.getTracks().forEach(track => track.stop()); this.stream = null; }
  async start(onUnexpectedStop) {
    if (!this.mediaDevices?.getUserMedia || !this.Recorder) throw new Error('unsupported');
    const stream = await this.mediaDevices.getUserMedia({ audio: true });
    this.stream = stream;
    if (this.disposed) { this.release(); return; }
    try {
      this.chunks = [];
      this.recorder = new this.Recorder(stream);
      this.result = new Promise((resolve, reject) => {
        this.recorder.ondataavailable = event => { if (event.data.size) this.chunks.push(event.data); };
        this.recorder.onerror = () => { this.release(); reject(new Error('recording-failed')); };
        this.recorder.onstop = () => { this.release(); resolve(new Blob(this.chunks, { type: this.recorder.mimeType })); };
      });
      // Attach immediately so a device failure before Stop has no unhandled rejection.
      this.result.catch(() => onUnexpectedStop?.());
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
        if (this.recorder.state !== 'inactive') { this.recorder.stop(); onUnexpectedStop?.(); }
      }, { once: true }));
      this.recorder.start();
    } catch (error) { this.release(); throw error; }
  }
  async finish() {
    if (this.recorder?.state !== 'inactive') this.recorder?.stop();
    return this.result;
  }
  dispose() {
    this.disposed = true;
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.release();
  }
}
