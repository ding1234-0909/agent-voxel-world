// ============================================================================
// 音效（移植自 AI 小学版源码 3415-3451 行）：用 Web Audio API 合成，无音频资产。
// 首次用户交互后才会创建 AudioContext（浏览器自动播放策略）。
// 由玩法 UI 组实现并填充各音效参数；UI 与 3D 场景都从这里调用。
// ============================================================================

class SoundEffects {
  private ctx: AudioContext | null = null;
  private enabled = true;

  /** 必须在用户手势（点击/按键）里调用一次 */
  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** 短噪声脉冲（破坏方块/脚步） */
  private noise(ctx: AudioContext, duration: number, gain: number, filterFreq: number) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start();
  }

  /** 简单音调（拾取/点击） */
  private tone(
    ctx: AudioContext,
    freq: number,
    duration: number,
    gain: number,
    type: OscillatorType = 'sine',
    slideTo?: number,
  ) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(
        slideTo,
        ctx.currentTime + duration,
      );
    }
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  /** 破坏方块（源码 sndBreak：0.09s 低通噪声脉冲，900Hz） */
  breakBlock(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    this.noise(ctx, 0.12, 0.3, 900);
  }

  /** 放置方块（源码 sndPlace：square 180→70 下滑，0.08s） */
  placeBlock(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    this.noise(ctx, 0.1, 0.16, 1400);
    this.tone(ctx, 180, 0.08, 0.2, 'square', 70);
  }

  /** 拾取掉落物（源码 sndPickup：sine 520→880 上滑） */
  pickup(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    this.tone(ctx, 520, 0.12, 0.18, 'sine', 880);
  }

  /** UI 点击/选择 */
  click(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    this.tone(ctx, 420, 0.05, 0.06, 'square');
  }

  /** 合成成功 */
  craft(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    this.tone(ctx, 440, 0.09, 0.1, 'sine', 660);
    this.tone(ctx, 660, 0.12, 0.1, 'sine', 880);
  }
}

export const sfx = new SoundEffects();
