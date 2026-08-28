// Sends through Resend's HTTP API rather than SMTP. Render's free instances
// block outbound traffic to SMTP ports (25/465/587), so nodemailer connections
// time out with ETIMEDOUT there; the HTTP API uses 443 and is unaffected.
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const getConfig = () => {
  const apiKey = process.env.RESEND_API_KEY || process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set; cannot send mail');
  if (!from) throw new Error('EMAIL_FROM is not set; cannot send mail');
  return { apiKey, from };
};

const sendEmail = async ({ to, subject, html }) => {
  const { apiKey, from } = getConfig();

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from, to, subject, html })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Resend rejected the message (${response.status}): ${body.message || 'unknown error'}`);
  }
  return body;
};

const sendPasswordResetEmail = async ({ to, name, resetUrl }) => {
  const result = await sendEmail({
    to,
    subject: 'Reset your password',
    html: `
      <p>Hi ${name},</p>
      <p>We received a request to reset your password. Click the link below to choose a new one:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
    `
  });
  console.log(`Password reset email accepted for ${to} (id: ${result.id})`);
  return result;
};

module.exports = { sendPasswordResetEmail };
