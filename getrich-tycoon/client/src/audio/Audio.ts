// Lightweight WebAudio sound system. All sounds are synthesized (no assets).

export type Sfx = 'click' | 'purchase' | 'notify' | 'error' | 'levelup' | 'coin' | 'door' | 'outbid';

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private ambientBus!: GainNode;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private hornTimer = 0;
  volumes = { master: 0.8, sfx: 0.9, ambient: 0.5 };

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.ambientBus = ctx.createGain();
    this.ambientBus.connect(this.master);
    this.applyVolumes();
    this.startAmbient();
    this.startEngine();
  }

  setVolumes(master: number, sfx: number, ambient: number): void {
    this.volumes = { master, sfx, ambient };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.sfxBus.gain.value = this.volumes.sfx;
    this.ambientBus.gain.value = this.volumes.ambient * 0.5;
  }

  private startAmbient(): void {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.35;
    src.connect(lp).connect(g).connect(this.ambientBus);
    src.start();
  }

  private startEngine(): void {
    const ctx = this.ctx!;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 40;
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.value = 20;
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(g2).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.sfxBus);
    this.engineOsc.start();
    this.engineOsc2.start();
  }

  /** Update engine sound each frame. */
  engine(driving: boolean, speed: number, throttle: boolean, dt: number): void {
    if (!this.ctx || !this.engineOsc) return;
    const t = this.ctx.currentTime;
    const rpm = 38 + Math.abs(speed) * 4.2 + (throttle ? 18 : 0);
    this.engineOsc.frequency.setTargetAtTime(rpm, t, 0.08);
    this.engineOsc2!.frequency.setTargetAtTime(rpm / 2, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(380 + Math.abs(speed) * 30 + (throttle ? 250 : 0), t, 0.1);
    this.engineGain.gain.setTargetAtTime(driving ? 0.11 + (throttle ? 0.05 : 0) : 0, t, 0.15);
    // Occasional distant horn for city ambience.
    this.hornTimer -= dt;
    if (this.hornTimer <= 0) {
      this.hornTimer = 18 + Math.random() * 30;
      if (Math.random() < 0.6) this.tone([392, 392], 0.18, 'square', 0.025, this.ambientBus);
    }
  }

  private tone(freqs: number[], dur: number, type: OscillatorType, vol: number, bus?: GainNode, gap = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    let start = ctx.currentTime;
    for (const f of freqs) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(vol, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      o.connect(g).connect(bus ?? this.sfxBus);
      o.start(start);
      o.stop(start + dur + 0.05);
      start += gap || dur * 0.6;
    }
  }

  play(s: Sfx): void {
    switch (s) {
      case 'click':
        return this.tone([880], 0.06, 'sine', 0.08);
      case 'coin':
        return this.tone([1318, 1760], 0.12, 'square', 0.05, undefined, 0.07);
      case 'purchase':
        return this.tone([523, 659, 784, 1047], 0.22, 'triangle', 0.14, undefined, 0.08);
      case 'notify':
        return this.tone([740, 988], 0.16, 'sine', 0.1, undefined, 0.1);
      case 'error':
        return this.tone([220, 185], 0.18, 'sawtooth', 0.06, undefined, 0.12);
      case 'levelup':
        return this.tone([523, 659, 784, 1047, 1319], 0.3, 'triangle', 0.14, undefined, 0.09);
      case 'door':
        return this.tone([180, 140], 0.12, 'triangle', 0.1, undefined, 0.08);
      case 'outbid':
        return this.tone([660, 440], 0.2, 'square', 0.05, undefined, 0.12);
    }
  }
}
