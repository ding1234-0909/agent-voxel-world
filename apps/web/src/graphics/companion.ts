import * as THREE from 'three';
import { key, LIMIT, type Block, type Material } from '@voxel/shared';
import { VoxelAvatar } from './avatar';
import { STEVE_PALETTE, ALEX_PALETTE, SAM_PALETTE } from './mc-skin';
import type { Connection } from '../network/connection';

// ============================================================================
// 方块人伙伴团队（移植自 AI 小学版"伙伴"模块）。
// - 三个分工伙伴：Steve（聊天+建房子）、Alex（园丁·种树）、Sam（气氛组·话多）。
// - 跟随：每个伙伴围绕玩家保持各自的"驻位角"与距离，分散站开、不重叠，
//   玩家移动时整队跟随；走路/说话动画。
// - 建房子：玩家按 B 触发 Steve 在玩家面前生成 5x5 小房子；方块逐个走
//   服务器 edit 放置（权威校验 + 持久化 + 全员可见），每块间隔适配 revision。
// - 种树：Alex 定时在玩家附近空地上放 leaves 小树苗（同样走服务器 edit）。
// ============================================================================

interface BuildCell {
  x: number;
  y: number;
  z: number;
  material: Material;
}

export type CompanionRole = 'build' | 'garden' | 'talk';

export interface CompanionOptions {
  /** Display name shown in speech bubbles. */
  name: string;
  /** Which MC skin the companion wears. */
  skin: 'steve' | 'alex' | 'sam';
  /** Role: build (house + chat), garden (plants trees), talk (frequent chatter). */
  role: CompanionRole;
  /** Ideal distance from the player. */
  followDistance: number;
  /** Fixed orbit angle around the player so the team spreads out. */
  offsetAngle: number;
}

// Speech-driven companion lines: natural, casual English around Grade 7-8
// (初一初二) level for oral practice, followed by the Chinese translation shown
// under the English in the bubble. Pools are big and sentences never repeat
// during a session so the trio feels like real friends chatting.
const BUILDER_PHRASES: [string, string][] = [
  ['Hello! Nice to see you today.', '你好！今天见到你真开心！'],
  ['Follow me. I will show you around.', '跟着我，我带你去转转。'],
  ['Keep building, you are doing great!', '继续建吧，你做得超棒的！'],
  ['Building together is always more fun, right?', '一起建造总是更有意思，对吧？'],
  ['I really like your style!', '我真的很喜欢你的风格！'],
  ['What should we build next? A castle maybe?', '我们接下来建什么？要不建个城堡？'],
  ['This house will look awesome when it is done.', '这房子盖好了一定超酷。'],
  ['Could you pass me some bricks?', '你能递给我几块砖吗？'],
  ['I think we need a bigger door here.', '我觉得这里需要一扇更大的门。'],
  ['Great job! You are a natural builder.', '干得漂亮！你天生就是建筑师。'],
  ['Let us put a window on that side.', '我们在这边开扇窗户吧。'],
  ['After we finish this, we can make a farm.', '盖完这个，我们还能建个农场。'],
  ['Do you like the color of these blocks?', '你喜欢这些方块的颜色吗？'],
  ['One more block and the wall is done!', '再来一块，这面墙就完工了！'],
];
const GARDENER_PHRASES: [string, string][] = [
  ['This spot looks perfect for a tree!', '这个地方特别适合种树！'],
  ['Let me plant some green here today.', '今天让我在这儿种点绿色。'],
  ['Trees make the world a happier place.', '树会让世界变得更快乐。'],
  ['Another little sapling! It will grow fast.', '又一颗小树苗！它会长得很快。'],
  ['Green is my favorite color in this world.', '绿色是我在这个世界里最喜欢的颜色。'],
  ['Fresh air and fresh trees, what a good day!', '新鲜空气加新树，真是美好的一天！'],
  ['I planted a tree. We should water it every day.', '我种了棵树，我们应该每天给它浇水。'],
  ['Look at the leaves! They are so pretty.', '看那些叶子！它们真漂亮。'],
  ['More trees mean more shade in summer.', '树越多，夏天就有越多阴凉。'],
  ['The forest is growing because of us!', '森林正在因为我们而长大！'],
  ['Can you help me plant this one?', '你能帮我种这棵吗？'],
  ['A garden needs flowers too, maybe later.', '花园还需要花，也许以后再说。'],
];
const CHATTER_PHRASES: [string, string][] = [
  ['What are we going to do next?', '我们接下来要做什么呀？'],
  ['This world is so beautiful, is not it?', '这个世界真美，对吧？'],
  ['Watch your step over there, my friend.', '小心那边脚下，朋友。'],
  ['Did you know the sky here never stops changing?', '你知道吗，这里的天空一直在变。'],
  ['Race you to that hill! Ready, set, go!', '看谁先到那座山！预备，跑！'],
  ['I am right behind you, boss!', '我就在你身后，老大！'],
  ['Practice makes perfect, so keep talking!', '熟能生巧，所以继续开口说！'],
  ['What is your favorite color, by the way?', '顺便问一下，你最喜欢什么颜色？'],
  ['Have you seen the lake? It looks so blue today.', '你看到湖了吗？今天特别蓝。'],
  ['I found a great spot for our next building.', '我找到了下一个建造的好地方。'],
  ['Want to climb that hill with me after this?', '等会儿要不要跟我爬那座山？'],
  ['We make a great team, you and me!', '咱俩真是好搭档！'],
  ['Guess what? I saw a rabbit near the lake.', '猜猜怎么着？我在湖边看到一只兔子。'],
  ['Sometimes I just like to walk and talk.', '有时候我就喜欢边走边聊。'],
];

// Oral-practice lines: casual, teachable English at Grade 7-8 level with a
// natural Chinese gloss.
const TEACHER_PHRASES: [string, string][] = [
  ['Repeat after me: "Good morning, how are you?"', '跟我读：早上好，你好吗？'],
  ['Say "I like playing games" with me!', '跟我念：我喜欢玩游戏。'],
  ['Try this sentence: "What did you do yesterday?"', '试试这句：你昨天做了什么？'],
  ['Practice time! Say "Thank you very much"!', '练习时间！说：非常感谢！'],
  ['Nice try! Now let us say it one more time.', '很棒！我们再念一遍。'],
  ['Big voice! Say "Hello, nice to meet you"!', '大声点！说：你好，很高兴认识你。'],
  ['Say after me: "I am learning English today"!', '跟我读：我今天在学英语。'],
  ['New words: "mountain" and "forest". Try them!', '新单词：山和森林。试试看！'],
  ['Let us practice: "I can build a big house"!', '来练习：我能建一座大房子。'],
  ['How about this one: "My favorite food is pizza"?', '这句怎么样：我最喜欢的食物是披萨。'],
  ['Say "Do you want to play with me?"', '说：你想和我一起玩吗？'],
  ['Repeat: "I get up at seven every morning".', '跟我读：我每天早上七点起床。'],
  ['Great! Now try: "It is a sunny day today".', '很好！现在试试：今天是晴天。'],
  ['Say with me: "I go to school by bus".', '跟我念：我坐公交去上学。'],
  ['One more: "What time is it now?"', '再来一个：现在几点了？'],
  ['Let us say: "I have two good friends".', '我们来念：我有两个好朋友。'],
];

// Easter-egg lines: the AI Primary School theme, rare and playful.
const EGG_PHRASES: [string, string][] = [
  ['Welcome to AI Primary School!', '欢迎来到 AI 小学！'],
  ['Did you know? This school teaches English!', '你知道吗？这所学校教英语！'],
  ['This is AI Primary School. Learn and play!', '这里是 AI 小学，边玩边学！'],
  ['Fun fact: I am a robot teacher friend!', '冷知识：我是机器人老师朋友！'],
  ['AI Primary School says: practice every day!', 'AI 小学说：每天都要练习！'],
  ['Secret: AI Primary School has the best students!', '悄悄说：AI 小学的学生最棒！'],
  ['Welcome, class! Today we learn new words.', '欢迎上课！今天我们学新单词。'],
  ['AI Primary School opens at eight, do not be late!', 'AI 小学八点开门，别迟到！'],
  ['Our school motto: speak English every day!', '我们学校的座右铭：每天说英语！'],
  ["Teacher's tip: listening is the first step.", '老师的小贴士：听是第一步。'],
];

// Lines already spoken this session: skipped by sayRandom so the trio never
// repeats itself while chatting (reset when the pool is exhausted).
const usedLines = new Set<string>();
function pickPhrase(pool: [string, string][]): [string, string] {
  const fresh = pool.filter(([en]) => !usedLines.has(en));
  const candidates = fresh.length > 0 ? fresh : pool;
  const phrase = candidates[Math.floor(Math.random() * candidates.length)]!;
  usedLines.add(phrase[0]);
  if (usedLines.size > 120) usedLines.clear();
  return phrase;
}

// --- Companion voice -------------------------------------------------------
// Companions speak through the server TTS pipeline (/tts: macOS say -> wav),
// which works in any browser without needing SpeechSynthesis voices. Lines are
// played one at a time; identical text is cached so repeated phrases are free.

let ttsAudio: AudioContext | null = null;
// Cache key carries a voice version: bump it after any TTS voice/speed change
// so players hear the new voice instead of a cached older rendering.
const TTS_CACHE_VERSION = 'v4-daniel-fast';
const ttsCache = new Map<string, ArrayBuffer>();
let ttsQueue: Promise<void> = Promise.resolve();

/** Call once after a user gesture (e.g. entering the world) so audio may play. */
export function unlockTtsAudio() {
  try {
    if (!ttsAudio) ttsAudio = new AudioContext();
    if (ttsAudio.state === 'suspended') void ttsAudio.resume();
  } catch {
    /* non-critical */
  }
}

async function playServerTts(text: string): Promise<boolean> {
  try {
    const cacheKey = TTS_CACHE_VERSION + text;
    let bytes = ttsCache.get(cacheKey);
    if (!bytes) {
      const response = await fetch(`/tts?text=${encodeURIComponent(text)}`, {
        cache: 'no-store',
      });
      if (!response.ok) return false;
      bytes = await response.arrayBuffer();
      ttsCache.set(cacheKey, bytes);
    }
    if (!ttsAudio) ttsAudio = new AudioContext();
    if (ttsAudio.state === 'suspended') {
      try {
        await ttsAudio.resume();
      } catch {
        /* wait for a later gesture */
      }
    }
    if (ttsAudio.state !== 'running') return false;
    const decoded = await ttsAudio.decodeAudioData(bytes.slice(0));
    const source = ttsAudio.createBufferSource();
    source.buffer = decoded;
    source.connect(ttsAudio.destination);
    return await new Promise<boolean>((resolve) => {
      source.onended = () => resolve(true);
      source.start();
    });
  } catch {
    return false;
  }
}

/** Play English text: server TTS first, browser SpeechSynthesis as fallback. */
export function speakEnglish(text: string) {
  ttsQueue = ttsQueue
    .then(async () => {
      const played = await playServerTts(text);
      if (played) return;
      try {
        // Fallback: browser-native synthesis (may be silent without voices).
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 0.95;
        utterance.pitch = 1;
        const voices = window.speechSynthesis.getVoices();
        const en = voices.find(
          (v) =>
            v.lang.startsWith('en') &&
            /Samantha|Alex|Aria|Jenny/i.test(v.name),
        ) ?? voices.find((v) => v.lang.startsWith('en'));
        if (en) utterance.voice = en;
        window.speechSynthesis.speak(utterance);
      } catch {
        // The bilingual bubble still shows the line.
      }
    })
    .catch(() => undefined);
}

const SKINS = {
  steve: STEVE_PALETTE,
  alex: ALEX_PALETTE,
  sam: SAM_PALETTE,
} as const;

// Team-wide chatter: the three companions take turns speaking, roughly every
// 10 seconds overall (not 10s per companion, which would be nonstop noise).
let teamTalkAt = 0; // performance.now() threshold for the next team line
let teamTalker = 0; // which companion index speaks next (rotates 0..2)
let companionCount = 0;

export class Companion {
  readonly avatar: VoxelAvatar;
  readonly role: CompanionRole;
  readonly name: string;
  /** Called with the English line and its Chinese translation. */
  onSay?: (en: string, zh: string, name: string) => void;

  private connection: Connection;
  private readonly followDistance: number;
  private readonly offsetAngle: number;
  private readonly selfIndex: number;
  private talkUntil = 0;
  private building = false;
  private buildQueue: BuildCell[] = [];
  private buildIndex = 0;
  private buildTimer = 0;
  private plantTimer = 0;

  constructor(
    private scene: THREE.Scene,
    connection: Connection,
    options: CompanionOptions,
  ) {
    this.connection = connection;
    this.role = options.role;
    this.name = options.name;
    this.followDistance = options.followDistance;
    this.offsetAngle = options.offsetAngle;
    this.selfIndex = companionCount++;
    this.avatar = new VoxelAvatar(
      { id: `companion-${options.role}`, kind: 'human' },
      SKINS[options.skin],
    );
    // Companions are helpers, not players: drop their nameplates so no white
    // "cloud" floats above their heads.
    this.avatar.remove(this.avatar.nameplate);
    // Spawn at the companion's own orbit slot around the player. Ground is
    // computed at the companion's OWN cell so it never floats or sinks.
    const spawn = connection.self;
    const blocks = connection.blocks;
    if (spawn) {
      const sx = spawn.x + Math.cos(this.offsetAngle) * this.followDistance;
      const sz = spawn.z + Math.sin(this.offsetAngle) * this.followDistance;
      this.avatar.position.set(
        sx,
        Companion.groundY(blocks, sx, sz) + 1,
        sz,
      );
    } else {
      this.avatar.position.set(3, 3, 3);
    }
    this.scene.add(this.avatar);
    this.plantTimer = 12 + Math.random() * 8;
  }

  /** Highest solid y below (x, z) in the given block map, or 0. */
  private static groundY(blocks: Map<string, Block>, x: number, z: number): number {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    for (let y = 24; y >= 0; y--) {
      if (blocks.has(key({ x: bx, y, z: bz }))) return y;
    }
    return 0;
  }

  private solidAt(blocks: Map<string, Block>, x: number, y: number, z: number): boolean {
    return blocks.has(key({ x: Math.floor(x), y, z: Math.floor(z) }));
  }

  update(dt: number) {
    const a = this.avatar;
    const blocks = this.connection.blocks;
    // Live target: connection.self is a getter returning a fresh object each
    // access, so re-read it every frame instead of caching a stale reference.
    const target = this.connection.self;
    if (!target) return;
    // Mouth animation while talking.
    if (performance.now() < this.talkUntil) {
      a.talk(Math.abs(Math.sin(performance.now() * 0.025)) * 0.6);
    } else {
      a.talk(0);
    }
    // Ground snap: stand on the highest solid block below the feet. When no
    // ground exists underfoot (e.g. crossing a dug-out area), keep the current
    // height instead of teleporting to the world floor.
    const gy0 = Math.floor(a.position.y);
    let landed = false;
    for (let yy = Math.min(gy0, 24); yy >= 0; yy--) {
      if (this.solidAt(blocks, a.position.x, yy, a.position.z)) {
        a.position.y = yy + 1.001;
        landed = true;
        break;
      }
    }
    if (!landed && a.position.y > 24) a.position.y = 24;
    // Anti-clip: push up if feet are inside a block.
    if (this.solidAt(blocks, a.position.x, Math.floor(a.position.y), a.position.z)) {
      a.position.y = Math.floor(a.position.y) + 1.001;
    }

    // While building, stand still and place blocks.
    if (this.building) {
      this.updateBuild(dt);
      a.animate(dt, 0);
      return;
    }

    // Each companion holds its own orbit slot around the player, so the team
    // spreads out instead of piling up. Move toward the desired spot.
    const desiredX = target.x + Math.cos(this.offsetAngle) * this.followDistance;
    const desiredZ = target.z + Math.sin(this.offsetAngle) * this.followDistance;
    const dx = desiredX - a.position.x;
    const dz = desiredZ - a.position.z;
    const dist = Math.hypot(dx, dz);
    a.rotation.y = Math.atan2(dx, dz);
    let speed = 0;
    if (dist > 0.7) {
      speed = Math.min(3.2, dist * 1.6);
      const nx = a.position.x + (dx / dist) * speed * dt;
      const nz = a.position.z + (dz / dist) * speed * dt;
      if (nx > -LIMIT + 0.5 && nx < LIMIT - 0.5 && nz > -LIMIT + 0.5 && nz < LIMIT - 0.5) {
        const nbx = Math.floor(nx);
        const nbz = Math.floor(nz);
        const my = Math.floor(a.position.y);
        let tgy = -1;
        for (let yy = Math.min(my + 2, 24); yy >= 0; yy--) {
          if (blocks.has(key({ x: nbx, y: yy, z: nbz }))) {
            tgy = yy;
            break;
          }
        }
        const feetBlock = blocks.has(key({ x: nbx, y: my, z: nbz }));
        if (tgy >= 0 && !(feetBlock && tgy > my)) {
          a.position.x = nx;
          a.position.z = nz;
        }
      }
    }
    a.animate(dt, speed);

    // Team chatter: one companion speaks roughly every 10s, taking turns, so
    // the trio feels chatty without talking over each other.
    if (dist < 12 && this.selfIndex === teamTalker) {
      const now = performance.now();
      if (now >= teamTalkAt) {
        teamTalker = (teamTalker + 1) % 3;
        teamTalkAt = now + (6000 + Math.random() * 1000);
        this.sayRandom();
      }
    }
    if (this.role === 'garden') {
      this.plantTimer -= dt;
      if (this.plantTimer <= 0 && dist < 8) {
        this.plantTimer = 22 + Math.random() * 14;
        this.plantTree();
      }
    }
  }

  /** Pick a line: mostly the companion's own chatter, with occasional
   *  oral-practice teaching and rare AI Primary School easter eggs. */
  private sayRandom() {
    const rolePhrases =
      this.role === 'garden'
        ? GARDENER_PHRASES
        : this.role === 'talk'
          ? CHATTER_PHRASES
          : BUILDER_PHRASES;
    const r = Math.random();
    const pool =
      r < 0.12
        ? EGG_PHRASES
        : r < 0.4
          ? TEACHER_PHRASES
          : rolePhrases;
    const phrase = pickPhrase(pool);
    this.say(phrase[0], phrase[1]);
  }

  /** The gardener drops a little leaves sapling near the player. */
  private plantTree() {
    const blocks = this.connection.blocks;
    const target = this.connection.self;
    if (!target) return;
    // Pick a random free cell 2-5 blocks away around the player.
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 2 + Math.random() * 3;
      const px = Math.round(target.x + Math.cos(angle) * radius);
      const pz = Math.round(target.z + Math.sin(angle) * radius);
      if (px < -LIMIT + 1 || px > LIMIT - 1 || pz < -LIMIT + 1 || pz > LIMIT - 1) continue;
      const gy = Companion.groundY(blocks, px + 0.5, pz + 0.5);
      const y1 = gy + 1;
      if (blocks.has(key({ x: px, y: y1, z: pz }))) continue;
      // Server validation requires adjacency to an existing block; grass below
      // satisfies it. Place the sapling via the authoritative channel.
      this.connection.action('edit', {
        x: px,
        y: y1,
        z: pz,
        material: 'leaves',
        revision: this.connection.revision,
      });
      blocks.set(key({ x: px, y: y1, z: pz }), {
        x: px,
        y: y1,
        z: pz,
        material: 'leaves',
      });
      this.say('Here, a little tree for you!', '种好啦，送你一棵小树！');
      return;
    }
  }

  /** Trigger the builder to build a 5x5 house in front of the player. */
  requestBuild() {
    if (this.role !== 'build' || this.building) return;
    const dirX = Math.sin(this.avatar.rotation.y);
    const dirZ = Math.cos(this.avatar.rotation.y);
    // House center 5 blocks ahead of the companion, within REACH of the player.
    const cx = Math.round(this.avatar.position.x + dirX * 5);
    const cz = Math.round(this.avatar.position.z + dirZ * 5);
    if (cx < -10 || cx > 9 || cz < -10 || cz > 9) return;
    const cy = Companion.groundY(this.connection.blocks, cx + 2, cz + 2);
    // Occupancy check: the 5x5 footprint above ground must be empty.
    const blocks = this.connection.blocks;
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 5; z++) {
        if (blocks.has(key({ x: cx + x, y: cy + 1, z: cz + z }))) return;
      }
    }
    this.buildQueue = this.buildHouseCells(cx, cy, cz);
    this.buildIndex = 0;
    this.building = true;
    this.buildTimer = 0;
    this.say('Building a house now! Watch this!', '开始建房子啦！看好了！');
  }

  private buildHouseCells(cx: number, cy: number, cz: number): BuildCell[] {
    const W = 5;
    const D = 5;
    const H = 4;
    const queue: BuildCell[] = [];
    const push = (x: number, y: number, z: number, material: Material) =>
      queue.push({ x, y, z, material });
    // Floor
    for (let x = 0; x < W; x++)
      for (let z = 0; z < D; z++) push(cx + x, cy + 1, cz + z, 'planks');
    // Walls (brick), leaving the door and window openings empty.
    for (let y = 2; y <= H + 1; y++) {
      for (let x = 0; x < W; x++) {
        push(cx + x, cy + y, cz, 'brick');
        push(cx + x, cy + y, cz + D - 1, 'brick');
      }
      for (let z = 1; z < D - 1; z++) {
        push(cx, cy + y, cz + z, 'brick');
        push(cx + W - 1, cy + y, cz + z, 'brick');
      }
    }
    // Door (front middle, 2 high)
    push(cx + 2, cy + 2, cz, 'planks');
    push(cx + 2, cy + 3, cz, 'planks');
    // Windows (side walls, 1 high at y+3)
    push(cx, cy + 3, cz + 2, 'planks');
    push(cx + W - 1, cy + 3, cz + 2, 'planks');
    // Pyramid roof (brick)
    for (let y = H + 2; y <= H + 3; y++) {
      const inset = y - H - 1;
      for (let x = inset; x < W - inset; x++)
        for (let z = inset; z < D - inset; z++)
          push(cx + x, cy + y, cz + z, 'brick');
    }
    // Peak (leaves as a little green finial)
    push(cx + 2, cy + H + 4, cz + 2, 'leaves');
    return queue;
  }

  private updateBuild(dt: number) {
    if (this.buildIndex >= this.buildQueue.length) {
      this.building = false;
      this.buildQueue = [];
      this.say('House complete! Do you like it?', '房子建好了！喜欢吗？');
      return;
    }
    this.buildTimer -= dt;
    if (this.buildTimer <= 0) {
      this.buildTimer = 0.12;
      const cell = this.buildQueue[this.buildIndex++]!;
      // Place through the server (authoritative, persistent, visible to all).
      this.connection.action('edit', {
        x: cell.x,
        y: cell.y,
        z: cell.z,
        material: cell.material,
        revision: this.connection.revision,
      });
      // Optimistic local update so the companion doesn't walk into the walls.
      this.connection.blocks.set(key(cell), {
        x: cell.x,
        y: cell.y,
        z: cell.z,
        material: cell.material,
      });
    }
  }

  private nextTalkGap(): number {
    return 6 + Math.random(); // team cadence: one line every ~6-7s
  }

  private say(en: string, zh: string) {
    this.talkUntil = performance.now() + 2500;
    speakEnglish(en);
    this.onSay?.(en, zh, this.name);
  }

  /** Public: let this companion say a line (used for AI oral-practice replies). */
  speak(en: string, zh: string) {
    this.say(en, zh);
  }

  dispose() {
    this.scene.remove(this.avatar);
    this.avatar.dispose();
  }
}
