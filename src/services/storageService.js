const path = require('path');
const fs = require('fs/promises');
const { supabaseAdmin, isConfigured } = require('../config/supabase');

const SIGNATURES = {
  'image/jpeg': buffer => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  'image/png': buffer => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'application/pdf': buffer => buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-',
};

function safeName(originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  const base = path.basename(originalName || 'arquivo', ext)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60);
  return `${base || 'arquivo'}${ext}`;
}

async function validateUpload(file, allowedMimeTypes = Object.keys(SIGNATURES)) {
  if (!file || !allowedMimeTypes.includes(file.mimetype) || !SIGNATURES[file.mimetype]) return false;
  const buffer = file.buffer || (file.path ? await fs.readFile(file.path) : null);
  return Boolean(buffer && SIGNATURES[file.mimetype](buffer));
}

async function uploadPrivate({ bucket, companyId, userId, file, allowedMimeTypes }) {
  if (!await validateUpload(file, allowedMimeTypes)) {
    if (file?.path) await fs.unlink(file.path).catch(() => {});
    const error = new Error('O conteúdo do arquivo não corresponde ao formato informado.');
    error.status = 400;
    throw error;
  }
  if (!isConfigured || !file?.buffer) return null;
  const objectPath = `${companyId}/${userId}/${Date.now()}-${safeName(file.originalname)}`;
  const { error } = await supabaseAdmin.storage.from(bucket).upload(objectPath, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
    cacheControl: '3600',
  });
  if (error) throw error;
  return objectPath;
}

async function signedUrl(bucket, objectPath, expiresIn = 3600) {
  if (!isConfigured || !objectPath || objectPath.startsWith('/') || objectPath.startsWith('http')) {
    return objectPath;
  }
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(objectPath, expiresIn);
  if (error) return null;
  return data.signedUrl;
}

async function removePrivate(bucket, objectPath) {
  if (!isConfigured || !objectPath) return false;
  const { error } = await supabaseAdmin.storage.from(bucket).remove([objectPath]);
  if (error) throw error;
  return true;
}

async function signDocuments(documents) {
  return Promise.all(documents.map(async document => ({
    ...document,
    file_url: await signedUrl('documents', document.file_url),
  })));
}

module.exports = { uploadPrivate, signedUrl, removePrivate, signDocuments, validateUpload };
