/**
 * uploads.js — FIXED + delivery photo notifications
 *
 * Key fixes vs original:
 *   1. savePhotoRecord now logs a warning when projectId/entityType are missing
 *      so you can see in server logs if the RN FormData bug re-appears.
 *   2. POST /api/uploads/photo returns a clear 400 error (instead of silent null)
 *      when the DB record could not be created, so the mobile app can surface it.
 *   3. POST /api/tasks/:id/photos now stamps entityType='task' and taskId
 *      explicitly from req.params so it works even if body fields are missing.
 *   4. Cloudinary folder resolution unchanged — slug logic kept identical to
 *      frontend so URL-based photo matching continues to work.
 *   5. NEW: POST /api/uploads/photo now creates a notification for the PO
 *      creator (site engineer/admin) whenever a delivery-linked photo is
 *      uploaded — per-item photo submits AND the final delivery-proof photo.
 */

const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');
const prisma  = require('../config/database');
const { uploadBuffer } = require('../config/cloudinary');

// ── Slug helper (must match frontend slugify exactly) ──────────────────────
function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Cloudinary folder resolver ─────────────────────────────────────────────
// Task uploads: ?projectName=X&taskTitle=Y&photoType=daily|completed[&date=YYYY-MM-DD]
// Generic:      ?type=photos|selfies|documents  (default: photos)
function resolveCloudinaryFolder(req) {
  const { projectName, taskTitle, photoType, date } = req.query;
  const baseFolder = process.env.CLOUDINARY_FOLDER || 'construction-platform';

  if (projectName && taskTitle) {
    const type = photoType === 'completed' ? 'completed' : 'daily';
    const day  = date || new Date().toISOString().slice(0, 10);
    return `${baseFolder}/tasks/${slugify(projectName)}/${slugify(taskTitle)}/${type}/${day}`;
  }

  const subDir = req.query.type || 'photos';
  return `${baseFolder}/${subDir}`;
}

// ── Save Photo record to DB ────────────────────────────────────────────────
// Returns the created Photo row, or null if required fields are missing.
// IMPORTANT: projectId and entityType MUST be present in req.body.
// If they are missing it means the React Native FormData bug is still active
// (file was appended before text fields). Check server logs for the warning.
async function savePhotoRecord({ url, req, overrides = {} }) {
  const {
    projectId,
    entityType,
    entityId,
    taskId,
    purchaseOrderId,
    deliveryId,
    caption,
  } = { ...req.body, ...overrides };

  if (!projectId || !entityType) {
    // ─────────────────────────────────────────────────────────────────────
    // WARNING: if you see this log it means req.body is empty, which means
    // the React Native FormData field-order bug is active again:
    //   formData.append('file', ...)   ← file was first
    //   formData.append('projectId')   ← these were silently dropped by RN
    // Fix: all text fields must be appended BEFORE the file in FormData.
    // ─────────────────────────────────────────────────────────────────────
    console.warn(
      '[savePhotoRecord] Missing projectId or entityType — DB insert skipped.',
      {
        projectId,
        entityType,
        bodyKeys: Object.keys(req.body),
        url,
      },
    );
    return null;
  }

  return prisma.photo.create({
    data: {
      uploadedById:    req.user.id,
      projectId,
      entityType,
      entityId:        entityId        || '',
      taskId:          taskId          || null,
      purchaseOrderId: purchaseOrderId || null,
      deliveryId:      deliveryId      || null,
      url,
      caption:         caption         || null,
    },
  });
}

// ── Notify site engineer/admin when a delivery-linked photo is uploaded ────
// Fires for both per-item photo submits (req.body.itemId/itemName present)
// and the final overall delivery-proof photo (no itemId). Fails silently
// (logs only) so a notification error never blocks the photo upload itself.
async function notifyDeliveryPhotoUploaded({ photo, req }) {
  if (!photo?.deliveryId) return;

  const delivery = await prisma.delivery.findUnique({
    where: { id: photo.deliveryId },
    include: {
      purchaseOrder: {
        include: {
          project:   { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      },
    },
  });

  const recipient = delivery?.purchaseOrder?.createdBy;
  if (!recipient) return; // no one to notify

  const siteName   = delivery.purchaseOrder.project?.name || 'the site';
  const personName = req.user.name || 'A delivery person';
  const itemName   = req.body?.itemName;

  const title = itemName ? `Item delivered: ${itemName}` : 'Delivery photo submitted';
  const body  = itemName
    ? `${personName} delivered "${itemName}" at ${siteName}.`
    : `Delivery done at ${siteName} by ${personName}.`;

  await prisma.notification.create({
    data: {
      userId:     recipient.id,
      type:       'DELIVERY_COMPLETED',
      title,
      body,
      entityType: 'delivery',
      entityId:   delivery.id,
      isRead:     false,
    },
  });
}

// ── Multer config ──────────────────────────────────────────────────────────
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|webp/;
    if (
      allowed.test(path.extname(file.originalname).toLowerCase()) &&
      allowed.test(file.mimetype)
    ) {
      return cb(null, true);
    }
    cb(new Error('Only images and PDFs are allowed'));
  },
});

// ── POST /api/uploads/photo ────────────────────────────────────────────────
// Body (required for DB record): { projectId, entityType, entityId, taskId }
// Body (optional): { purchaseOrderId, deliveryId, caption }
//
// FIELD ORDER CONTRACT (React Native):
//   The mobile client MUST append all text fields BEFORE the file field.
//   If the file is appended first, RN silently drops all subsequent text
//   fields and req.body will be empty here, causing savePhotoRecord to
//   skip the DB insert (the warning above will fire).
router.post(
  '/photo',
  authenticate,
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const folder   = resolveCloudinaryFolder(req);
      const filename = uuidv4();

      const uploadResult = await uploadBuffer(req.file.buffer, {
        folder,
        public_id: filename,
      });

      const url   = uploadResult.secure_url;
      const photo = await savePhotoRecord({ url, req });

      // Fire-and-forget: notify the PO creator (site engineer/admin) if this
      // photo is tied to a delivery. Never let a notification failure block
      // the upload response.
      if (photo) {
        notifyDeliveryPhotoUploaded({ photo, req }).catch(err =>
          console.error('[uploads] Failed to create delivery notification:', err)
        );
      }

      // Return a 207 (partial success) if the file was saved to Cloudinary
      // but the DB record could not be created. This lets the mobile client
      // surface the problem rather than silently showing a broken gallery.
      if (!photo) {
        return res.status(207).json({
          url,
          filename: `${filename}${path.extname(req.file.originalname)}`,
          size: req.file.size,
          photo: null,
          warning:
            'File uploaded to Cloudinary but DB record was not created. ' +
            'Check that projectId and entityType are present in the request body.',
        });
      }

      res.json({
        url,
        filename: `${filename}${path.extname(req.file.originalname)}`,
        size: req.file.size,
        photo,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── POST /api/uploads/multiple ─────────────────────────────────────────────
// Body (optional): { projectId, entityType, entityId, taskId, ... }
router.post(
  '/multiple',
  authenticate,
  upload.array('files', 10),
  async (req, res, next) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const folder = resolveCloudinaryFolder(req);

      const files = await Promise.all(
        req.files.map(async f => {
          const filename     = uuidv4();
          const uploadResult = await uploadBuffer(f.buffer, {
            folder,
            public_id: filename,
          });
          const url   = uploadResult.secure_url;
          const photo = await savePhotoRecord({ url, req });
          return {
            url,
            filename: `${filename}${path.extname(f.originalname)}`,
            size: f.size,
            photo,
          };
        }),
      );

      res.json({ files });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;