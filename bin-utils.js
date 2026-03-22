const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function commandWorks(command) {
  try {
    const result = spawnSync(command, ['-version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch (error) {
    return false;
  }
}

function findWingetBinary(binaryName) {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;

  const packagesDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(packagesDir)) return null;

  const packageDirs = fs.readdirSync(packagesDir)
    .filter((dir) => dir.toLowerCase().startsWith('gyan.ffmpeg_'));

  for (const pkgDir of packageDirs) {
    const fullPackagePath = path.join(packagesDir, pkgDir);
    const nestedDirs = fs.readdirSync(fullPackagePath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    for (const nested of nestedDirs) {
      const candidate = path.join(fullPackagePath, nested, 'bin', `${binaryName}.exe`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return null;
}

function resolveBinary(binaryName) {
  const envKey = binaryName === 'ffprobe' ? 'FFPROBE_PATH' : 'FFMPEG_PATH';
  const envPath = process.env[envKey];
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  if (commandWorks(binaryName)) {
    return binaryName;
  }

  const windowsCandidates = [
    path.join('C:', 'ffmpeg', 'bin', `${binaryName}.exe`),
    path.join('C:', 'Program Files', 'ffmpeg', 'bin', `${binaryName}.exe`),
    findWingetBinary(binaryName)
  ].filter(Boolean);

  for (const candidate of windowsCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return binaryName;
}

module.exports = {
  resolveBinary
};
