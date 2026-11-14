"use client";

import { Crumbs, PageBody, PageTitle, Topbar } from "@/components/layout/AppShell";
import { useAuth } from "@/features/auth/context/AuthContext";
import { getAccount } from "@/features/settings/api";
import { ApiKeysContent } from "@/features/settings/components/ApiKeysSection";
import { DangerZoneContent } from "@/features/settings/components/DangerZone";
import { ExportContent } from "@/features/settings/components/ExportSection";
import { PlanUsageContent } from "@/features/settings/components/PlanUsageSection";
import { ProfileSection } from "@/features/settings/components/ProfileSection";
import { SecurityContent } from "@/features/settings/components/SecuritySection";
import { SectionError, SectionLoading, SettingsSection } from "@/features/settings/components/parts";
import { useRemote } from "@/features/settings/useRemote";
import { TeamContent } from "@/features/team/components/TeamSection";
import type { Account } from "@/types/account";

/** Renders `children` once the account has loaded; a loading or error state until then. */
function WithAccount({
  remote,
  label,
  children,
}: {
  remote: ReturnType<typeof useRemote<Account>>;
  label: string;
  children: (account: Account) => React.ReactNode;
}) {
  if (remote.status === "error") return <SectionError message={remote.error ?? ""} onRetry={remote.reload} />;
  if (remote.data === undefined) return <SectionLoading label={label} />;
  return <>{children(remote.data)}</>;
}

export function SettingsScreen() {
  const { updateUser } = useAuth();
  const account = useRemote(async () => (await getAccount()).data, "account", "Could not load your account.");

  return (
    <>
      <Topbar>
        <Crumbs items={[{ label: "Settings" }]} />
      </Topbar>
      <PageBody className="flex flex-col gap-6">
        <PageTitle title="Settings" description="Your profile, sign-in security, plan, team, usage and API keys." />

        <div className="flex flex-col">
          <SettingsSection id="profile" title="Profile" description="How you appear in OpenAssets, and the email you sign in with.">
            <WithAccount remote={account} label="Loading profile">
              {(a) => (
                <ProfileSection
                  key={a.id}
                  account={a}
                  onSaved={(name) => {
                    account.mutate((current) => ({ ...current, name }));
                    updateUser({ name });
                  }}
                />
              )}
            </WithAccount>
          </SettingsSection>

          <SettingsSection id="security" title="Security" description="Your password, the devices signed in to your account, and the Chrome extension.">
            <WithAccount remote={account} label="Loading security">
              {(a) => (
                <SecurityContent
                  account={a}
                  onPasswordChanged={() => account.mutate((current) => ({ ...current, hasPassword: true }))}
                />
              )}
            </WithAccount>
          </SettingsSection>

          <SettingsSection id="export" title="Export" description="How your exported files are named.">
            <ExportContent />
          </SettingsSection>

          <SettingsSection id="plan" title="Plan and usage" description="Your plan, your AI credits for the month, and what spent them.">
            <PlanUsageContent />
          </SettingsSection>

          <SettingsSection id="team" title="Team" description="Share collections with the people you work with.">
            <TeamContent />
          </SettingsSection>

          <SettingsSection id="api-keys" title="API keys" description="Keys for the OpenAssets API. Part of Pro.">
            <ApiKeysContent />
          </SettingsSection>

          <SettingsSection
            id="danger"
            title="Danger zone"
            danger
            description="Actions here cannot be undone."
          >
            <WithAccount remote={account} label="Loading">
              {(a) => <DangerZoneContent email={a.email} />}
            </WithAccount>
          </SettingsSection>
        </div>
      </PageBody>
    </>
  );
}
