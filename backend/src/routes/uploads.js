const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');

// Ensure upload directories exist
const uploadDir = path.join(__dirname, '../../uploads');
['photos', 'selfies', 'documents'].forEach(dir => {
  const dirPath = path.join(uploadDir, dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subDir = req.query.type || 'photos';
    cb(null, path.join(uploadDir, subDir));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Only images and PDFs are allowed'));
  }
});

// POST /api/uploads/photo
router.post('/photo', authenticate, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const subDir = req.query.type || 'photos';
    const url = `/uploads/${subDir}/${req.file.filename}`;

    // TODO: Add watermarking with sharp
    // const sharp = require('sharp');
    // await sharp(req.file.path).composite([{ input: watermarkBuffer, gravity: 'southeast' }]).toFile(outputPath);

    res.json({ url, filename: req.file.filename, size: req.file.size });
  } catch (error) { next(error); }
});

// POST /api/uploads/multiple
router.post('/multiple', authenticate, upload.array('files', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const subDir = req.query.type || 'photos';
    const urls = req.files.map(f => ({
      url: `/uploads/${subDir}/${f.filename}`,
      filename: f.filename, size: f.size
    }));

    res.json({ files: urls });
  } catch (error) { next(error); }
});

module.exports = router;
