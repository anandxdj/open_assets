"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { LoaderCircle, Search, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Crumbs, PageBody, PageTitle, Topbar } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/controls";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { EmptyState, Loading, Notice } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/context/AuthContext";
import { formatPlanDate } from "@/lib/plans";
import { searchUsers, setUserPlan, type AdminUserRow } from "../api";

function describePlan(user: AdminUserRow): { label: string; note: string | null } {
  if (user.effectivePlan === "pro") {
    const until = user.proEndsAt ? ` until ${formatPlanDate(user.proEndsAt)}` : "";
    if (user.planSource === "trial") return { label: "Pro", note: `Trial${until}` };
    if (user.planSource === "billing") return { label: "Pro", note: `Billing${until}` };
    return { label: "Pro", note: `Admin grant${until}` };
  }
  if (user.plan === "pro") return { label: "Free", note: "Pro ended" };
  return { label: "Free", note: user.trialUsed ? "Trial used" : null };
}

function SetPlanForm({
  user,
  onClose,
  onSaved,
}: {
  user: AdminUserRow;
  onClose: () => void;
  onSaved: (user: AdminUserRow) => void;
}) {
  const daysId = useId();
  const [plan, setPlan] = useState<"free" | "pro">("pro");
  const [days, setDays] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const parsed = days.trim() === "" ? null : Number(days);
    if (plan === "pro" && parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650)) {
      setError("Days must be a whole number from 1 to 3650, or empty for no end date.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const status = await setUserPlan(user.id, plan, plan === "pro" ? parsed : null);
      onSaved({
        ...user,
        plan: status.plan,
        effectivePlan: status.effectivePlan,
        planSource: status.planSource,
        proEndsAt: status.proEndsAt,
        trialUsed: status.trial.used,
      });
      toast.success(`${user.email} is now on ${status.effectivePlan === "pro" ? "Pro" : "Free"}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the plan. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="flex min-h-0 flex-col">
      <DialogBody>
        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        <div className="oa-field">
          <span className="oa-field-label">Plan</span>
          <Segmented<"free" | "pro">
            ariaLabel="Plan"
            value={plan}
            onChange={setPlan}
            options={[
              { value: "pro", label: "Pro" },
              { value: "free", label: "Free" },
            ]}
          />
        </div>
        <Field
          label="Days of Pro"
          htmlFor={daysId}
          help="Empty means no end date. With a number, Pro ends by itself after that many days."
        >
          <Input
            id={daysId}
            type="number"
            inputMode="numeric"
            min={1}
            max={3650}
            placeholder="No end date"
            value={days}
            disabled={plan === "free"}
            onChange={(e) => setDays(e.target.value)}
            aria-describedby={`${daysId}-note`}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" aria-disabled={saving || undefined}>
          {saving && <LoaderCircle aria-hidden className="animate-spin" />}
          Save plan
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The form is mounted only while a user is being edited, so it starts fresh every time. */
function SetPlanDialog({
  user,
  onClose,
  onSaved,
}: {
  user: AdminUserRow | null;
  onClose: () => void;
  onSaved: (user: AdminUserRow) => void;
}) {
  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      {user && (
        <DialogContent title="Set plan" description={<span className="oa-value">{user.email}</span>}>
          <SetPlanForm key={user.id} user={user} onClose={onClose} onSaved={onSaved} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function UsersTable({ users, onEdit }: { users: AdminUserRow[]; onEdit: (user: AdminUserRow) => void }) {
  return (
    <div className="oa-table-box">
      <table className="oa-table">
        <caption className="sr-only">Users and their plans</caption>
        <thead>
          <tr>
            <th scope="col">User</th>
            <th scope="col" className="hidden sm:table-cell">
              Plan
            </th>
            <th scope="col" className="hidden sm:table-cell">
              Sheets this month
            </th>
            <th scope="col" className="hidden md:table-cell">
              Joined
            </th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const plan = describePlan(user);
            return (
              <tr key={user.id}>
                <td>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="oa-value max-w-[150px] truncate text-[13px] sm:max-w-[280px]" title={user.email}>
                      {user.email}
                    </span>
                    <span className="flex items-center gap-2 text-[11px] leading-4 text-ink-3">
                      <span className="max-w-[110px] truncate normal-case sm:max-w-[200px]">{user.name}</span>
                      {user.role === "admin" && <Badge>Admin</Badge>}
                      {!user.isVerified && <Badge tone="warning">Unverified</Badge>}
                    </span>
                    {/* Phones have no room for a Plan column, so the plan sits under the name. */}
                    <span className="mt-1 flex flex-col items-start gap-1 sm:hidden">
                      <Badge tone={plan.label === "Pro" ? "pro" : "neutral"}>{plan.label}</Badge>
                      {plan.note && <span className="text-[11px] leading-4 normal-case text-ink-2">{plan.note}</span>}
                    </span>
                  </span>
                </td>
                <td className="hidden sm:table-cell">
                  <span className="flex flex-col items-start gap-1">
                    <Badge tone={plan.label === "Pro" ? "pro" : "neutral"}>{plan.label}</Badge>
                    {plan.note && <span className="text-[11px] leading-4 normal-case text-ink-2">{plan.note}</span>}
                  </span>
                </td>
                <td className="hidden tabular-nums text-ink-2 sm:table-cell">{user.sheetsThisMonth}</td>
                <td className="hidden text-ink-2 md:table-cell">
                  {user.createdAt ? (
                    <time dateTime={user.createdAt}>{formatPlanDate(user.createdAt)}</time>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="text-right">
                  <Button size="sm" onClick={() => onEdit(user)}>
                    Set plan
                    <span className="sr-only"> for {user.email}</span>
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Admin-only user list with search and a plan editor. The API checks the role too. */
export function AdminScreen() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const searchId = useId();
  const [query, setQuery] = useState("");
  // The search that is wanted, and the answer for the latest one. Loading is the
  // gap between them, so nothing sets state synchronously inside the effect.
  const [wanted, setWanted] = useState({ q: "", n: 0 });
  const [answer, setAnswer] = useState<{ n: number; users: AdminUserRow[] | null; error: string | null } | null>(null);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    searchUsers(wanted.q)
      .then((users) => {
        if (!cancelled) setAnswer({ n: wanted.n, users, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setAnswer({ n: wanted.n, users: null, error: err instanceof Error ? err.message : "Could not load users." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, wanted]);

  const loading = isAdmin && answer?.n !== wanted.n;
  const users = answer?.n === wanted.n ? answer.users : (answer?.users ?? null);
  const error = answer?.n === wanted.n ? answer.error : null;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setWanted((w) => ({ q: query, n: w.n + 1 }));
  }

  function handleSaved(updated: AdminUserRow) {
    setAnswer((prev) =>
      prev ? { ...prev, users: prev.users?.map((u) => (u.id === updated.id ? updated : u)) ?? prev.users } : prev
    );
  }

  if (!isAdmin) {
    return (
      <>
        <Topbar>
          <Crumbs items={[{ label: "Admin" }]} />
        </Topbar>
        <PageBody>
          <EmptyState
            headingLevel={1}
            icon={<ShieldOff aria-hidden className="size-5" />}
            title="Admins only"
            description="This page is for OpenAssets admins. Your account does not have access."
            actions={
              <Button asChild variant="primary">
                <Link href="/upload">Back to Extract</Link>
              </Button>
            }
          />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <Topbar>
        <Crumbs items={[{ label: "Admin" }, { label: "Users" }]} />
      </Topbar>
      <PageBody className="flex flex-col gap-5">
        <PageTitle
          title="Users"
          description="Find an account and set its plan. Pro is granted by hand until billing exists."
        />

        <form onSubmit={handleSearch} role="search" className="flex flex-wrap items-end gap-2.5">
          <Field label="Search users" htmlFor={searchId} className="min-w-[240px] flex-1 sm:max-w-[420px]">
            <Input
              id={searchId}
              type="search"
              placeholder="Email or name"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
          <Button type="submit" aria-disabled={loading || undefined}>
            {loading ? <LoaderCircle aria-hidden className="animate-spin" /> : <Search aria-hidden />}
            Search
          </Button>
        </form>

        <p role="status" className="sr-only">
          {loading ? "Loading users" : users ? `${users.length} user${users.length === 1 ? "" : "s"} found` : ""}
        </p>

        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}

        {users && users.length > 0 && <UsersTable users={users} onEdit={setEditing} />}
        {users && users.length === 0 && (
          <EmptyState
            title="No users found"
            description="Nothing matches that search. Try part of an email address or a name."
          />
        )}
        {!users && loading && <Loading label="Loading users" />}
      </PageBody>

      <SetPlanDialog user={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />
    </>
  );
}
