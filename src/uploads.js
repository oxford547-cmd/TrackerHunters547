'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_LOGO = '/assets/img/hunters547-logo.jpg';
const EMAIL_LOGO_CID = 'logo@hunters547';
const EMAIL_LOGO_FETCH_TIMEOUT_MS = 4000;
const EMAIL_LOGO_MAX_BYTES = 2 * 1024 * 1024;

function appRoot() {
  return path.join(__dirname, '..');
}

function publicRoot() {
  return path.join(appRoot(), 'public');
}

function defaultLogoFile() {
  return path.join(publicRoot(), 'assets', 'img', 'hunters547-logo.jpg');
}

/** Disk root for /uploads. Hostinger Git deploys wipe hbuilds/public_html — set UPLOADS_DIR outside those trees. */
function uploadsRoot() {
  const env = String(process.env.UPLOADS_DIR || '').trim();
  if (env) return path.resolve(env);
  return path.join(publicRoot(), 'uploads');
}

/**
 * Directories Express may serve at /uploads, in lookup order.
 * mountUploads and CID resolution share this list so a 200 on the static
 * route cannot diverge from the file the mailer embeds.
 */
function uploadsCandidateRoots() {
  const roots = [];
  const seen = new Set();
  const add = (dir) => {
    if (!dir) return;
    const abs = path.resolve(dir);
    if (seen.has(abs)) return;
    seen.add(abs);
    roots.push(abs);
  };

  const env = String(process.env.UPLOADS_DIR || '').trim();
  add(uploadsRoot());
  if (env && !path.isAbsolute(env)) {
    add(path.resolve(appRoot(), env));
  }
  add(path.join(publicRoot(), 'uploads'));
  add(path.join(process.cwd(), 'public', 'uploads'));
  add(path.join(process.cwd(), 'uploads'));
  return roots;
}

function ensureUploadDirs() {
  for (const dir of [path.join(uploadsRoot(), 'portals'), path.join(uploadsRoot(), 'deliveries')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isInside(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function existingFile(abs) {
  try {
    return fs.statSync(abs).isFile() ? abs : null;
  } catch (_) {
    return null;
  }
}

function readableFile(abs) {
  const found = existingFile(abs);
  if (!found) return null;
  try {
    fs.accessSync(found, fs.constants.R_OK);
    return found;
  } catch (_) {
    return null;
  }
}

function normalizedPublicRel(urlPath) {
  const raw = String(urlPath || '').trim();
  if (!raw || /^https?:\/\//i.test(raw) || raw.includes('\0')) return null;
  const rel = raw.replace(/^\/+/, '').replace(/\\/g, '/');
  if (!rel || rel.split('/').includes('..')) return null;
  return rel;
}

/**
 * Map a public URL path (/uploads/..., /assets/...) to an existing local file.
 * /uploads is resolved against the same candidate roots as express.static.
 * Returns null for remote URLs, missing files, or path traversal.
 */
function resolveExistingPublicFile(urlPath) {
  const rel = normalizedPublicRel(urlPath);
  if (!rel) return null;

  if (rel === 'uploads' || rel.startsWith('uploads/')) {
    const rest = rel === 'uploads' ? '' : rel.slice('uploads/'.length);
    for (const root of uploadsCandidateRoots()) {
      const abs = path.resolve(root, rest);
      if (!isInside(root, abs)) continue;
      const found = existingFile(abs);
      if (found) return found;
    }
    return null;
  }

  const abs = path.resolve(publicRoot(), rel);
  if (!isInside(publicRoot(), abs)) return null;
  return existingFile(abs);
}

function mimeForImage(filePath) {
  const ext = path.extname(String(filePath || '').split('?')[0]).toLowerCase();
  return (
    {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    }[ext] || 'application/octet-stream'
  );
}

function emailLogoAttachment(filePath, buffer, contentType) {
  const filename = path.basename(String(filePath || '').split('?')[0]) || 'logo';
  const att = {
    filename,
    cid: EMAIL_LOGO_CID,
    contentType: contentType || mimeForImage(filePath),
    contentDisposition: 'inline',
  };
  if (buffer) att.content = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  else att.path = filePath;
  return att;
}

function publicUrlFor(urlPath) {
  const raw = String(urlPath || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!base) return '';
  const rel = raw.startsWith('/') ? raw : `/${raw}`;
  return `${base}${rel}`;
}

function huntersFallbackLogo() {
  const fallback = defaultLogoFile();
  try {
    if (fs.statSync(fallback).isFile()) {
      return { src: `cid:${EMAIL_LOGO_CID}`, attachment: emailLogoAttachment(fallback), fromPortal: false };
    }
  } catch (_) {
    /* no bundled fallback */
  }
  return { src: '', attachment: null, fromPortal: false };
}

function resolvePortalLogoLocal(portal) {
  const raw = portal ? String(portal.logo_path || '').trim() : '';
  if (raw && /^https?:\/\//i.test(raw)) {
    return { src: raw, attachment: null, fromPortal: true };
  }
  if (raw) {
    const local = resolveExistingPublicFile(raw);
    if (local && readableFile(local)) {
      return {
        src: `cid:${EMAIL_LOGO_CID}`,
        attachment: emailLogoAttachment(local),
        fromPortal: true,
      };
    }
  }
  return null;
}

async function fetchPortalLogoBytes(urlPath) {
  const url = publicUrlFor(urlPath);
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const fetchFn = globalThis.fetch;
  if (typeof fetchFn !== 'function') return null;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), EMAIL_LOGO_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: ac.signal, redirect: 'follow' });
    if (!res || !res.ok) return null;
    const ctype = String((res.headers && res.headers.get && res.headers.get('content-type')) || '');
    if (ctype && !/^image\//i.test(ctype) && !/octet-stream/i.test(ctype)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > EMAIL_LOGO_MAX_BYTES) return null;
    return {
      buffer: buf,
      contentType: (ctype.split(';')[0] || '').trim() || mimeForImage(urlPath),
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Email header logo: CID when a portal file exists (disk, same roots as static,
 * else HTTP bytes from PUBLIC_BASE_URL + logo_path). Hunters 547 only when
 * logo_path is empty or the portal file cannot be read after those lookups.
 * Remote https logo_path is kept as-is. Never hotlinks a missing /uploads file.
 */
async function resolveEmailLogo(portal) {
  const raw = portal ? String(portal.logo_path || '').trim() : '';
  const local = resolvePortalLogoLocal(portal);
  if (local) return local;
  if (raw && !/^https?:\/\//i.test(raw)) {
    const fetched = await fetchPortalLogoBytes(raw);
    if (fetched) {
      return {
        src: `cid:${EMAIL_LOGO_CID}`,
        attachment: emailLogoAttachment(raw, fetched.buffer, fetched.contentType),
        fromPortal: true,
      };
    }
  }
  return huntersFallbackLogo();
}

function resolveEmailLogoSync(portal) {
  return resolvePortalLogoLocal(portal) || huntersFallbackLogo();
}

function mountUploads(app) {
  const express = require('express');
  const staticOpts = { index: false, fallthrough: true, redirect: false };
  for (const root of uploadsCandidateRoots()) {
    app.use('/uploads', express.static(root, staticOpts));
  }
}

module.exports = {
  DEFAULT_LOGO,
  EMAIL_LOGO_CID,
  publicRoot,
  defaultLogoFile,
  uploadsRoot,
  uploadsCandidateRoots,
  ensureUploadDirs,
  resolveExistingPublicFile,
  publicUrlFor,
  resolveEmailLogo,
  resolveEmailLogoSync,
  mountUploads,
};
