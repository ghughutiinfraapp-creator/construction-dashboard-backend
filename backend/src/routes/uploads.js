const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');

const uploadDir = path.join(__dirname, '../../uploads');

// Ensure base directories exist
['photos', 'selfies', 'documents', 'tasks'].forEach(dir => {
  fs.mkdirSync(path.join(uploadDir, dir), { recursive: true });
});

function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Returns { dir, urlPrefix } based on query params.
// Task uploads: ?projectName=X&taskTitle=Y&photoType=daily|completed[&date=YYYY-MM-DD]
// Generic uploads: ?type=photos|selfies|documents  (default: photos)
function resolveDestination(req) {
  const { projectName, taskTitle, photoType, date } = req.query;
  if (projectName && taskTitle) {
    const type = photoType === 'completed' ? 'completed' : 'daily';
    const day  = date || new Date().toISOString().slice(0, 10);
    const rel  = `tasks/${slugify(projectName)}/${slugify(taskTitle)}/${type}/${day}`;
    return { dir: path.join(uploadDir, rel), urlPrefix: `/uploads/${rel}` };
  }
  const subDir = req.query.type || 'photos';
  return { dir: path.join(uploadDir, subDir), urlPrefix: `/uploads/${subDir}` };
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const { dir } = resolveDestination(req);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});

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
// Task photo: ?projectName=Skyline%20Tower&taskTitle=Plastering&date=2026-05-24
// Generic:    ?type=photos
router.post('/photo', authenticate, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { urlPrefix } = resolveDestination(req);
    const url = `${urlPrefix}/${req.file.filename}`;
    res.json({ url, filename: req.file.filename, size: req.file.size });
  } catch (error) { next(error); }
});

// POST /api/uploads/multiple
// Task photos: ?projectName=Skyline%20Tower&taskTitle=Plastering&date=2026-05-24
// Generic:     ?type=photos
router.post('/multiple', authenticate, upload.array('files', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
    const { urlPrefix } = resolveDestination(req);
    const files = req.files.map(f => ({
      url: `${urlPrefix}/${f.filename}`,
      filename: f.filename,
      size: f.size
    }));
    res.json({ files });
  } catch (error) { next(error); }
});

module.exports = router;
