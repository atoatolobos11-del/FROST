/**
 * Tiny zero-dependency static server for Frost Breakout.
 *
 *   node tools/serve.mjs          -> http://localhost:8080
 *   node tools/serve.mjs 3000     -> http://localhost:3000
 *
 * Binds all interfaces and prints the LAN address too, so you can open the
 * game on a phone that's on the same Wi-Fi.
 *
 * Opening index.html directly works too, but browsers refuse to fetch()
 * local files over file://, so the game falls back to its built-in synth
 * sounds. Serving over http gives you the authored WAV samples.
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2]) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const server = createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';

  /* keep requests inside ROOT */
  const target = normalize(join(ROOT, rel));
  if (!target.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let st;
  try {
    st = statSync(target);
    if (st.isDirectory()) throw new Error('dir');
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('404 Not Found: ' + rel);
    return;
  }

  res.writeHead(200, {
    'content-type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
    'content-length': st.size,
    'cache-control': 'no-cache',
  });
  createReadStream(target).pipe(res);
});

/** LAN IPv4 addresses so a phone on the same Wi-Fi can connect. */
function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

server.listen(PORT, () => {
  const lan = lanAddresses();
  console.log('');
  console.log('  Frost Breakout  \u2744\ufe0f');
  console.log('');
  console.log(`  On this computer:  http://localhost:${PORT}`);
  if (lan.length) {
    console.log('');
    console.log('  On your phone (same Wi-Fi):');
    for (const ip of lan) console.log(`    \u2192  http://${ip}:${PORT}`);
  } else {
    console.log('');
    console.log('  No network interface found - phone access unavailable.');
  }
  console.log('');
  console.log('  Keep this window open. Ctrl+C to stop.');
  console.log('');
});