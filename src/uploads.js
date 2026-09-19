'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_LOGO = '/assets/img/hunters547-logo.jpg';
const EMAIL_LOGO_CID = 'logo@hunters547';

function publicRoot() {
  return path.join(__dirname, '..', 'public');
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

function ensureUploadDirs() {
  for (const dir of [path.join(uploadsRoot(), 'portals'), path.join(uploadsRoot(), 'deliveries')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isInside(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Map a public URL path (/uploads/..., /assets/...) to an existing local file.
 * Returns null for remote URLs, missing files, or path traversal.
 */
function resolveExistingPublicFile(urlPath) {
  const raw = String(urlPath || '').trim();
  if (!raw || /^https?:\/\//i.test(raw) || raw.includes('\0')) return null;
  const rel = raw.replace(/^\/+/, '').replace(/\\/g, '/');
  if (!rel || rel.split('/').includes('..')) return null;

  let abs;
  if (rel === 'uploads' || rel.startsWith('uploads/')) {
    const rest = rel === 'uploads' ? '' : rel.slice('uploads/'.length);
    abs = path.resolve(uploadsRoot(), rest);
    if (!isInside(uploadsRoot(), abs)) return null;
  } else {
    abs = path.resolve(publicRoot(), rel);
    if (!isInside(publicRoot(), abs)) return null;
  }
  try {
    return fs.statSync(abs).isFile() ? abs : null;
  } catch (_) {
    return null;
  }
}

function mimeForImage(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
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

function emailLogoAttachment(filePath) {
  return {
    filename: path.basename(filePath),
    path: filePath,
    cid: EMAIL_LOGO_CID,
    contentType: mimeForImage(filePath),
    contentDisposition: 'inline',
  };
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

/**
 * Email header logo: CID when a local file exists (portal logo, else Hunters 547).
 * Remote https logo_path is kept as-is. Never returns a /uploads hotlink for a missing file.
 */
function resolveEmailLogo(portal) {
  const raw = portal ? String(portal.logo_path || '').trim() : '';
  if (raw && /^https?:\/\//i.test(raw)) {
    return { src: raw, attachment: null };
  }
  if (raw) {
    const local = resolveExistingPublicFile(raw);
    if (local) {
      return { src: `cid:${EMAIL_LOGO_CID}`, attachment: emailLogoAttachment(local) };
    }
  }
  const fallback = defaultLogoFile();
  try {
    if (fs.statSync(fallback).isFile()) {
      return { src: `cid:${EMAIL_LOGO_CID}`, attachment: emailLogoAttachment(fallback) };
    }
  } catch (_) {
    /* no bundled fallback */
  }
  return { src: '', attachment: null };
}

function mountUploads(app) {
  const express = require('express');
  app.use(
    '/uploads',
    express.static(uploadsRoot(), {
      index: false,
      fallthrough: true,
      redirect: false,
    })
  );
}

module.exports = {
  DEFAULT_LOGO,
  EMAIL_LOGO_CID,
  publicRoot,
  defaultLogoFile,
  uploadsRoot,
  ensureUploadDirs,
  resolveExistingPublicFile,
  publicUrlFor,
  resolveEmailLogo,
  mountUploads,
};
