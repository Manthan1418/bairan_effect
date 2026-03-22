# Video Template Automation

Create dynamic videos with a freeze frame transition, background removal, and slideshow effect.

## Project Structure

```
bairantool/
├── middle-images/          # Images for slideshow
├── output/                 # Generated output files
├── rosh-freeze.MP4         # Main source video
├── middle-video.mp4        # (Optional) Middle video source
├── ffmpeg                  # FFmpeg binary (macOS)
├── ffprobe                 # FFprobe binary (macOS)
├── step1-extract-last-frame.js
├── step2-remove-background.js
├── step3-add-borders.js
├── step4-compose-video.js
├── create-middle-slideshow.js
├── server.js               # API Server
└── package.json
```

## Setup

```bash
npm install
```

## Usage

### API Server (Recommended)

Start the server:
```bash
npm start
```

Server runs on `http://localhost:3001`

#### Process Video

```bash
curl -X POST http://localhost:3001/process \
  -H "Content-Type: application/json" \
  -d '{
    "videoPath": "path/to/video.mp4",
    "isUrl": false
  }'
```

Or with a URL:
```bash
curl -X POST http://localhost:3001/process \
  -H "Content-Type: application/json" \
  -d '{
    "videoPath": "https://example.com/video.mp4",
    "isUrl": true
  }'
```

With zip of images:
```bash
curl -X POST http://localhost:3001/process \
  -H "Content-Type: application/json" \
  -d '{
    "videoPath": "path/to/video.mp4",
    "isUrl": false,
    "zipPath": "path/to/images.zip",
    "zipUrl": false
  }'
```

Or all URLs:
```bash
curl -X POST http://localhost:3001/process \
  -H "Content-Type: application/json" \
  -d '{
    "videoPath": "https://example.com/video.mp4",
    "isUrl": true,
    "zipPath": "https://example.com/images.zip",
    "zipUrl": true
  }'
```

#### Response

```json
{
  "success": true,
  "outputPath": "output/final-video.mp4",
  "outputUrl": "/download/final-video.mp4"
}
```

#### Download Output

```bash
curl -O http://localhost:3001/download/final-video.mp4
```

---

### Local Usage

### 1. Prepare Images (Optional)

Place images in `middle-images/` folder. Supports JPG, PNG, HEIC.

### 2. Create Slideshow (Optional)

```bash
npm run slideshow
```

Creates `output/middle-slideshow.mp4` - a looping slideshow from images (9s duration, 0.2s per image).

### 3. Run Pipeline

```bash
npm run step1   # Extract last frame from video
npm run step2   # Remove background from frame
npm run step3   # Add borders to create sticker
npm run step4   # Compose final video
```

Or run all at once:
```bash
npm run step1 && npm run step2 && npm run step3 && npm run step4
```

## Step Details

| Step | Output | Description |
|------|--------|-------------|
| 1 | `output/last-frame.png` | Extracts the last frame from `rosh-freeze.MP4` |
| 2 | `output/bg-removed.png` | Removes background using AI |
| 3 | `output/bordered-image.png` | Adds white/black borders creating a sticker |
| 4 | `output/final-video.mp4` | Composites everything with center-out curtain effect |

## Configuration

### Middle Video Source (step4)
- If `output/middle-slideshow.mp4` exists → uses slideshow
- Otherwise → uses `middle-video.mp4`

### Slideshow Settings (create-middle-slideshow.js)
- Duration: 9 seconds
- Per-image duration: 0.2 seconds
- Resolution: 1080x1920 (vertical)
- Loops through images to fill duration

## Requirements

- macOS (uses `sips` for image conversion)
- Node.js dependencies (installed via `npm install`)

## API Server

Start the API server:

```bash
npm start
```

Server runs on `http://localhost:3001`

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/process` | Process a video |
| GET | `/download/:filename` | Download output file |
| GET | `/status` | Check server status |

### Process Request

```bash
curl -X POST http://localhost:3001/process \
  -H "Content-Type: application/json" \
  -d '{
    "videoPath": "path/to/video.mp4",
    "isUrl": false,
    "zipPath": "path/to/images.zip",
    "zipUrl": false
  }'
```

With URLs:
```bash
curl -X POST http://localhost:3001/process \
  -H "Content-Type: application/json" \
  -d '{
    "videoPath": "https://example.com/video.mp4",
    "isUrl": true,
    "zipPath": "https://example.com/images.zip",
    "zipUrl": true
  }'
```

### Response

```json
{
  "success": true,
  "outputPath": "output/final-video.mp4",
  "outputUrl": "/download/final-video.mp4"
}
```

### Download Output

```bash
curl -O http://localhost:3001/download/final-video.mp4
```
