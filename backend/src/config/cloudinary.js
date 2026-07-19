const cloudinary = require('cloudinary').v2;

const requiredEnv = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
const missing = requiredEnv.filter(key => !process.env[key]);

if (missing.length > 0) {
  console.warn(`[Cloudinary Warning]: Missing environment variables: ${missing.join(', ')}. Image uploads may fail.`);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Uploads a file buffer to Cloudinary.
 * @param {Buffer} buffer - File buffer from multer memory storage
 * @param {Object} options - Cloudinary upload options (e.g. folder, public_id, resource_type)
 * @returns {Promise<Object>}
 */
const uploadBuffer = (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'auto', // Support PDF, JPEG, PNG, etc.
        ...options,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
};

/**
 * Derives { publicId, resourceType } from a Cloudinary delivery URL.
 * Records only store the URL, not the public_id, so this reverses:
 *   https://res.cloudinary.com/<cloud>/<resource_type>/upload/v<version>/<public_id>.<ext>
 * Returns null for anything that isn't a recognizable Cloudinary URL.
 */
const parseCloudinaryUrl = (url) => {
  try {
    const { hostname, pathname } = new URL(url);
    if (!hostname.includes('cloudinary.com')) return null;

    const parts = pathname.split('/').filter(Boolean);
    const uploadIdx = parts.indexOf('upload');
    if (uploadIdx < 1) return null;

    const resourceType = parts[uploadIdx - 1] || 'image';
    let rest = parts.slice(uploadIdx + 1);
    if (rest[0] && /^v\d+$/.test(rest[0])) rest = rest.slice(1); // drop version segment
    if (rest.length === 0) return null;

    const last = rest[rest.length - 1].replace(/\.[^./]+$/, ''); // strip extension
    const publicId = [...rest.slice(0, -1), last].join('/');
    return { publicId, resourceType };
  } catch {
    return null;
  }
};

/**
 * Deletes the Cloudinary asset backing a stored URL. Best-effort: resolves
 * with null (rather than throwing) when the URL isn't a Cloudinary asset.
 * @param {string} url - The secure_url previously returned by uploadBuffer
 */
const destroyByUrl = async (url) => {
  const parsed = parseCloudinaryUrl(url);
  if (!parsed) return null;
  return cloudinary.uploader.destroy(parsed.publicId, { resource_type: parsed.resourceType });
};

module.exports = {
  cloudinary,
  uploadBuffer,
  destroyByUrl,
};
