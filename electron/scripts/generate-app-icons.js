#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let createCanvas = null;
try {
  ({ createCanvas } = require('canvas'));
} catch (_) {
  createCanvas = null;
}

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'build', 'icons');
const iconsetDir = path.join(outDir, 'icon.iconset');
const svgPath = path.join(root, 'renderer', 'assets', 'icons', 'clara-logo.svg');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' });
}

function hasCommand(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runMagick(args) {
  if (hasCommand('magick')) {
    run('magick', args);
    return;
  }
  run('convert', args);
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawClaraIcon(size) {
  if (!createCanvas) return null;
  const s = size / 1024;
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const visualScale = 0.9;
  const inset = (size * (1 - visualScale)) / 2;

  ctx.save();
  ctx.translate(inset, inset);
  ctx.scale(visualScale, visualScale);

  // Outer rounded square background.
  roundedRectPath(ctx, 0, 0, size, size, 216 * s);
  ctx.fillStyle = '#EAF2FF';
  ctx.fill();

  // Paper.
  roundedRectPath(ctx, 220 * s, 170 * s, 596 * s, 700 * s, 76 * s);
  ctx.fillStyle = 'rgba(159,176,203,0.28)';
  ctx.fill();

  roundedRectPath(ctx, 214 * s, 164 * s, 596 * s, 700 * s, 76 * s);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = Math.max(4 * s, 1.5);
  ctx.strokeStyle = '#8FA4C3';
  ctx.stroke();

  // Folded corner.
  ctx.beginPath();
  ctx.moveTo(702 * s, 164 * s);
  ctx.lineTo(810 * s, 164 * s);
  ctx.lineTo(810 * s, 272 * s);
  ctx.quadraticCurveTo(772 * s, 260 * s, 746 * s, 234 * s);
  ctx.quadraticCurveTo(720 * s, 208 * s, 702 * s, 164 * s);
  ctx.closePath();
  ctx.fillStyle = '#E6EEFA';
  ctx.fill();

  // Text lines.
  const lines = [
    [322, 304, 384, 24],
    [322, 372, 332, 24],
    [322, 440, 372, 24],
    [322, 508, 286, 24],
    [322, 576, 354, 24],
    [322, 644, 262, 24]
  ];
  ctx.fillStyle = '#A8BAD7';
  for (const [x, y, w, h] of lines) {
    roundedRectPath(ctx, x * s, y * s, w * s, h * s, 12 * s);
    ctx.fill();
  }

  // Highlight word.
  roundedRectPath(ctx, 360 * s, 430 * s, 184 * s, 48 * s, 24 * s);
  ctx.fillStyle = '#F7D35F';
  ctx.fill();

  ctx.restore();
  return c;
}

function renderPng(size, outFile) {
  const canvas = drawClaraIcon(size);
  if (canvas) {
    fs.writeFileSync(outFile, canvas.toBuffer('image/png'));
    return;
  }
  runMagick(['-background', 'none', svgPath, '-resize', `${size}x${size}`, outFile]);
}

function generatePngs() {
  ensureDir(outDir);
  ensureDir(iconsetDir);

  const baseSizes = [16, 32, 64, 128, 256, 512, 1024];
  for (const size of baseSizes) {
    renderPng(size, path.join(outDir, `icon_${size}x${size}.png`));
  }

  const iconsetMap = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png']
  ];

  for (const [size, filename] of iconsetMap) {
    renderPng(size, path.join(iconsetDir, filename));
  }
}

function generateIcns() {
  const icnsOut = path.join(outDir, 'icon.icns');
  try {
    run('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsOut]);
  } catch (err) {
    console.warn('[icons] iconutil failed, trying ImageMagick fallback:', err.message);
    try {
      if (fs.existsSync(icnsOut)) {
        fs.unlinkSync(icnsOut);
      }
      runMagick([path.join(outDir, 'icon_1024x1024.png'), icnsOut]);
    } catch (fallbackErr) {
      if (fs.existsSync(icnsOut)) {
        fs.unlinkSync(icnsOut);
      }
      console.warn('[icons] icns fallback failed, skipping icns:', fallbackErr.message);
    }
  }
}

function generateIco() {
  runMagick([
    path.join(outDir, 'icon_256x256.png'),
    path.join(outDir, 'icon_128x128.png'),
    path.join(outDir, 'icon_64x64.png'),
    path.join(outDir, 'icon_32x32.png'),
    path.join(outDir, 'icon_16x16.png'),
    path.join(outDir, 'icon.ico')
  ]);
}

function generateTaskbarIcon() {
  // Keep dock/taskbar icon consistent with primary app icon.
  fs.copyFileSync(
    path.join(outDir, 'icon_512x512.png'),
    path.join(outDir, 'dock_icon_512x512.png')
  );
}

function main() {
  generatePngs();
  generateIcns();
  generateIco();
  generateTaskbarIcon();
  console.log('[icons] Clara icon set generated in build/icons');
}

main();
