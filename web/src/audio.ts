import world from '../../shared/world.json';

export class ClassicAudio {
  enabled = false;
  private context?: AudioContext;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private active = new Set<AudioBufferSourceNode>();
  async toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.context ??= new AudioContext();
      await this.context.resume();
      void this.play('103');
    } else for (const source of this.active) source.stop();
    return this.enabled;
  }
  async play(file: string, delay = 0) {
    const context = this.context;
    if (!this.enabled || !context || document.hidden || this.active.size >= 12) return;
    if (!this.buffers.has(file)) this.buffers.set(file, (async () => {
      const response = await fetch(`${world.assets}audio/${file}.wav`);
      if (!response.ok) throw new Error(`Classic audio ${file}: HTTP ${response.status}`);
      return context.decodeAudioData(await response.arrayBuffer());
    })());
    try {
      const buffer = await this.buffers.get(file)!;
      if (!this.enabled || document.hidden || this.active.size >= 12) return;
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffer; gain.gain.value = .35;
      source.connect(gain); gain.connect(context.destination);
      this.active.add(source);
      source.onended = () => { this.active.delete(source); source.disconnect(); gain.disconnect(); };
      source.start(context.currentTime + delay);
    } catch (error) { console.error(error); }
  }
}
