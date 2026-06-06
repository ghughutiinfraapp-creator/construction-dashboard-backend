const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const NotificationService = require('../services/notificationService');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { uploadBuffer } = require('../config/cloudinary');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const valid = allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype);
    valid ? cb(null, true) : cb(new Error('Only image files are allowed'));
  }
});

// POST /api/issues  — multipart/form-data: fields(projectId, title, description) + optional files(photos)
router.post('/', authenticate, authorize('CLIENT'), upload.array('photos', 10), async (req, res, next) => {
  try {
    const { projectId, title, description } = req.body;
    if (!projectId || !title) return res.status(400).json({ error: 'projectId and title are required' });
    let photoUrls = [];
    if (req.files && req.files.length > 0) {
      const baseFolder = process.env.CLOUDINARY_FOLDER || 'construction-platform';
      const folder = `${baseFolder}/issues`;
      const uploadResults = await Promise.all(
        req.files.map(file =>
          uploadBuffer(file.buffer, {
            folder,
            public_id: uuidv4(),
          })
        )
      );
      photoUrls = uploadResults.map(r => r.secure_url);
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, managerId: true }
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const issue = await prisma.issue.create({
      data: { projectId, clientId: req.user.id, title, description, photoUrls },
      include: {
        client:  { select: { id: true, name: true } },
        project: { select: { id: true, name: true } }
      }
    });

    // Notify project manager, site engineers on this project, and super admins
    const [siteEngineers, superAdmins] = await Promise.all([
      prisma.user.findMany({
        where: { role: 'SITE_ENGINEER', attendance: { some: { projectId } }, isActive: true },
        select: { id: true }
      }),
      prisma.user.findMany({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { id: true } })
    ]);

    const recipientIds = [
      project.managerId,
      ...siteEngineers.map(u => u.id),
      ...superAdmins.map(u => u.id)
    ].filter((id, i, arr) => arr.indexOf(id) === i); // deduplicate

    const notifier = new NotificationService(req.app.get('io'));
    await notifier.sendToMultiple({
      userIds: recipientIds,
      title: 'New Issue Raised',
      body: `${req.user.name} raised an issue on ${project.name}: "${title}"`,
      type: 'GENERAL',
      entityType: 'issue',
      entityId: issue.id
    });

    res.status(201).json({ issue });
  } catch (error) { next(error); }
});

// GET /api/issues
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { projectId, status, page = 1, limit = 20 } = req.query;
    const where = {};
    if (projectId) where.projectId = projectId;
    if (status)    where.status    = status;
    if (req.user.role === 'CLIENT') where.clientId = req.user.id;

    const [issues, total] = await Promise.all([
      prisma.issue.findMany({
        where,
        skip: (page - 1) * limit,
        take: parseInt(limit),
        include: {
          client:  { select: { id: true, name: true } },
          project: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.issue.count({ where })
    ]);

    res.json({ issues, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
});

// GET /api/issues/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const issue = await prisma.issue.findUnique({
      where: { id: req.params.id },
      include: {
        client:  { select: { id: true, name: true } },
        project: { select: { id: true, name: true } }
      }
    });
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    if (req.user.role === 'CLIENT' && issue.clientId !== req.user.id)
      return res.status(403).json({ error: 'Access denied' });

    res.json({ issue });
  } catch (error) { next(error); }
});

// PUT /api/issues/:id  — client can edit title/description/photos while OPEN; manager/admin can update status
router.put('/:id', authenticate, upload.array('photos', 10), async (req, res, next) => {
  try {
    const issue = await prisma.issue.findUnique({ where: { id: req.params.id } });
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    let data = {};
    if (req.user.role === 'CLIENT') {
      if (issue.clientId !== req.user.id) return res.status(403).json({ error: 'Access denied' });
      if (issue.status !== 'OPEN') return res.status(400).json({ error: 'Cannot edit a non-open issue' });
      const { title, description } = req.body;
      if (title) data.title = title;
      if (description !== undefined) data.description = description;
      if (req.files?.length) {
        const baseFolder = process.env.CLOUDINARY_FOLDER || 'construction-platform';
        const folder = `${baseFolder}/issues`;
        const uploadResults = await Promise.all(
          req.files.map(file =>
            uploadBuffer(file.buffer, {
              folder,
              public_id: uuidv4(),
            })
          )
        );
        data.photoUrls = uploadResults.map(r => r.secure_url);
      }
    } else {
      const { status } = req.body;
      if (status) data.status = status;
    }

    const updated = await prisma.issue.update({
      where: { id: req.params.id },
      data,
      include: {
        client:  { select: { id: true, name: true } },
        project: { select: { id: true, name: true } }
      }
    });

    res.json({ issue: updated });
  } catch (error) { next(error); }
});

// DELETE /api/issues/:id — client (only OPEN), or admin
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const issue = await prisma.issue.findUnique({ where: { id: req.params.id } });
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    if (req.user.role === 'CLIENT') {
      if (issue.clientId !== req.user.id) return res.status(403).json({ error: 'Access denied' });
      if (issue.status !== 'OPEN') return res.status(400).json({ error: 'Cannot delete a non-open issue' });
    }

    await prisma.issue.delete({ where: { id: req.params.id } });
    res.json({ message: 'Issue deleted' });
  } catch (error) { next(error); }
});

module.exports = router;
