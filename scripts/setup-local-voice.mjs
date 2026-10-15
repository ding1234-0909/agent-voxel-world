import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('../.data/voice/', import.meta.url));
const model = `${dir}ggml-base.bin`;
const expectedHash =
  '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe';
async function valid(path) {
  try {
    if ((await stat(path)).size !== 147951465) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex') === expectedHash;
  } catch {
    return false;
  }
}
await mkdir(dir, { recursive: true });
try {
  if (await valid(model)) {
    console.log(`模型已存在：${model}`);
    process.exit(0);
  }
} catch {
  /* First download. */
}
console.log('下载 Whisper base 多语言模型（约 142 MiB），无需账号或 API key…');
const response = await fetch(
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  { signal: AbortSignal.timeout(600000) },
);
if (!response.ok || !response.body)
  throw Error(`下载失败：HTTP ${response.status}`);
await pipeline(
  Readable.fromWeb(response.body),
  createWriteStream(`${model}.part`),
);
if (!(await valid(`${model}.part`)))
  throw Error('模型文件不完整，请重新运行。');
await rename(`${model}.part`, model);
console.log(
  `模型就绪：${model}\n同时需要 PATH 中的 whisper-cli 和 ffmpeg；macOS 可运行 brew install whisper-cpp ffmpeg。`,
);
