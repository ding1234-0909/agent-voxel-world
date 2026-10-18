import * as THREE from 'three';

// 20-minute day/night cycle, ported from reference lines 3663-3711 (r128 → 0.180).
// Keyframes drive sky/fog color, sun color/intensity/arc, hemisphere fill and a
// derived night factor used to tint clouds. The reference intensities were
// calibrated for a dimmer scene; we scale them to preserve this scene's existing
// noon brightness (sun 3.4, hemi 1.4).

const DAY_LEN = 1200; // seconds per full cycle (20 minutes)
const SUN_SCALE = 3.0;
const HEMI_SCALE = 1.5;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255,
    ag = (a >> 8) & 255,
    ab = a & 255;
  const br = (b >> 16) & 255,
    bg = (b >> 8) & 255,
    bb = b & 255;
  return (
    ((lerp(ar, br, t) | 0) << 16) |
    ((lerp(ag, bg, t) | 0) << 8) |
    (lerp(ab, bb, t) | 0)
  );
}

export class DayNightCycle {
  /** 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. Starts 08:00. */
  dayTime = 0.33;
  /** 0 = full day, 1 = deep night; consumed by clouds and the held block. */
  nightFactor = 0;
  /** Optional hook for a HUD clock (graphics stays UI-agnostic). */
  onTimeOfDay?: (label: string) => void;

  private skyColor = new THREE.Color();
  private fogColor = new THREE.Color();

  constructor(
    private scene: THREE.Scene,
    private sun: THREE.DirectionalLight,
    private hemi: THREE.HemisphereLight,
  ) {}

  update(dt: number) {
    this.dayTime = (this.dayTime + dt / DAY_LEN) % 1;
    const t = this.dayTime;

    let sky: number, fog: number, sunColor: number, sunInt: number, hemiInt: number;
    if (t < 0.2) {
      // Deep night
      sky = 0x0a1028;
      fog = 0x0d1428;
      sunColor = 0x4060a0;
      sunInt = 0.05;
      hemiInt = 0.15;
    } else if (t < 0.28) {
      // Sunrise
      const k = (t - 0.2) / 0.08;
      sky = lerpHex(0x0a1028, 0xe8956a, k);
      fog = lerpHex(0x0d1428, 0xd8a878, k);
      sunColor = lerpHex(0x4060a0, 0xffaa66, k);
      sunInt = 0.05 + k * 0.5;
      hemiInt = 0.15 + k * 0.4;
    } else if (t < 0.45) {
      // Morning
      const k = (t - 0.28) / 0.17;
      sky = lerpHex(0xe8956a, 0x8ec9ef, k);
      fog = lerpHex(0xd8a878, 0xcfe2f2, k);
      sunColor = lerpHex(0xffaa66, 0xfff0d4, k);
      sunInt = 0.55 + k * 0.6;
      hemiInt = 0.55 + k * 0.35;
    } else if (t < 0.6) {
      // Midday
      sky = 0x8ec9ef;
      fog = 0xcfe2f2;
      sunColor = 0xfff0d4;
      sunInt = 1.15;
      hemiInt = 0.9;
    } else if (t < 0.72) {
      // Afternoon
      const k = (t - 0.6) / 0.12;
      sky = lerpHex(0x8ec9ef, 0xf0b070, k);
      fog = lerpHex(0xcfe2f2, 0xe0b888, k);
      sunColor = lerpHex(0xfff0d4, 0xff9955, k);
      sunInt = 1.15 - k * 0.3;
      hemiInt = 0.9 - k * 0.2;
    } else if (t < 0.82) {
      // Sunset
      const k = (t - 0.72) / 0.1;
      sky = lerpHex(0xf0b070, 0x2a1a3a, k);
      fog = lerpHex(0xe0b888, 0x1a1530, k);
      sunColor = lerpHex(0xff9955, 0x553366, k);
      sunInt = 0.85 - k * 0.75;
      hemiInt = 0.7 - k * 0.5;
    } else {
      // Falling into night
      const k = (t - 0.82) / 0.18;
      sky = lerpHex(0x2a1a3a, 0x0a1028, k);
      fog = lerpHex(0x1a1530, 0x0d1428, k);
      sunColor = 0x4060a0;
      sunInt = 0.1;
      hemiInt = 0.2 - k * 0.05;
    }

    this.skyColor.setHex(sky);
    this.fogColor.setHex(fog);
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.skyColor);
    }
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(this.fogColor);
    }
    this.sun.color.setHex(sunColor);
    this.sun.intensity = sunInt * SUN_SCALE;
    this.hemi.intensity = hemiInt * HEMI_SCALE;

    // Sun (and moon glow, reused as a cool dim fill) travels the arc.
    const sunAngle = t * Math.PI * 2 - Math.PI / 2;
    const elevation = Math.sin(sunAngle);
    this.sun.position.set(
      Math.cos(sunAngle) * 80,
      elevation * 80 + 10,
      35,
    );
    this.nightFactor = THREE.MathUtils.clamp((0.3 - elevation) / 1.3, 0, 1);

    if (this.onTimeOfDay) {
      const hour24 = (t * 24) % 24;
      const hh = Math.floor(hour24);
      const mm = Math.floor((hour24 - hh) * 60);
      const icon = t >= 0.25 && t < 0.75 ? '☀' : '🌙';
      this.onTimeOfDay(
        `${icon} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
      );
    }
  }
}
