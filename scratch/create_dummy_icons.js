const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '../extention/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// 1x1 transparent pixel PNG base64
const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const buffer = Buffer.from(base64Png, 'base64');

fs.writeFileSync(path.join(iconsDir, 'icon16.png'), buffer);
fs.writeFileSync(path.join(iconsDir, 'icon48.png'), buffer);
fs.writeFileSync(path.join(iconsDir, 'icon128.png'), buffer);

console.log('Dummy icons generated successfully.');
