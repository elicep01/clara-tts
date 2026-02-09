#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'build', 'icons');
const iconsetDir = path.join(outDir, 'icon.iconset');
const svgPath = path.join(root, 'renderer', 'assets', 'icons', 'clara-logo.svg');
const taskbarSvgPath = path.join(root, 'renderer', 'assets', 'icons', 'clara-taskbar.svg');

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

function renderPng(size, outFile) {
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
    if (fs.existsSync(icnsOut)) {
      fs.unlinkSync(icnsOut);
    }
    console.warn('[icons] iconutil failed, skipping icns:', err.message);
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
  if (!fs.existsSync(taskbarSvgPath)) return;
  renderPngFrom(taskbarSvgPath, 512, path.join(outDir, 'dock_icon_512x512.png'));
}

function renderPngFrom(sourceSvg, size, outFile) {
  runMagick(['-background', 'none', sourceSvg, '-resize', `${size}x${size}`, outFile]);
}

function main() {
  if (!fs.existsSync(svgPath)) {
    console.error(`[icons] Missing source SVG at ${svgPath}`);
    process.exit(1);
  }
  generatePngs();
  generateIcns();
  generateIco();
  generateTaskbarIcon();
  console.log('[icons] Clara icon set generated in build/icons');
}

main();
