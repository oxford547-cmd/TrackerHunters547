'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const {
  uploadsRoot,
  uploadsCandidateRoots,
  resolveExistingPublicFile,
  resolveEmailLogo,
  resolveEmailLogoSync,
  publicUrlFor,
  EMAIL_LOGO_CID,
  DEFAULT_LOGO,
  defaultLogoFile,
  publicRoot,
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

test('uploadsCandidateRoots antepone UPLOADS_DIR y coincide con el static root', () => {
  const roots = uploadsCandidateRoots();
  assert.equal(roots[0], path.resolve(tmpRoot));
  assert.ok(roots.includes(path.join(publicRoot(), 'uploads')));
});

test('resolveExistingPublicFile no inventa un archivo ausente', () => {
  assert.equal(resolveExistingPublicFile('/uploads/portals/2/logo.png'), null);
  assert.equal(resolveExistingPublicFile('/uploads/../package.json'), null);
  assert.equal(resolveExistingPublicFile('https://cdn.example/logo.png'), null);
});

test('resolveExistingPublicFile encuentra logo bajo UPLOADS_DIR aunque falte en public/uploads', () => {
  const dest = path.join(tmpRoot, 'portals', '2');
  fs.mkdirSync(dest, { recursive: true });
  const file = path.join(dest, 'logo.png');
  fs.writeFileSync(file, PNG_1X1);
  assert.equal(resolveExistingPublicFile('/uploads/portals/2/logo.png'), file);
  assert.equal(resolveExistingPublicFile('uploads/portals/2/logo.png'), file);
  assert.notEqual(file, path.join(publicRoot(), 'uploads', 'portals', '2', 'logo.png'));
  assert.equal(fs.existsSync(path.join(publicRoot(), 'uploads', 'portals', '2', 'logo.png')), false);
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

test('resolveEmailLogo usa CID del archivo local del portal', async () => {
  const dest = path.join(tmpRoot, 'portals', '99');
  fs.mkdirSync(dest, { recursive: true });
  const file = path.join(dest, 'logo.png');
  fs.writeFileSync(file, PNG_1X1);
  const logo = await resolveEmailLogo({ name: 'Marca ACME', logo_path: '/uploads/portals/99/logo.png' });
  assert.equal(logo.src, `cid:${EMAIL_LOGO_CID}`);
  assert.equal(logo.attachment.path, file);
  assert.equal(logo.attachment.cid, EMAIL_LOGO_CID);
  assert.equal(logo.attachment.contentType, 'image/png');
  assert.equal(logo.attachment.contentDisposition, 'inline');
  assert.equal(logo.fromPortal, true);
  assert.notEqual(logo.attachment.path, defaultLogoFile());
});

test('resolveEmailLogo no hotlinkea /uploads faltante; CID del fallback si HTTP falla', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 404 });
  try {
    const logo = await resolveEmailLogo({ name: 'Marca ACME', logo_path: '/uploads/portals/2/logo.png' });
    assert.equal(logo.src, `cid:${EMAIL_LOGO_CID}`);
    assert.equal(logo.attachment.path, defaultLogoFile());
    assert.equal(logo.fromPortal, false);
    assert.doesNotMatch(logo.src, /uploads/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('logoUrl del portal cae al default si el archivo no está en disco', () => {
  assert.equal(logoUrl({ logo_path: '/uploads/portals/2/logo.png' }), DEFAULT_LOGO);
  const dest = path.join(tmpRoot, 'portals', '99');
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'logo.png'), PNG_1X1);
  assert.equal(logoUrl({ logo_path: '/uploads/portals/99/logo.png' }), '/uploads/portals/99/logo.png');
});

test('buildOrderMessage incrusta CID del logo del portal cuando el archivo existe', async () => {
  const dest = path.join(tmpRoot, 'portals', '99');
  fs.mkdirSync(dest, { recursive: true });
  const file = path.join(dest, 'logo.png');
  fs.writeFileSync(file, PNG_1X1);
  const msg = await buildOrderMessage(
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

test('GET /uploads y resolveExistingPublicFile leen el mismo archivo', async () => {
  ensureUploadDirs();
  const dest = path.join(tmpRoot, 'portals', '2');
  fs.mkdirSync(dest, { recursive: true });
  const file = path.join(dest, 'logo.png');
  fs.writeFileSync(file, PNG_1X1);

  const app = express();
  mountUploads(app);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/uploads/portals/2/logo.png`);
    assert.equal(res.status, 200);
    const fromHttp = Buffer.from(await res.arrayBuffer());
    const fromHelper = resolveExistingPublicFile('/uploads/portals/2/logo.png');
    assert.equal(fromHelper, file);
    assert.deepEqual(fromHttp, fs.readFileSync(fromHelper));
    assert.deepEqual(fromHttp, PNG_1X1);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('si el disco del CID falla, embebe bytes servidos en PUBLIC_BASE_URL', async () => {
  const servedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h547-http-logo-'));
  try {
    const dest = path.join(servedRoot, 'portals', '2');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'logo.png'), PNG_1X1);

    const app = express();
    app.use('/uploads', express.static(servedRoot, { index: false, fallthrough: true, redirect: false }));
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const { port } = server.address();
      process.env.PUBLIC_BASE_URL = `http://127.0.0.1:${port}`;
      assert.equal(resolveExistingPublicFile('/uploads/portals/2/logo.png'), null);

      const logo = await resolveEmailLogo({ name: 'Marca ACME', logo_path: '/uploads/portals/2/logo.png' });
      assert.equal(logo.src, `cid:${EMAIL_LOGO_CID}`);
      assert.equal(logo.fromPortal, true);
      assert.equal(logo.attachment.filename, 'logo.png');
      assert.ok(logo.attachment.content);
      assert.deepEqual(logo.attachment.content, PNG_1X1);
      assert.notEqual(logo.attachment.path, defaultLogoFile());
      assert.equal(logo.attachment.path, undefined);

      const msg = await buildOrderMessage(
        { tracking_code: 'H547-LOGO-840646', status: 'en_camino' },
        { name: 'Marca ACME', logo_path: '/uploads/portals/2/logo.png' }
      );
      assert.match(msg.html, new RegExp(`src="cid:${EMAIL_LOGO_CID}"`));
      assert.doesNotMatch(msg.html, /src="https?:\/\//i);
      assert.equal(msg.attachments[0].filename, 'logo.png');
      assert.deepEqual(msg.attachments[0].content, PNG_1X1);
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  } finally {
    fs.rmSync(servedRoot, { recursive: true, force: true });
  }
});

test('resolveEmailLogoSync no trata logo_path como ausente si UPLOADS_DIR lo tiene', () => {
  const dest = path.join(tmpRoot, 'portals', '2');
  fs.mkdirSync(dest, { recursive: true });
  const file = path.join(dest, 'logo.png');
  fs.writeFileSync(file, PNG_1X1);
  const logo = resolveEmailLogoSync({ name: 'Marca ACME', logo_path: '/uploads/portals/2/logo.png' });
  assert.equal(logo.fromPortal, true);
  assert.equal(logo.attachment.path, file);
});

test('CID y static usan public/uploads cuando UPLOADS_DIR no tiene el archivo', async () => {
  const pubDir = path.join(publicRoot(), 'uploads', 'portals', 'cid-tmp-2');
  fs.mkdirSync(pubDir, { recursive: true });
  const file = path.join(pubDir, 'logo.png');
  try {
    fs.writeFileSync(file, PNG_1X1);
    assert.equal(resolveExistingPublicFile('/uploads/portals/cid-tmp-2/logo.png'), file);
    const logo = resolveEmailLogoSync({
      name: 'Marca ACME',
      logo_path: '/uploads/portals/cid-tmp-2/logo.png',
    });
    assert.equal(logo.fromPortal, true);
    assert.equal(logo.attachment.path, file);
    assert.notEqual(logo.attachment.path, defaultLogoFile());

    const app = express();
    mountUploads(app);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const { port } = server.address();
      const res = await fetch(`http://127.0.0.1:${port}/uploads/portals/cid-tmp-2/logo.png`);
      assert.equal(res.status, 200);
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG_1X1);
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  } finally {
    fs.rmSync(pubDir, { recursive: true, force: true });
  }
});
