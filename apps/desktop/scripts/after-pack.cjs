// electron-builder afterPack hook: drop native binaries built for other platforms.
// Done here instead of per-platform `files` lists, which made electron-builder copy
// some files twice concurrently (EBUSY on Windows).
const fs = require('node:fs');
const path = require('node:path');

const KEEP = { win32: 'win32', darwin: 'darwin', linux: 'linux' };

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName; // 'win32' | 'darwin' | 'linux'
  const keep = KEEP[platform];
  const appDir = platform === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'app')
    : path.join(context.appOutDir, 'resources', 'app');
  const scopes = [
    { dir: path.join(appDir, 'node_modules', '@node-rs'), prefix: 'argon2-' },
    { dir: path.join(appDir, 'node_modules', '@img'), prefix: 'sharp-' },
  ];
  let removed = 0;
  for (const { dir, prefix } of scopes) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(prefix)) continue;
      const rest = name.slice(prefix.length); // e.g. win32-x64-msvc, libvips-darwin-arm64, darwin-x64
      const target = rest.replace(/^libvips-/, '');
      const os = ['win32', 'darwin', 'linux', 'linuxmusl', 'wasm32'].find((o) => target.startsWith(o));
      if (!os || os === keep) continue;
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      removed++;
    }
  }
  console.log(`afterPack: removed ${removed} native packages not built for ${platform}`);
};
