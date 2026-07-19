/**
 * photos.js — FIXED
 *
 * Key fixes vs original:
 *   1. POST /api/tasks/:id/photos now explicitly stamps entityType='task'
 *      and taskId from req.params.id in the DB insert — not from req.body —
 *      so completed photos always have correct metadata regardless of what
 *      the mobile client sends.
 *   2. GET /api/photos supports an optional entityType filter and bumps
 *      the default limit to 100 (was 20) so the client's 500-item fetch works.
 *   3. Added capturedAt to the orderBy (DESC) so newest photos sort first.
 */

const router = require('express').Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { authenticate, authorize } = require('../middleware/auth');
const prisma = require('../config/database');
const { uploadBuffer, destroyByUrl } = require('../config/cloudinary');

// ── Multer (used by POST /api/tasks/:id/photos) ────────────────────────────
const storage = multer.memoryStorage();
const upload  = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    if (
      allowed.test(path.extname(file.originalname).toLowerCase()) &&
      allowed.test(file.mimetype)
    ) {
      return cb(null, true);
    }
    cb(new Error('Only images are allowed for task photos'));
  },
});

// ── GET /api/photos ────────────────────────────────────────────────────────
// Filters: projectId, entityType, taskId, purchaseOrderId, deliveryId,
//          uploadedById, page, limit (default 100)
//
// The mobile GalleryPanel calls:
//   GET /api/photos?projectId=X&limit=500
// and then filters client-side via photoMatchesTask(). Keeping the default
// limit at 100 is safe for web; the mobile client always passes limit=500
// explicitly so it gets everything it needs.
router.get('/', authenticate, async (req, res, next) => {
  try {
    const {
      projectId,
      entityType,
      taskId,
      purchaseOrderId,
      deliveryId,
      uploadedById,
      page  = 1,
      limit = 100,
    } = req.query;

    const where = {};
    if (projectId)       where.projectId       = projectId;
    if (entityType)      where.entityType      = entityType;
    if (taskId)          where.taskId          = taskId;
    if (purchaseOrderId) where.purchaseOrderId = purchaseOrderId;
    if (deliveryId)      where.deliveryId      = deliveryId;
    if (uploadedById)    where.uploadedById    = uploadedById;

    const pageNum  = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 500); // hard cap at 500

    const [photos, total] = await Promise.all([
      prisma.photo.findMany({
        where,
        skip:    (pageNum - 1) * limitNum,
        take:    limitNum,
        include: {
          uploadedBy: { select: { id: true, name: true } },
          project:    { select: { id: true, name: true } },
          task:       { select: { id: true, title: true } },
        },
        orderBy: { capturedAt: 'desc' },
      }),
      prisma.photo.count({ where }),
    ]);

    res.json({
      photos,
      total,
      page:       pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/photos/:id ────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const photo = await prisma.photo.findUnique({
      where:   { id: req.params.id },
      include: {
        uploadedBy:    { select: { id: true, name: true } },
        project:       { select: { id: true, name: true } },
        task:          { select: { id: true, title: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
        delivery:      { select: { id: true } },
      },
    });

    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    res.json({ photo });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/tasks/:id/photos ─────────────────────────────────────────────
// Accepts: multipart/form-data with field name 'photos' (multiple files)
//
// FIX: entityType and taskId are stamped here from req.params and the
// verified task row — NOT from req.body — so the DB record is always
// correct regardless of what the mobile client sends in FormData.
//
// This route also looks up the task's projectId from the DB, so the client
// doesn't need to include it in the request body.
router.post(
  '/tasks/:id/photos',        // note: mount this router at /api in app.js
                               // so the full path becomes /api/tasks/:id/photos
  authenticate,
  upload.array('photos', 20),
  async (req, res, next) => {
    try {
      const taskId = req.params.id;

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No photos uploaded' });
      }

      // Look up task to get projectId and build the Cloudinary folder path
      const task = await prisma.task.findUnique({
        where:   { id: taskId },
        include: { project: { select: { id: true, name: true } } },
      });

      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const baseFolder  = process.env.CLOUDINARY_FOLDER || 'construction-platform';
      const slugify     = str =>
        str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const folder      =
        `${baseFolder}/tasks/${slugify(task.project.name)}/${slugify(task.title)}/completed`;

      const photos = await Promise.all(
        req.files.map(async (file, i) => {
          const filename     = uuidv4();
          const uploadResult = await uploadBuffer(file.buffer, {
            folder,
            public_id: filename,
          });

          const url = uploadResult.secure_url;

          // ── Stamp entityType and taskId from server-side data ────────────
          // Do NOT rely on req.body for these — the mobile client's FormData
          // may not include them, or may have the RN field-drop bug.
          return prisma.photo.create({
            data: {
              uploadedById: req.user.id,
              projectId:    task.project.id,   // from DB lookup
              entityType:   'task',            // fixed value for completed photos
              entityId:     taskId,            // task id
              taskId:       taskId,            // explicit taskId for filtering
              url,
              caption:      req.body?.caption  || null,
            },
          });
        }),
      );

      res.json({ photos, count: photos.length });
    } catch (error) {
      next(error);
    }
  },
);

// ── DELETE /api/photos/:id ─────────────────────────────────────────────────
router.delete('/:id', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const photo = await prisma.photo.findUnique({ where: { id: req.params.id } });
    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    await prisma.photo.delete({ where: { id: req.params.id } });

    try {
      await destroyByUrl(photo.url);
    } catch (cloudinaryError) {
      console.warn(`[Photo Delete] Failed to remove Cloudinary asset for photo ${photo.id}:`, cloudinaryError.message);
    }

    res.json({ message: 'Photo deleted' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;