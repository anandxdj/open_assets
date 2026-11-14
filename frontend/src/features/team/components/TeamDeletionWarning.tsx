"use client";

import { Notice } from "@/components/ui/feedback";
import { getTeam } from "@/features/team/api";
import { useRemote } from "@/features/settings/useRemote";

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Shown in the delete-account dialog. An owner is told what dissolving the team
 * costs the people on it (they cannot be asked first); a member is told they
 * will simply leave. Renders nothing for someone in no team, and while loading.
 */
export function TeamDeletionWarning() {
  const remote = useRemote(async () => (await getTeam()).data, "team-deletion", "Could not check your team.");
  const team = remote.data?.team;
  if (!team) return null;

  if (team.role === "owner") {
    const others = team.members.filter((m) => m.role === "member");
    return (
      <Notice tone="warning" role="status">
        You own the team <span className="font-bold">{team.name}</span>. Deleting your account dissolves it:{" "}
        {others.length > 0
          ? `${plural(others.length, "member")} (${others
              .slice(0, 3)
              .map((m) => m.name)
              .join(", ")}${others.length > 3 ? " and more" : ""}) lose access`
          : "nobody else is on it yet"}
        {team.sharedCollections > 0
          ? `, and the ${plural(team.sharedCollections, "collection")} you shared are deleted with your account.`
          : "."}{" "}
        Pending invites stop working.
      </Notice>
    );
  }

  return (
    <Notice tone="info" role="status">
      You are in the team <span className="font-bold">{team.name}</span>. Deleting your account removes you from it.
      What you added to its collections stays with the team.
    </Notice>
  );
}
