"use client";

import { useId, useState, type FormEvent } from "react";
import { LoaderCircle, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, describedBy } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/feedback";
import { useAuth } from "@/features/auth/context/AuthContext";
import { NameDialog } from "@/features/collections/components/CollectionDialogs";
import { formatFullDate, formatRelativeTime, useNow } from "@/features/jobs/time";
import { ProGate } from "@/features/plans/ProGate";
import { UpgradeAction } from "@/features/plans/UpgradeAction";
import { errorMessage } from "@/features/settings/api";
import { SectionError, SectionLoading, SubSection } from "@/features/settings/components/parts";
import { useRemote } from "@/features/settings/useRemote";
import {
  createTeam,
  dissolveTeam,
  getTeam,
  inviteMember,
  leaveTeam,
  removeMember,
  renameTeam,
  resendInvite,
  revokeInvite,
  type Team,
  type TeamInvite,
  type TeamMember,
  type TeamOverview,
} from "@/features/team/api";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ApiRequestError } from "@/lib/api-error";
import { ENTITLEMENT_TABLE } from "@/lib/plans";

const shortDay = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/* ------------------------------ gate ----------------------------------- */

/** Free accounts: the section is visible but locked, with the way up. */
function Locked({ onStarted }: { onStarted: () => void }) {
  return (
    <ProGate
      layout="block"
      feature="Team sharing"
      description={`Invite people by email and share your collections with them. Everyone on the team can view, edit and download what you share. Teammates can be on any plan. A team takes up to ${ENTITLEMENT_TABLE.pro.teamSeats} people, you included.`}
      onStarted={onStarted}
    />
  );
}

/* ------------------------------ create --------------------------------- */

function CreateTeam({ seatLimit, onCreated }: { seatLimit: number; onCreated: () => void }) {
  const id = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const next = name.trim();
    if (next.length < 2) {
      setError("Use at least 2 characters.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await createTeam(next);
      toast.success("Team created", { description: next });
      onCreated();
    } catch (err) {
      setFormError(errorMessage(err, "Could not create the team. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-[460px] flex-col gap-4">
      {formError && (
        <Notice tone="danger" role="alert">
          {formError}
        </Notice>
      )}
      <Field
        label="Team name"
        htmlFor={id}
        error={error}
        help={`Up to ${seatLimit} people, yourself included. You can be in one team at a time.`}
      >
        <Input
          id={id}
          value={name}
          maxLength={80}
          placeholder="e.g. Pixel crew"
          invalid={Boolean(error)}
          aria-describedby={describedBy(id, true)}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
        />
      </Field>
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy && <LoaderCircle aria-hidden className="animate-spin" />}
          Create team
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------ members -------------------------------- */

function MemberTable({
  team,
  meId,
  busyId,
  onRemove,
  now,
}: {
  team: Team;
  meId: string | undefined;
  busyId: string | null;
  onRemove: (member: TeamMember) => void;
  now: number;
}) {
  const isOwner = team.role === "owner";
  return (
    <div className="oa-table-box">
      <table className="oa-table">
        <caption className="sr-only">People in {team.name}</caption>
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col">Role</th>
            <th scope="col" className="hidden sm:table-cell">
              Joined
            </th>
            {isOwner && (
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {team.members.map((m) => {
            const ms = Date.parse(m.joinedAt);
            return (
              <tr key={m.id} aria-busy={busyId === m.id || undefined}>
                <td>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-medium">
                      {m.name}
                      {m.id === meId && <span className="text-ink-3"> (you)</span>}
                    </span>
                    <span className="max-w-[240px] truncate text-[11px] text-ink-3" title={m.email}>
                      {m.email}
                    </span>
                  </span>
                </td>
                <td>
                  <Badge className={m.role === "owner" ? "text-ink" : undefined}>{m.role === "owner" ? "Owner" : "Member"}</Badge>
                </td>
                <td className="hidden text-ink-2 sm:table-cell">
                  <time dateTime={m.joinedAt} title={formatFullDate(ms)}>
                    {formatRelativeTime(ms, now)}
                  </time>
                </td>
                {isOwner && (
                  <td className="text-right">
                    {m.role === "member" && (
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={busyId !== null}
                        aria-label={`Remove ${m.name} from the team`}
                        onClick={() => onRemove(m)}
                      >
                        {busyId === m.id && <LoaderCircle aria-hidden className="animate-spin" />}
                        Remove
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ invites -------------------------------- */

function InviteForm({ team, onInvited }: { team: Team; onInvited: () => void }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const full = team.seats.used >= team.seats.limit;
  const blocked = team.readOnly || full;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || blocked) return;
    const next = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await inviteMember(next);
      setEmail("");
      toast.success("Invite sent", { description: `${next}. The link works for 7 days.` });
      onInvited();
    } catch (err) {
      setFormError(errorMessage(err, "Could not send the invite. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-[460px] flex-col gap-4">
      {full && !team.readOnly && (
        <Notice tone="info" role="status">
          All {team.seats.limit} seats are taken. Withdraw an invite or remove a member to make room.
        </Notice>
      )}
      {formError && (
        <Notice tone="danger" role="alert">
          {formError}
        </Notice>
      )}
      <Field
        label="Email address"
        htmlFor={id}
        error={error}
        help="They get a link by email. It works for 7 days and only for this address."
      >
        <Input
          id={id}
          type="email"
          autoComplete="off"
          value={email}
          disabled={blocked}
          placeholder="teammate@studio.com"
          invalid={Boolean(error)}
          aria-describedby={describedBy(id, true)}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
        />
      </Field>
      <div>
        <Button type="submit" disabled={busy || blocked} aria-busy={busy || undefined}>
          {busy && <LoaderCircle aria-hidden className="animate-spin" />}
          Send invite
        </Button>
      </div>
    </form>
  );
}

function InviteTable({
  invites,
  busyId,
  readOnly,
  onResend,
  onRevoke,
}: {
  invites: TeamInvite[];
  busyId: string | null;
  readOnly: boolean;
  onResend: (invite: TeamInvite) => void;
  onRevoke: (invite: TeamInvite) => void;
}) {
  return (
    <div className="oa-table-box">
      <table className="oa-table">
        <caption className="sr-only">Invites that have not been accepted</caption>
        <thead>
          <tr>
            <th scope="col">Email</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {invites.map((i) => (
            <tr key={i.id} aria-busy={busyId === i.id || undefined}>
              <td>
                <span className="block max-w-[240px] truncate text-[13px] font-medium" title={i.email}>
                  {i.email}
                </span>
              </td>
              <td>
                {i.expired ? (
                  <Badge tone="warning">Expired</Badge>
                ) : (
                  <span className="flex flex-col gap-1">
                    <Badge>Pending</Badge>
                    <span className="text-[11px] text-ink-3">
                      Until <time dateTime={i.expiresAt}>{shortDay.format(Date.parse(i.expiresAt))}</time>
                    </span>
                  </span>
                )}
              </td>
              <td className="text-right">
                <span className="inline-flex flex-wrap justify-end gap-1.5">
                  <Button
                    size="sm"
                    disabled={busyId !== null || readOnly}
                    aria-label={`Resend the invite to ${i.email}`}
                    onClick={() => onResend(i)}
                  >
                    {busyId === i.id && <LoaderCircle aria-hidden className="animate-spin" />}
                    Resend
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busyId !== null}
                    aria-label={`Withdraw the invite to ${i.email}`}
                    onClick={() => onRevoke(i)}
                  >
                    Withdraw
                  </Button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------- team ---------------------------------- */

type Confirm =
  | { kind: "remove"; member: TeamMember }
  | { kind: "revoke"; invite: TeamInvite }
  | { kind: "leave" }
  | { kind: "dissolve" };

function ReadOnlyNotice({ team, onStarted }: { team: Team; onStarted: () => void }) {
  if (team.role === "owner") {
    return (
      <Notice tone="warning" role="status">
        <div className="flex flex-col items-start gap-2.5">
          <p>
            Your plan no longer includes team sharing, so this team is read-only. Members can still view and download
            its collections, but nobody can edit them, no invites go out, and nobody new can join. You can still remove
            members, withdraw invites and take collections back.
          </p>
          <UpgradeAction onStarted={onStarted} />
        </div>
      </Notice>
    );
  }
  return (
    <Notice tone="warning" role="status">
      This team is read-only because {team.owner.name}&apos;s plan no longer includes team sharing. You can still view
      and download its collections, but not edit them.
    </Notice>
  );
}

function TeamDetails({ team, reload }: { team: Team; reload: () => void }) {
  const { user } = useAuth();
  const now = useNow();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [renaming, setRenaming] = useState(false);
  const isOwner = team.role === "owner";

  async function run(id: string | null, action: () => Promise<unknown>, success: string, failure: string, description?: string) {
    if (id) setBusyId(id);
    try {
      await action();
      toast.success(success, description ? { description } : undefined);
      reload();
      return true;
    } catch (err) {
      toast.error(failure, { description: errorMessage(err, "Try again.") });
      // The server may have changed under us (an invite was accepted, a plan lapsed).
      if (err instanceof ApiRequestError && err.status === 404) reload();
      return false;
    } finally {
      if (id) setBusyId(null);
    }
  }

  const handleResend = (invite: TeamInvite) =>
    run(invite.id, () => resendInvite(invite.id), "Invite sent again", "Could not resend the invite", `${invite.email}. The old link no longer works.`);

  function handleConfirm(): Promise<boolean> {
    if (!confirm) return Promise.resolve(true);
    switch (confirm.kind) {
      case "remove":
        return run(confirm.member.id, () => removeMember(confirm.member.id), "Member removed", "Could not remove them", confirm.member.name);
      case "revoke":
        return run(confirm.invite.id, () => revokeInvite(confirm.invite.id), "Invite withdrawn", "Could not withdraw the invite", confirm.invite.email);
      case "leave":
        return run(null, leaveTeam, "You left the team", "Could not leave the team", team.name);
      case "dissolve":
        return run(null, dissolveTeam, "Team dissolved", "Could not dissolve the team", team.name);
    }
  }

  const copy: Record<Confirm["kind"], { title: string; description: React.ReactNode; confirmLabel: string }> = {
    remove: {
      title: "Remove this person?",
      description: (
        <>
          <span className="font-bold text-ink">{confirm?.kind === "remove" ? confirm.member.name : ""}</span> loses access to{" "}
          {team.name}&apos;s collections right away. What they added stays. You can invite them again later.
        </>
      ),
      confirmLabel: "Remove from team",
    },
    revoke: {
      title: "Withdraw this invite?",
      description: (
        <>
          The link sent to <span className="font-bold text-ink">{confirm?.kind === "revoke" ? confirm.invite.email : ""}</span>{" "}
          stops working and the seat is free again.
        </>
      ),
      confirmLabel: "Withdraw invite",
    },
    leave: {
      title: `Leave ${team.name}?`,
      description:
        "You lose access to the team's collections right away. Anything you added stays with the team. The owner can invite you again.",
      confirmLabel: "Leave team",
    },
    dissolve: {
      title: `Dissolve ${team.name}?`,
      description: `The team, its ${plural(Math.max(0, team.members.length - 1), "member")} and pending invites are removed. Your collections stay yours; they just stop being shared, so members lose access to them.`,
      confirmLabel: "Dissolve team",
    },
  };
  const active = copy[confirm?.kind ?? "leave"];
  const pending = team.invites;

  return (
    <>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <span className="oa-label">Your team</span>
            <span className="oa-h3 min-w-0 break-words">{team.name}</span>
            <Badge className={isOwner ? "text-ink" : undefined}>{isOwner ? "Owner" : "Member"}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs text-ink-2" aria-label="Seats in use">
              {team.readOnly
                ? `${team.members.length} ${team.members.length === 1 ? "person" : "people"}`
                : `${team.seats.used} of ${team.seats.limit} seats`}
            </span>
            {isOwner && (
              <Button size="sm" onClick={() => setRenaming(true)}>
                Rename
              </Button>
            )}
          </div>
        </div>

        {team.readOnly && <ReadOnlyNotice team={team} onStarted={reload} />}

        <p className="max-w-[60ch] text-xs leading-[18px] text-ink-2">
          {isOwner
            ? `Share one of your collections with the team from its menu in My collections (${plural(team.sharedCollections, "collection")} shared now). Members can view, edit and download it. You keep renaming, publishing and deleting.`
            : `${team.owner.name} owns this team. You can view, edit and download the collections they share, from the Team tab in My collections.`}
        </p>
      </div>

      <SubSection title="People" description="Everyone with access to the team's collections.">
        <MemberTable team={team} meId={user?._id} busyId={busyId} now={now} onRemove={(member) => setConfirm({ kind: "remove", member })} />
      </SubSection>

      {isOwner && (
        <SubSection title="Invite someone" description="Teammates can be on any plan. They sign in or create an account with the invited address.">
          <InviteForm team={team} onInvited={reload} />
        </SubSection>
      )}

      {isOwner && pending.length > 0 && (
        <SubSection
          title="Pending invites"
          description="Invites that have not been accepted. An invite holds a seat until it expires or you withdraw it."
        >
          <InviteTable
            invites={pending}
            busyId={busyId}
            readOnly={team.readOnly}
            onResend={(invite) => void handleResend(invite)}
            onRevoke={(invite) => setConfirm({ kind: "revoke", invite })}
          />
        </SubSection>
      )}

      <SubSection
        title={isOwner ? "Dissolve team" : "Leave team"}
        description={
          isOwner
            ? "Removes the team, its members and pending invites. Your collections stay yours and stop being shared."
            : "You lose access to the team's collections. What you added stays with the team."
        }
      >
        <div>
          <Button variant="danger" onClick={() => setConfirm({ kind: isOwner ? "dissolve" : "leave" })}>
            {isOwner ? "Dissolve team" : "Leave team"}
          </Button>
        </div>
      </SubSection>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={active.title}
        description={active.description}
        confirmLabel={active.confirmLabel}
        onConfirm={handleConfirm}
      />
      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename team"
        submitLabel="Save name"
        initialName={team.name}
        minLength={2}
        onSubmit={async (name) => {
          if (name === team.name) return true;
          return run(null, () => renameTeam(name), "Team renamed", "Could not rename the team", name);
        }}
      />
    </>
  );
}

/* ------------------------------- section ------------------------------- */

/** The Team section of Settings: create, members, invites, leave or dissolve. */
export function TeamContent() {
  const remote = useRemote<TeamOverview>(async () => (await getTeam()).data, "team", "Could not load your team.");

  if (remote.status === "error" && remote.data === undefined) {
    return <SectionError message={remote.error ?? ""} onRetry={remote.reload} />;
  }
  if (remote.data === undefined) return <SectionLoading label="Loading team" />;

  const overview = remote.data;
  if (overview.team) return <TeamDetails key={overview.team.id} team={overview.team} reload={remote.reload} />;

  if (!overview.entitled) return <Locked onStarted={remote.reload} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex max-w-[560px] items-start gap-3">
        <span className="oa-icon-box" aria-hidden>
          <Users className="size-4" />
        </span>
        <p className="text-xs leading-[18px] text-ink-2">
          You are not in a team yet. Create one to share collections: members can view, edit and download them.
        </p>
      </div>
      <CreateTeam seatLimit={overview.seatLimit} onCreated={remote.reload} />
    </div>
  );
}
