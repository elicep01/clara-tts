const fs = require('fs');
const path = require('path');

const releaseDir = path.join(__dirname, '..', 'release');
const stableName = 'Clara-Installer.dmg';
const stablePath = path.join(releaseDir, stableName);

if (!fs.existsSync(releaseDir)) {
  console.error('[DMG] release/ directory not found. Run a dist command first.');
  process.exit(1);
}

const dmgFiles = fs
  .readdirSync(releaseDir)
  .filter((f) => f.toLowerCase().endsWith('.dmg'))
  .map((f) => path.join(releaseDir, f))
  .filter((p) => path.basename(p) !== stableName);

if (dmgFiles.length === 0) {
  console.error('[DMG] No DMG file found in release/.');
  process.exit(1);
}

dmgFiles.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
const latest = dmgFiles[0];

fs.copyFileSync(latest, stablePath);
console.log(`[DMG] Stable installer ready: ${stablePath}`);
console.log(`[DMG] Source: ${latest}`);
