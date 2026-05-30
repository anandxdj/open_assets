import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const sendEmail = async (to: string, subject: string, html: string) => {
  try {
    if (resend) {
      const { data, error } = await resend.emails.send({
        from: `"${process.env.RESEND_FROM_NAME || process.env.SMTP_FROM_NAME}" <${process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM_EMAIL}>`,
        to: [to],
        subject,
        html,
      });

      if (error) {
        throw new Error(error.message);
      }
      return data;
    } else {
      // Fallback to mock log if no API key is provided
      console.log(`[Email Mock] To: ${to}, Subject: ${subject}`);
    }
  } catch (error: any) {
    console.error(`[Email Error] Failed to send email to ${to}:`, error.message);
  }
};

export const sendVerificationEmail = async (email: string, token: string) => {
  const url = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email/${token}`;
  await sendEmail(
    email,
    'Verify your email - OpenPoll',
    `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #d8ad87;">Welcome to OpenPoll!</h2>
      <p>Thank you for signing up. Please click the button below to verify your email address:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${url}" style="background-color: #d8ad87; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Verify Email</a>
      </div>
      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #666;">${url}</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #999;">If you didn't create an account, you can safely ignore this email.</p>
    </div>
    `
  );
};

export const sendResetPasswordEmail = async (email: string, token: string) => {
  const url = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${token}`;
  await sendEmail(
    email,
    'Reset your password - OpenPoll',
    `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #d8ad87;">Password Reset Request</h2>
      <p>We received a request to reset your password. Click the button below to choose a new one:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${url}" style="background-color: #d8ad87; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
      </div>
      <p>This link will expire in 15 minutes.</p>
      <p>If you didn't request a password reset, please ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #999;">OpenPoll Platform</p>
    </div>
    `
  );
};
