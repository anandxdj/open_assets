import { sendTeamInviteEmail } from '../../common/config/email';

export interface TeamInviteMail {
  to: string;
  teamName: string;
  inviterName: string;
  /** The raw token. It is only ever in the email (and in memory here); the database holds its hash. */
  token: string;
  expiresAt: Date;
}

/**
 * The one place invite emails leave the team service. A mutable object so tests
 * can capture the token instead of reading it from a log; production code never
 * reassigns it. Resend is not configured in development: the link is logged as
 * `[Email Mock]` (see common/config/email.ts).
 */
export const teamMailer = {
  sendInvite: (mail: TeamInviteMail): Promise<void> => sendTeamInviteEmail(mail),
};
