const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const heicConvert = require('heic-convert');
const sharp = require('sharp');
const { resolveBinary } = require('./bin-utils');

const FFMPEG = resolveBinary('ffmpeg');
const FFPROBE = resolveBinary('ffprobe');
const IMAGES_DIR = process.argv[2] || 'middle-images';
const OUTPUT = process.argv[3] || path.join(__dirname, 'output/middle-slideshow.mp4');
const DURATION = 9;
const IMAGE_DURATION = 0.2;

const OUTPUT_DIR = path.dirname(OUTPUT);
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function getVideoDurationSeconds(filePath) {
  const raw = execSync(
    `"${FFPROBE}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
  ).toString().trim();
  const duration = Number(raw);
  if (!Number.isFinite(duration)) {
    throw new Error(`Unable to parse duration for ${filePath}. ffprobe output: ${raw}`);
  }
  return duration;
}

async function toJpeg(inputPath, outputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.heic') {
    const inputBuffer = fs.readFileSync(inputPath);
    const outputBuffer = await heicConvert({
      buffer: inputBuffer,
      format: 'JPEG',
      quality: 0.95
    });
    fs.writeFileSync(outputPath, outputBuffer);
    return;
  }

  await sharp(inputPath)
    .jpeg({ quality: 95 })
    .toFile(outputPath);
}

async function createSlideshow() {
  console.log(`Creating looping slideshow from ${IMAGES_DIR}`);
  console.log(`Output: ${OUTPUT}`);

  const files = fs.readdirSync(IMAGES_DIR)
    .filter((f) => /\.(jpg|jpeg|png|heic)$/i.test(f))
    .sort();

  if (files.length === 0) {
    throw new Error(`No images found in ${IMAGES_DIR}`);
  }

  console.log(`Found ${files.length} images`);
  console.log(`Each image displays for ${IMAGE_DURATION}s`);

  const totalFrames = Math.ceil(DURATION / IMAGE_DURATION);
  console.log(`Total frames: ${totalFrames}`);

  const tempDir = path.join(OUTPUT_DIR, 'temp-images');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  console.log('Converting images to JPG (parallel)...');
  const conversions = files.map(async (file, idx) => {
    const src = path.join(IMAGES_DIR, file);
    const dest = path.join(tempDir, `img_${String(idx + 1).padStart(3, '0')}.jpg`);
    try {
      await toJpeg(src, dest);
      return { file, success: true };
    } catch (error) {
      return { file, success: false, error: error.message };
    }
  });

  const results = await Promise.all(conversions);
  const failed = results.filter((r) => !r.success);
  if (failed.length > 0) {
    failed.forEach((item) => {
      console.log(`Failed to convert ${item.file}: ${item.error}`);
    });
  }

  const converted = fs.readdirSync(tempDir).filter((f) => f.endsWith('.jpg')).sort();
  if (converted.length === 0) {
    throw new Error('No valid images were converted.');
  }

  const listFile = path.join(tempDir, 'list.txt');
  let listContent = '';

  for (let i = 0; i < totalFrames; i++) {
    const frameFile = converted[i % converted.length];
    const framePath = path.resolve(tempDir, frameFile);
    listContent += `file '${framePath}'\n`;
    listContent += `duration ${IMAGE_DURATION}\n`;
  }

  const lastFrame = path.resolve(tempDir, converted[(totalFrames - 1) % converted.length]);
  listContent += `file '${lastFrame}'\n`;

  fs.writeFileSync(listFile, listContent);

  const absoluteOutput = path.resolve(OUTPUT);
  execSync(
    `"${FFMPEG}" -y -f concat -safe 0 -i "${listFile}" -r 30 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1" -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -t ${DURATION} "${absoluteOutput}"`,
    { stdio: 'inherit' }
  );

  fs.rmSync(tempDir, { recursive: true, force: true });

  const durSeconds = getVideoDurationSeconds(absoluteOutput);
  console.log(`Saved: ${OUTPUT}`);
  console.log(`Duration: ${durSeconds.toFixed(2)}s`);
}

createSlideshow().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
