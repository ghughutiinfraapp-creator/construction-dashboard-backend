const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');
const prisma = require('../config/database');
const { uploadBuffer } = require('../config/cloudinary');

function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Returns the folder path on Cloudinary based on query params.
// Task uploads: ?projectName=X&taskTitle=Y&photoType=daily|completed[&date=YYYY-MM-DD]
// Generic uploads: ?type=photos|selfies|documents  (default: photos)
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

// Saves a Photo record to the DB if projectId + entityType are provided.
// entityId, taskId, purchaseOrderId, deliveryId are optional but recommended.
async function savePhotoRecord({ url, req }) {
  const { projectId, entityType, entityId, taskId, purchaseOrderId, deliveryId, caption } = req.body;
  if (!projectId || !entityType) return null;
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
    }
  });
}

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype))
      return cb(null, true);
    cb(new Error('Only images and PDFs are allowed'));
  }
});

// POST /api/uploads/photo
// Body (optional): { projectId, entityType, entityId, taskId, purchaseOrderId, deliveryId, caption }
router.post('/photo', authenticate, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const folder = resolveCloudinaryFolder(req);
    const filename = uuidv4();

    const uploadResult = await uploadBuffer(req.file.buffer, {
      folder,
      public_id: filename,
    });

    const url = uploadResult.secure_url;
    const photo = await savePhotoRecord({ url, req });

    res.json({ 
      url, 
      filename: `${filename}${path.extname(req.file.originalname)}`, 
      size: req.file.size, 
      photo 
    });
  } catch (error) { next(error); }
});

// POST /api/uploads/multiple
// Body (optional): { projectId, entityType, entityId, taskId, purchaseOrderId, deliveryId, caption }
router.post('/multiple', authenticate, upload.array('files', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
    const folder = resolveCloudinaryFolder(req);

    const files = await Promise.all(req.files.map(async (f) => {
      const filename = uuidv4();
      const uploadResult = await uploadBuffer(f.buffer, {
        folder,
        public_id: filename,
      });
      const url = uploadResult.secure_url;
      const photo = await savePhotoRecord({ url, req });
      return { 
        url, 
        filename: `${filename}${path.extname(f.originalname)}`, 
        size: f.size, 
        photo 
      };
    }));

    res.json({ files });
  } catch (error) { next(error); }
});

module.exports = router;
