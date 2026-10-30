"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { AuthIntro, AuthStatus } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { useAuth } from "@/features/auth/context/AuthContext";
import { withNext } from "@/features/auth/lib/next-path";
import { acceptInvite, previewInvite, TEAM_ERROR_CODES, type InvitePreview } from "@/features/team/api";
import { ApiRequestError } from "@/lib/api-error";

const expiryFormat = new Intl.DateTimeFormat("en", { dateStyle: "long" });

type Loaded =
  | { token: string; status: "ready"; invite: InvitePreview }
  | { token: string; status: "failed"; code: string | undefined; message: string };

function Facts({ invite }: { invite: InvitePreview }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-y-[1.5px] border-line py-3.5 text-xs leading-[18px]">
      <dt className="text-ink-2">Invited address</dt>
      <dd className="oa-value break-all">{invite.email}</dd>
      <dt className="text-ink-2">Link works until</dt>
      <dd className="oa-value">
        <time dateTime={invite.expiresAt}>{expiryFormat.format(Date.parse(invite.expiresAt))}</time>
      </dd>
    </dl>
  );
}

/** Shown when the link cannot be used: expired, withdrawn, already used, or not a real link. */
function InviteFailed({ code, message, signedIn }: { code: string | undefined; message: string; signedIn: boolean }) {
  const expired = code === TEAM_ERROR_CODES.inviteExpired;
  return (
    <>
      <span className="oa-icon-box size-12 border-transparent bg-danger-soft text-danger">
        <CircleAlert aria-hidden className="size-5" />
      </span>
      <AuthIntro title={expired ? "This invite has expired" : "This invite link doesn’t work"}>
        {expired
          ? "Invite links work for 7 days. Ask the team owner to send you a new one."
          : "It may have been used already or withdrawn, or the link was copied incompletely. Ask the team owner to send a new invite."}
      </AuthIntro>
      <Notice tone="danger">{message}</Notice>
      <Button asChild variant="secondary" size="lg" block>
        <Link href={signedIn ? "/upload" : "/"}>{signedIn ? "Open OpenAssets" : "Go to OpenAssets"}</Link>
      </Button>
    </>
  );
}

/**
 * The page behind the link in an invite email. Anyone with the link sees which
 * team and for which address; joining needs a signed-in account with that
 * address (the server checks it too). Signed out, sign-in and sign-up carry the
 * link along as `next`, so people come straight back here.
 */
export function InviteScreen({ token }: { token: string }) {
  const { user, loading: authLoading, logout } = useAuth();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState<string | null>(null);
  const [error, setError] = useState<{ code: string | undefined; message: string } | null>(null);

  useEffect(() => {
    let alive = true;
    previewInvite(token).then(
      (res) => alive && setLoaded({ token, status: "ready", invite: res.data }),
      (err: unknown) => {
        if (!alive) return;
        const code = err instanceof ApiRequestError ? err.code : undefined;
        setLoaded({ token, status: "failed", code, message: err instanceof Error ? err.message : "Could not check this invite." });
      },
    );
    return () => {
      alive = false;
    };
  }, [token]);

  const here = `/team/invite/${token}`;
  const current = loaded?.token === token ? loaded : null;

  async function handleJoin(teamName: string) {
    if (joining) return;
    setJoining(true);
    setError(null);
    try {
      await acceptInvite(token);
      setJoined(teamName);
      toast.success(`You joined ${teamName}`);
    } catch (err) {
      setError({
        code: err instanceof ApiRequestError ? err.code : undefined,
        message: err instanceof Error ? err.message : "Could not join the team. Try again.",
      });
    } finally {
      setJoining(false);
    }
  }

  async function handleSwitchAccount() {
    await logout();
    window.location.assign(withNext("/login", here));
  }

  if (joined) {
    return (
      <>
        <p role="status" className="sr-only">
          You joined {joined}.
        </p>
        <span className="oa-icon-box size-12 border-transparent bg-success-soft text-success">
          <CircleCheck aria-hidden className="size-5" />
        </span>
        <AuthIntro title={`You joined ${joined}`}>
          The collections the owner shares with the team are in My collections, under Team. You can view, edit and
          download them.
        </AuthIntro>
        <Button asChild variant="primary" size="lg" block>
          <Link href="/dashboard/collections">Open team collections</Link>
        </Button>
      </>
    );
  }

  if (!current || authLoading) return <AuthStatus>Checking your invite…</AuthStatus>;
  if (current.status === "failed") {
    return <InviteFailed code={current.code} message={current.message} signedIn={Boolean(user)} />;
  }

  const { invite } = current;
  const matches = user ? user.email.trim().toLowerCase() === invite.email.toLowerCase() : false;

  return (
    <>
      <AuthIntro title={`Join ${invite.teamName}`}>
        {invite.invitedBy} invited you to share collections on OpenAssets. Team members can view, edit and download
        what the owner shares.
      </AuthIntro>
      <Facts invite={invite} />

      {invite.readOnly && (
        <Notice tone="warning" role="status">
          This team is read-only right now because the owner&apos;s plan no longer includes team sharing, so nobody can
          join yet. Ask the owner to renew it.
        </Notice>
      )}
      {error && (
        <Notice tone="danger" role="alert">
          <div className="flex flex-col items-start gap-2">
            <p>{error.message}</p>
            {error.code === TEAM_ERROR_CODES.alreadyInTeam && (
              <Link href="/settings#team" className="oa-link">
                Open team settings
              </Link>
            )}
          </div>
        </Notice>
      )}

      {!user && (
        <>
          <Notice tone="info">
            Sign in or create an account with <span className="oa-value break-all">{invite.email}</span> to accept.
          </Notice>
          <div className="flex flex-col gap-3">
            <Button asChild variant="primary" size="lg" block>
              <Link href={withNext("/login", here)}>Sign in</Link>
            </Button>
            <Button asChild variant="secondary" size="lg" block>
              <Link href={withNext("/register", here)}>Create account</Link>
            </Button>
          </div>
        </>
      )}

      {user && matches && (
        <div className="flex flex-col gap-3">
          <p className="text-xs leading-[18px] text-ink-2">
            Signed in as <span className="oa-value break-all">{user.email}</span>.
          </p>
          <Button
            variant="primary"
            size="lg"
            block
            disabled={joining || invite.readOnly}
            aria-busy={joining || undefined}
            onClick={() => void handleJoin(invite.teamName)}
          >
            {joining && <LoaderCircle aria-hidden className="animate-spin" />}
            Join team
          </Button>
        </div>
      )}

      {user && !matches && (
        <>
          <Notice tone="warning" role="status">
            You are signed in as <span className="oa-value break-all">{user.email}</span>, but this invite was sent to{" "}
            <span className="oa-value break-all">{invite.email}</span>. Sign in with that address to accept it.
          </Notice>
          <div className="flex flex-col gap-3">
            <Button variant="primary" size="lg" block onClick={() => void handleSwitchAccount()}>
              Sign in with another account
            </Button>
            <Button asChild variant="secondary" size="lg" block>
              <Link href="/upload">Not now</Link>
            </Button>
          </div>
        </>
      )}
    </>
  );
}
