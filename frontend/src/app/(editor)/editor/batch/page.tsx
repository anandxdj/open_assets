import { LegacyBatchRedirect } from "@/features/editor/components/LegacyBatchRedirect";

export default async function BatchEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ jobs?: string | string[] }>;
}) {
  const rawJobs = (await searchParams).jobs;
  const value = Array.isArray(rawJobs) ? rawJobs[0] : rawJobs;
  const jobIds = (value ?? "")
    .split(",")
    .map((jobId) => jobId.trim())
    .filter((jobId) => /^[0-9a-f-]{36}$/i.test(jobId))
    .slice(0, 20);

  return <LegacyBatchRedirect jobIds={jobIds} />;
}
