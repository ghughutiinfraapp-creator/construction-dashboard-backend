const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { sendPasswordResetEmail } = require('../services/emailService');

// POST /api/auth/register (Admin only)
router.post('/register', authenticate, authorize('SUPER_ADMIN', 'PROJECT_MANAGER','SITE_ENGINEER', 'DELIVERY_PERSON', 'CLIENT'), async (req, res, next) => {
  try {
    const { name, email, phone, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email, phone, password: hashedPassword, role: role?.trim() },
      select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true }
    });
    res.status(201).json({ message: 'User created successfully', user });
  } catch (error) { next(error); }
});

// New route


router.post('/mobile/register', async (req, res, next) => {
  try {
    const { name, email, phone, password, role } = req.body;
    const trimmedRole = role?.trim();

    const allowedRoles = ['SITE_ENGINEER', 'JUNIOR_ENGINEER', 'DELIVERY_PERSON', 'CLIENT'];

    if (!allowedRoles.includes(trimmedRole)) {
      return res.status(400).json({ error: 'Invalid role selected' });
    }

    // check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        password: hashedPassword,
        role: trimmedRole,
      },
    });

    res.status(201).json({
      message: 'User registered successfully',
      user,
    });
  } catch (error) {
    next(error);
  }
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

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await prisma.user.findUnique({ where: { email } });
    // Always respond with the same message so we don't leak which emails are registered
    const genericResponse = { message: 'If an account with that email exists, a password reset link has been sent.' };

    if (!user || !user.isActive) {
      console.warn(`Password reset requested for ${email} but no active account matched; no email sent.`);
      return res.json(genericResponse);
    }

    const token = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: { token, userId: user.id, expiresAt: new Date(Date.now() + 60 * 60 * 1000) }
    });

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    try {
      await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl });
    } catch (mailError) {
      // Keep the response generic so we don't leak which emails are registered,
      // but make the failure loud in the logs instead of a silent success.
      console.error('Failed to send password reset email:', mailError);
    }

    res.json(genericResponse);
  } catch (error) { next(error); }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and new password are required' });

    const resetToken = await prisma.passwordResetToken.findUnique({ where: { token } });
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { id: resetToken.userId }, data: { password: hashedPassword } }),
      prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
      prisma.refreshToken.deleteMany({ where: { userId: resetToken.userId } })
    ]);

    res.json({ message: 'Password reset successfully' });
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
