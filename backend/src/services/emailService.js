const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// SMTP_USER is the relay login (Resend uses the literal string "resend"), not a
// mailbox. The From address has to be a real address on a domain verified with
// the provider, so it is configured separately.
const getFromAddress = () => {
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error('EMAIL_FROM is not set; cannot send mail');
  return from;
};

const sendPasswordResetEmail = async ({ to, name, resetUrl }) => {
  const info = await transporter.sendMail({
    from: getFromAddress(),
    to,
    subject: 'Reset your password',
    html: `
      <p>Hi ${name},</p>
      <p>We received a request to reset your password. Click the link below to choose a new one:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
    `
  });
  console.log(`Password reset email accepted for ${to} (messageId: ${info.messageId})`);
  return info;
};

module.exports = { sendPasswordResetEmail };
