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
