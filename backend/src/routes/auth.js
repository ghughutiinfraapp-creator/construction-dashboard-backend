const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// POST /api/auth/register (Admin only)
router.post('/register', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER'), async (req, res, next) => {
  try {
    const { name, email, phone, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email, phone, password: hashedPassword, role },
      select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true }
    });
    res.status(201).json({ message: 'User created successfully', user });
  } catch (error) { next(error); }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return res.status(401).json({ error: 'Invalid credentials' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

    const accessToken = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '24h' });
    const refreshToken = uuidv4();
    await prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
    });

    res.json({
      accessToken, refreshToken,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, avatar: user.avatar }
    });
  } catch (error) { next(error); }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken }, include: { user: true } });
    if (!stored || stored.expiresAt < new Date()) return res.status(401).json({ error: 'Invalid or expired refresh token' });

    const accessToken = jwt.sign({ userId: stored.user.id, role: stored.user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '24h' });
    res.json({ accessToken });
  } catch (error) { next(error); }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  res.json({ user: req.user });
});

// PUT /api/auth/update-fcm
router.put('/update-fcm', authenticate, async (req, res, next) => {
  try {
    await prisma.user.update({ where: { id: req.user.id }, data: { fcmToken: req.body.fcmToken } });
    res.json({ message: 'FCM token updated' });
  } catch (error) { next(error); }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await prisma.refreshToken.deleteMany({ where: { userId: req.user.id } });
    res.json({ message: 'Logged out successfully' });
  } catch (error) { next(error); }
});

module.exports = router;
