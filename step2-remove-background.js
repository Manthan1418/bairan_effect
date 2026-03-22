const fs = require('fs');
const path = require('path');
const { fal } = require("@fal-ai/client");

const workDir = process.argv[2] || '.';
const OUTPUT_DIR = path.join(workDir, 'output');
const INPUT_IMAGE = path.join(OUTPUT_DIR, 'last-frame.png');
const BG_REMOVED_IMAGE = path.join(OUTPUT_DIR, 'bg-removed.png');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function removeBackgroundWithFal(imagePath) {
  console.log('Removing background using fal.ai Bria service...');
  console.log(`Input: ${imagePath}`);

  if (!process.env.FAL_KEY) {
    console.warn('FAL_KEY is not set. Using original image as fallback for step 2.');
    fs.copyFileSync(imagePath, BG_REMOVED_IMAGE);
    return BG_REMOVED_IMAGE;
  }
  
  try {
    // Read the image file
    console.log('Reading image file...');
    const imageBuffer = fs.readFileSync(imagePath);
    
    // Convert to base64 data URI
    const base64Image = imageBuffer.toString('base64');
    const mimeType = 'image/png';
    const imageUrl = `data:${mimeType};base64,${base64Image}`;
    
    console.log('Uploading to fal.ai and processing...');
    
    // Call fal.ai background removal API
    const result = await fal.subscribe("fal-ai/bria/background/remove", {
      input: {
        image_url: imageUrl
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          update.logs.map((log) => log.message).forEach(console.log);
        }
      },
    });
    
    console.log('Processing complete!');
    console.log(`Request ID: ${result.requestId}`);
    
    // Download the result image
    if (result.data && result.data.image && result.data.image.url) {
      console.log('Downloading result image...');
      const response = await fetch(result.data.image.url);
      const resultBuffer = Buffer.from(await response.arrayBuffer());
      
      // Save the result
      fs.writeFileSync(BG_REMOVED_IMAGE, resultBuffer);
      
      console.log(`✅ Background removed successfully!`);
      console.log(`📁 Saved to: ${BG_REMOVED_IMAGE}`);
      console.log(`📐 Image dimensions: ${result.data.image.width}x${result.data.image.height}`);
      
      return BG_REMOVED_IMAGE;
    } else {
      throw new Error('No image URL in response');
    }
    
  } catch (error) {
    console.error('❌ Background removal failed:', error.message);
    console.warn('Falling back to original image for step 2 output.');
    fs.copyFileSync(imagePath, BG_REMOVED_IMAGE);
    return BG_REMOVED_IMAGE;
  }
}

console.log('🎨 Step 2: Removing background from last frame...');
console.log(`WorkDir: ${workDir}`);

removeBackgroundWithFal(INPUT_IMAGE)
  .then(() => {
    console.log('\n✨ Step 2 complete!');
    console.log(`Next: Add thick white borders to ${BG_REMOVED_IMAGE}`);
  })
  .catch((err) => {
    console.error('❌ Step 2 failed:', err.message);
    console.error(err);
    process.exit(1);
  });
