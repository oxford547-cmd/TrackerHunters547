'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const {
  uploadsRoot,
  resolveExistingPublicFile,
  resolveEmailLogo,
  publicUrlFor,
  EMAIL_LOGO_CID,
  DEFAULT_LOGO,
  defaultLogoFile,
  mountUploads,
  ensureUploadDirs,
} = require('../src/uploads');
const { logoUrl } = require('../src/portal');
const { buildOrderMessage } = require('../src/services/email');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let tmpRoot;

beforeEach(() => {
  delete process.env.PUBLIC_BASE_URL;
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h547-uploads-'));
  process.env.UPLOADS_DIR = tmpRoot;
});

afterEach(() => {
  delete process.env.UPLOADS_DIR;
  delete process.env.PUBLIC_BASE_URL;
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
});

test('uploadsRoot respeta UPLOADS_DIR', () => {
  assert.equal(uploadsRoot(), path.resolve(tmpRoot));
});

test('resolveExistingPublicFile no inventa un archivo ausente', () => {
  assert.equal(resolveExistingPublicFile('/uploads/portals/2/logo.png'), null);
  assert.equal(resolveExistingPublicFile('/uploads/../package.json'), null);
  assert.equal(resolveExistingPublicFile('https://cdn.example/logo.png'), null);
});

test('resolveExistingPublicFile encuentra logo bajo UPLOADS_DIR', () => {
  const dest = path.join(tmpRoot, 'portals', '99');
  fs.mkdirSync(dest, { recursive: true });
  const file = path.join(dest, 'logo.png');
  fs.writeFileSync(file, PNG_1X1);
  assert.equal(resolveExistingPublicFile('/uploads/portals/99/logo.png'), file);
  assert.equal(resolveExistingPublicFile('uploads/portals/99/logo.png'), file);
});

test('resolveExistingPublicFile sirve el logo Hunters 547 del repo', () => {
  assert.equal(resolveExistingPublicFile(DEFAULT_LOGO), defaultLogoFile());
});

test('publicUrlFor arma la URL pública solo como referencia, no valida el archivo', () => {
  process.env.PUBLIC_BASE_URL = 'https://www.hunters547.cloud/';
  assert.equal(
    publicUrlFor('/uploads/portals/2/logo.png'),
    'https://www.hunters547.cloud/uploads/portals/2/logo.png'
  );
  assert.equal(publicUrlFor('https://cdn.example/a.png'), 'https://cdn.example/a.png');
});

test('resolveEmailLogo usa CID del archivo local del portal', () => {
  const dest = path.join(tmpRoot, 'portals', '99');
  fs.mkdirSync(dest, { recursive: true });
  const file = path.join(dest, 'logo.png');
  fs.writeFileSync(file, PNG_1X1);
  const logo = resolveEmailLogo({ name: 'Marca ACME', logo_path: '/uploads/portals/99/logo.png' });
  assert.equal(logo.src, `cid:${EMAIL_LOGO_CID}`);
  assert.equal(logo.attachment.path, file);
  assert.equal(logo.attachment.cid, EMAIL_LOGO_CID);
  assert.equal(logo.attachment.contentType, 'image/png');
  assert.equal(logo.attachment.contentDisposition, 'inline');
});

test('resolveEmailLogo no hotlinkea /uploads faltante; CID del fallback', () => {
  const logo = resolveEmailLogo({ name: 'Marca ACME', logo_path: '/uploads/portals/2/logo.png' });
  assert.equal(logo.src, `cid:${EMAIL_LOGO_CID}`);
  assert.equal(logo.attachment.path, defaultLogoFile());
  assert.doesNotMatch(logo.src, /uploads/);
});

test('logoUrl del portal cae al default si el archivo no está en disco', () => {
  assert.equal(logoUrl({ logo_path: '/uploads/portals/2/logo.png' }), DEFAULT_LOGO);
  const dest = path.join(tmpRoot, 'portals', '99');
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'logo.png'), PNG_1X1);
  assert.equal(logoUrl({ logo_path: '/uploads/portals/99/logo.png' }), '/uploads/portals/99/logo.png');
});

test('buildOrderMessage incrusta CID del logo del portal cuando el archivo existe', () => {
  const dest = path.join(tmpRoot, 'portals', '99');
  fs.mkdirSync(dest, { recursive: true });
  const file = path.join(dest, 'logo.png');
  fs.writeFileSync(file, PNG_1X1);
  const msg = buildOrderMessage(
    { tracking_code: 'H547-HTML-839852', status: 'en_preparacion' },
    { name: 'Marca ACME', logo_path: '/uploads/portals/99/logo.png' }
  );
  assert.match(msg.html, /alt="Marca ACME"/);
  assert.match(msg.html, new RegExp(`src="cid:${EMAIL_LOGO_CID}"`));
  assert.doesNotMatch(msg.html, /src="https?:\/\//i);
  assert.doesNotMatch(msg.html, /\/uploads\/portals\//);
  assert.equal(msg.attachments[0].path, file);
});

test('GET /uploads sirve archivos desde UPLOADS_DIR', async () => {
  ensureUploadDirs();
  const dest = path.join(tmpRoot, 'portals', '99');
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'logo.png'), PNG_1X1);

  const app = express();
  mountUploads(app);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/uploads/portals/99/logo.png`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /image\/png/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(buf, PNG_1X1);

    const missing = await fetch(`http://127.0.0.1:${port}/uploads/portals/2/logo.png`);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
