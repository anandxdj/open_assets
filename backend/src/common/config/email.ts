import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * `mockDetail` is printed only by the no-Resend fallback, and never in
 * production, so a developer can follow a link that is normally only in the inbox.
 */
const sendEmail = async (to: string, subject: string, html: string, mockDetail?: string) => {
  try {
    if (resend) {
      const { data, error } = await resend.emails.send({
        from: `"${process.env.RESEND_FROM_NAME || process.env.SMTP_FROM_NAME || 'OpenAssets'}" <${process.env.RESEND_FROM_EMAIL || process.env.SMTP_FROM_EMAIL}>`,
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
      if (mockDetail && process.env.NODE_ENV !== 'production') console.log(`[Email Mock] ${mockDetail}`);
    }
  } catch (error: any) {
    console.error(`[Email Error] Failed to send email to ${to}:`, error.message);
  }
};

export const sendVerificationEmail = async (email: string, token: string) => {
  const url = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email/${token}`;
  await sendEmail(
    email,
    'Verify your email - Open Assets',
    `
    <div style="background-color: #09090b; padding: 40px 15px; min-height: 100%; font-family: 'Courier New', Courier, monospace;">
      <div style="background-color: #000000; border: 2px solid #ff7c00; padding: 30px; max-width: 500px; margin: auto; color: #ffffff; box-shadow: 6px 6px 0px #ff7c00;">
        <div style="border-bottom: 2px solid #ff7c00; padding-bottom: 15px; margin-bottom: 25px; text-align: center;">
          <span style="color: #ff7c00; font-size: 18px; font-weight: 900; letter-spacing: 2px;">[ OPEN_ASSETS ]</span>
        </div>
        <div style="font-size: 13px; line-height: 1.6; color: #a1a1aa;">
          <p style="color: #ff7c00; font-weight: bold; margin-top: 0; font-size: 11px; letter-spacing: 1px;">// SECURITY_GATE // VERIFY_IDENTITY</p>
          <p style="color: #ffffff; font-size: 15px; font-weight: bold; margin-bottom: 10px;">Welcome to the Open Assets ecosystem.</p>
          <p style="margin-bottom: 20px;">To finalize your identity record and authorize system interface access, click the verification button below:</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${url}" style="display: inline-block; background-color: #ff7c00; color: #000000; padding: 14px 28px; text-decoration: none; border: 2px solid #ff7c00; font-weight: 900; font-size: 13px; letter-spacing: 1px; text-transform: uppercase;">VERIFY_IDENTITY →</a>
          </div>
          
          <p style="color: #71717a; font-size: 11px; margin-top: 25px;">Or copy and paste this verification access link into your browser:</p>
          <p style="word-break: break-all; color: #a1a1aa; background-color: #18181b; padding: 12px; border: 1px dashed #27272a; font-size: 11px; margin: 10px 0;">${url}</p>
          
          <div style="border-top: 1px dashed #27272a; margin-top: 30px; padding-top: 15px; font-size: 10px; color: #71717a; line-height: 1.4;">
            <div>SYSTEM: OPEN_ASSETS CORE v1.0.0</div>
            <div>METADATA: STATUS_PENDING_ACTIVATION</div>
            <div style="margin-top: 5px;">If you did not execute this request, you can safely ignore this diagnostic.</div>
          </div>
        </div>
      </div>
    </div>
    `
  );
};

export const sendResetPasswordEmail = async (email: string, token: string) => {
  const url = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${token}`;
  await sendEmail(
    email,
    'Reset your password - Open Assets',
    `
    <div style="background-color: #09090b; padding: 40px 15px; min-height: 100%; font-family: 'Courier New', Courier, monospace;">
      <div style="background-color: #000000; border: 2px solid #ff7c00; padding: 30px; max-width: 500px; margin: auto; color: #ffffff; box-shadow: 6px 6px 0px #ff7c00;">
        <div style="border-bottom: 2px solid #ff7c00; padding-bottom: 15px; margin-bottom: 25px; text-align: center;">
          <span style="color: #ff7c00; font-size: 18px; font-weight: 900; letter-spacing: 2px;">[ OPEN_ASSETS ]</span>
        </div>
        <div style="font-size: 13px; line-height: 1.6; color: #a1a1aa;">
          <p style="color: #ff7c00; font-weight: bold; margin-top: 0; font-size: 11px; letter-spacing: 1px;">// SECURITY_GATE // CREDENTIAL_RESET</p>
          <p style="color: #ffffff; font-size: 15px; font-weight: bold; margin-bottom: 10px;">Access Key Reconfiguration Requested.</p>
          <p style="margin-bottom: 20px;">We received an instruction to reset the access key for your account identity. Click the authorization button below to configure new credentials:</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${url}" style="display: inline-block; background-color: #ff7c00; color: #000000; padding: 14px 28px; text-decoration: none; border: 2px solid #ff7c00; font-weight: 900; font-size: 13px; letter-spacing: 1px; text-transform: uppercase;">RESET_ACCESS_KEY →</a>
          </div>
          
          <p style="color: #ef4444; font-size: 11px; font-weight: bold; margin-top: 25px;">// SECURITY ALERT: THIS CONFIGURATION LINK EXPIRES IN 15 MINUTES.</p>
          
          <p style="color: #71717a; font-size: 11px; margin-top: 15px;">Direct access link:</p>
          <p style="word-break: break-all; color: #a1a1aa; background-color: #18181b; padding: 12px; border: 1px dashed #27272a; font-size: 11px; margin: 10px 0;">${url}</p>
          
          <div style="border-top: 1px dashed #27272a; margin-top: 30px; padding-top: 15px; font-size: 10px; color: #71717a; line-height: 1.4;">
            <div>SYSTEM: OPEN_ASSETS CORE v1.0.0</div>
            <div>METADATA: STATUS_CREDENTIAL_CHANGE_PENDING</div>
            <div style="margin-top: 5px;">If you did not execute this instruction, please contact security immediately.</div>
          </div>
        </div>
      </div>
    </div>
    `
  );
};

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/**
 * Invitation to join a team. The team and inviter names are typed by users, so
 * they are escaped. Plain words, ink on paper with the orange action, like the
 * product (DESIGN.md).
 */
export const sendTeamInviteEmail = async (mail: {
  to: string;
  teamName: string;
  inviterName: string;
  token: string;
  expiresAt: Date;
}) => {
  const url = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/team/invite/${mail.token}`;
  const team = escapeHtml(mail.teamName);
  const inviter = escapeHtml(mail.inviterName);
  const expires = mail.expiresAt.toUTCString().replace(/ GMT$/, ' UTC');
  await sendEmail(
    mail.to,
    `${mail.inviterName} invited you to the team ${mail.teamName} on OpenAssets`.replace(/[\r\n]+/g, ' '),
    `
    <div style="background-color: #F4F3EE; padding: 40px 15px; font-family: 'Courier New', Courier, monospace; color: #0A0A0A;">
      <div style="background-color: #ffffff; border: 2px solid #0A0A0A; padding: 28px; max-width: 480px; margin: auto;">
        <p style="margin: 0 0 18px; font-size: 13px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase;">OpenAssets</p>
        <p style="margin: 0 0 12px; font-size: 16px; font-weight: bold; line-height: 1.4;">${inviter} invited you to join ${team}.</p>
        <p style="margin: 0 0 22px; font-size: 13px; line-height: 1.6;">
          Team members can view, edit and download the collections the owner shares with the team.
          Sign in or create an account with this email address to accept.
        </p>
        <p style="margin: 0 0 22px;">
          <a href="${url}" style="display: inline-block; background-color: #FF7C00; color: #0A0A0A; padding: 13px 24px; text-decoration: none; border: 2px solid #0A0A0A; font-weight: bold; font-size: 13px; letter-spacing: 1px; text-transform: uppercase;">Accept invite</a>
        </p>
        <p style="margin: 0 0 6px; font-size: 12px; line-height: 1.5;">This invite expires on ${expires}. If the button does not work, copy this link into your browser:</p>
        <p style="margin: 0 0 18px; font-size: 12px; word-break: break-all;">${url}</p>
        <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #555555;">Did not expect this? Ignore this email and nothing happens.</p>
      </div>
    </div>
    `,
    `Team invite for ${mail.to} (${mail.teamName}), expires ${mail.expiresAt.toISOString()}: ${url}`,
  );
};
