const express = require('express');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const FormData = require('form-data');
const multer = require('multer');
const { resolveBinary } = require('./bin-utils');

const app = express();
app.use(express.json({ limit: '100mb' }));

const TEMP_BASE_DIR = 'temp-requests';
const UPLOADS_BASE_DIR = path.join(TEMP_BASE_DIR, 'uploads');
const OUTPUT_PUBLIC_DIR = path.join(__dirname, 'output');
const PUBLIC_DIR = path.join(__dirname, 'public');
const FFMPEG_BIN = resolveBinary('ffmpeg');

if (!fs.existsSync(TEMP_BASE_DIR)) fs.mkdirSync(TEMP_BASE_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_BASE_DIR)) fs.mkdirSync(UPLOADS_BASE_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_PUBLIC_DIR)) fs.mkdirSync(OUTPUT_PUBLIC_DIR, { recursive: true });

app.use(express.static(PUBLIC_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_BASE_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt = ext || '.bin';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
    }
  }),
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024
  }
});

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);

    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function uploadToStoreFile(filePath, userId) {
  const url = process.env.STORE_FILE_URL;
  if (!url) {
    throw new Error('STORE_FILE_URL is not configured');
  }

  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('userid', userId);

    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname,
      method: 'POST',
      headers: form.getHeaders()
    };

    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        } else {
          reject(new Error(`Upload failed with status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    form.pipe(req);
  });
}

function extractZip(zipPath, destDir) {
  console.log(`Extracting zip: ${zipPath}`);
  execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });

  const files = fs.readdirSync(destDir);
  console.log(`Extracted ${files.length} files`);
}

function copyLocalImagesToDir(localImagePaths, imagesDir) {
  for (let i = 0; i < localImagePaths.length; i++) {
    const sourcePath = localImagePaths[i];
    const ext = path.extname(sourcePath) || '.jpg';
    const targetPath = path.join(imagesDir, `image_${String(i).padStart(3, '0')}${ext.toLowerCase()}`);
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function runStep(stepNum, workDir) {
  return new Promise((resolve, reject) => {
    let scriptName;
    if (stepNum === 1) scriptName = 'step1-extract-last-frame.js';
    else if (stepNum === 2) scriptName = 'step2-remove-background.js';
    else if (stepNum === 3) scriptName = 'step3-add-borders.js';
    else if (stepNum === 4) scriptName = 'step4-compose-video.js';

    console.log(`Running step ${stepNum}: ${scriptName}`);

    const proc = spawn('node', [scriptName, workDir], {
      cwd: __dirname,
      stdio: 'inherit'
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Step ${stepNum} failed with code ${code}`));
    });
  });
}

async function createSlideshow(imagesDir, middleSlideshow) {
  console.log('Creating slideshow from images...');
  await new Promise((resolve, reject) => {
    const proc = spawn('node', ['create-middle-slideshow.js', imagesDir, middleSlideshow], {
      cwd: __dirname,
      stdio: 'inherit'
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Slideshow creation failed with code ${code}`));
    });
  });
}

async function processVideo(
  videoPath,
  isUrl = false,
  zipPath = null,
  zipUrl = false,
  userId = null,
  imageUrls = null,
  localImagePaths = null
) {
  const requestId = generateRequestId();
  const effectiveUserId = userId || requestId;
  const workDir = path.join(TEMP_BASE_DIR, requestId);
  const imagesDir = path.join(workDir, 'middle-images');
  const outputDir = path.join(workDir, 'output');

  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`Created work directory for request: ${requestId}`);

  try {
    const tempZip = path.join(workDir, 'input-images.zip');
    const middleSlideshow = path.join(outputDir, 'middle-slideshow.mp4');

    if (localImagePaths && localImagePaths.length > 0) {
      console.log(`Using ${localImagePaths.length} uploaded images`);
      copyLocalImagesToDir(localImagePaths, imagesDir);
      await createSlideshow(imagesDir, middleSlideshow);
    } else if (zipPath) {
      if (zipUrl) {
        console.log(`Downloading zip from: ${zipPath}`);
        await downloadFile(zipPath, tempZip);
        zipPath = tempZip;
      }

      if (!fs.existsSync(zipPath)) {
        throw new Error(`Zip file not found: ${zipPath}`);
      }

      console.log(`Extracting images from zip: ${zipPath}`);
      extractZip(zipPath, imagesDir);

      if (zipUrl && fs.existsSync(tempZip)) {
        fs.unlinkSync(tempZip);
      }

      await createSlideshow(imagesDir, middleSlideshow);
    } else if (imageUrls && imageUrls.length > 0) {
      console.log(`Downloading ${imageUrls.length} images...`);
      for (let i = 0; i < imageUrls.length; i++) {
        const imageUrl = imageUrls[i];
        const ext = path.extname(new URL(imageUrl).pathname).split('?')[0] || '.jpg';
        const destPath = path.join(imagesDir, `image_${String(i).padStart(3, '0')}${ext}`);
        console.log(`Downloading image ${i + 1}/${imageUrls.length}: ${imageUrl}`);
        await downloadFile(imageUrl, destPath);
      }

      await createSlideshow(imagesDir, middleSlideshow);
    }

    const tempVideo = path.join(workDir, 'input-video.mp4');

    if (isUrl) {
      console.log(`Downloading video from: ${videoPath}`);
      await downloadFile(videoPath, tempVideo);
      videoPath = tempVideo;
    } else if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    console.log(`Processing: ${videoPath}`);

    const ext = path.extname(videoPath).toLowerCase();
    if (!['.mp4', '.mov', '.avi'].includes(ext)) {
      throw new Error('Unsupported video format. Use MP4, MOV, or AVI.');
    }

    const mainVideo = path.join(workDir, 'main-video.MP4');

    console.log(`Converting to MP4: ${videoPath}`);
    await new Promise((resolve, reject) => {
      const proc = spawn(FFMPEG_BIN, [
        '-i', videoPath,
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        '-y',
        mainVideo
      ], { stdio: 'inherit' });
      proc.on('close', (code) => {
        if (code === 0) {
          console.log(`Converted to MP4: ${mainVideo}`);
          resolve();
        } else {
          reject(new Error(`Video conversion failed with code ${code}`));
        }
      });
    });

    await runStep(1, workDir);
    await runStep(2, workDir);
    await runStep(3, workDir);
    await runStep(4, workDir);

    const finalVideo = path.join(outputDir, 'final-video.mp4');
    const publishedFilename = `final-video-${requestId}.mp4`;
    const publishedPath = path.join(OUTPUT_PUBLIC_DIR, publishedFilename);
    fs.copyFileSync(finalVideo, publishedPath);

    let uploadResult = null;
    if (process.env.STORE_FILE_URL) {
      try {
        console.log('Uploading final video to store-file...');
        uploadResult = await uploadToStoreFile(finalVideo, effectiveUserId);
        console.log(`Upload complete: ${uploadResult.fileUrl}`);
      } catch (uploadError) {
        console.warn(`Store upload failed, using local output only: ${uploadError.message}`);
      }
    }

    if (isUrl && fs.existsSync(tempVideo)) {
      fs.unlinkSync(tempVideo);
    }

    fs.rmSync(workDir, { recursive: true, force: true });
    console.log(`Cleaned up work directory: ${requestId}`);

    const localStats = fs.statSync(publishedPath);

    return {
      success: true,
      outputPath: path.join('output', publishedFilename).replace(/\\/g, '/'),
      outputUrl: `/download/${publishedFilename}`,
      fileUrl: uploadResult ? uploadResult.fileUrl : null,
      fileId: uploadResult ? uploadResult.fileId : null,
      originalFilename: uploadResult ? uploadResult.originalFilename : publishedFilename,
      fileSize: uploadResult ? uploadResult.fileSize : localStats.size
    };
  } catch (error) {
    console.error('Error:', error.message);
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    throw error;
  }
}

app.post('/process', async (req, res) => {
  try {
    const { videoPath, isUrl, zipPath, zipUrl, userId, imageUrls } = req.body;

    if (!videoPath) {
      return res.status(400).json({ error: 'videoPath is required' });
    }

    console.log('\n========== NEW REQUEST ==========');
    console.log(`Video: ${videoPath}`);
    console.log(`Video Is URL: ${isUrl}`);
    console.log(`Zip: ${zipPath || 'none'}`);
    console.log(`Zip Is URL: ${zipUrl}`);
    console.log(`Image URLs: ${imageUrls ? imageUrls.length + ' images' : 'none'}`);
    console.log(`UserId: ${userId || 'default'}\n`);

    const result = await processVideo(videoPath, isUrl, zipPath, zipUrl, userId, imageUrls, null);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/process-upload', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'images', maxCount: 200 }
]), async (req, res) => {
  const uploadedPaths = [];

  try {
    const videoFile = req.files && req.files.video ? req.files.video[0] : null;
    const imageFiles = req.files && req.files.images ? req.files.images : [];
    const userId = req.body && req.body.userId ? req.body.userId : null;

    if (!videoFile) {
      return res.status(400).json({ success: false, error: 'video file is required' });
    }

    uploadedPaths.push(videoFile.path);
    for (const imageFile of imageFiles) {
      uploadedPaths.push(imageFile.path);
    }

    const localImagePaths = imageFiles.map((f) => f.path);
    const result = await processVideo(videoFile.path, false, null, false, userId, null, localImagePaths);
    res.json(result);
  } catch (error) {
    console.error('Upload processing failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    for (const filePath of uploadedPaths) {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (cleanupError) {
          console.warn(`Failed to clean upload file ${filePath}: ${cleanupError.message}`);
        }
      }
    }
  }
});

app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(OUTPUT_PUBLIC_DIR, filename);

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(filepath);
});

app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    uploadMode: 'multipart',
    hasStoreUpload: Boolean(process.env.STORE_FILE_URL)
  });
});

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'One of the uploaded files is too large.'
      : err.message;
    return res.status(400).json({ success: false, error: message });
  }

  if (err) {
    console.error('Unhandled server error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }

  next();
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('POST /process-upload (multipart form: video + images[])');
  console.log('POST /process (JSON api)');
  console.log('GET  /download/<filename>');
});
