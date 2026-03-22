const form = document.getElementById('processForm');
const submitBtn = document.getElementById('submitBtn');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const outputWrap = document.getElementById('outputWrap');
const outputVideo = document.getElementById('outputVideo');
const downloadLink = document.getElementById('downloadLink');

function setStatus(kind, message) {
  statusEl.className = `status ${kind}`;
  statusEl.textContent = message;
}

function resetOutput() {
  resultEl.hidden = true;
  outputWrap.hidden = true;
  outputVideo.removeAttribute('src');
  downloadLink.setAttribute('href', '#');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  resetOutput();

  const videoInput = document.getElementById('videoInput');
  const imagesInput = document.getElementById('imagesInput');
  const userIdInput = document.getElementById('userIdInput');

  if (!videoInput.files || videoInput.files.length === 0) {
    setStatus('error', 'Please choose a video file.');
    return;
  }

  const payload = new FormData();
  payload.append('video', videoInput.files[0]);

  if (imagesInput.files && imagesInput.files.length > 0) {
    for (const imageFile of imagesInput.files) {
      payload.append('images', imageFile);
    }
  }

  if (userIdInput.value.trim()) {
    payload.append('userId', userIdInput.value.trim());
  }

  submitBtn.disabled = true;
  setStatus('running', 'Processing started. This can take a few minutes...');

  try {
    const response = await fetch('/process-upload', {
      method: 'POST',
      body: payload
    });

    const data = await response.json();
    resultEl.hidden = false;
    resultEl.textContent = JSON.stringify(data, null, 2);

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Pipeline failed');
    }

    const outputUrl = data.outputUrl || data.fileUrl;
    if (outputUrl) {
      outputWrap.hidden = false;
      outputVideo.src = outputUrl;
      downloadLink.href = outputUrl;
    }

    setStatus('success', 'Done. Your video is ready.');
  } catch (error) {
    setStatus('error', `Failed: ${error.message}`);
  } finally {
    submitBtn.disabled = false;
  }
});

setStatus('idle', 'Idle');
