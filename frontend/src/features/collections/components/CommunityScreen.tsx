"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Compass, Download, Heart, Search } from "lucide-react";
import { Crumbs, PageBody, PageTitle, Topbar } from "@/components/layout/AppShell";
import { Avatar } from "@/components/layout/UserMenu";
import { Button } from "@/components/ui/button";
import { EmptyState, Loading } from "@/components/ui/feedback";
import { InputGroup, Select } from "@/components/ui/input";
import { listCollections, type CollectionSummary, type SortKey } from "@/features/collections/api";
import { CoverGrid } from "@/features/collections/components/CoverGrid";
import { creatorName, creatorPicture, formatCount } from "@/features/collections/format";
import { cn } from "@/lib/utils";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "createdAt", label: "Newest" },
  { key: "likesCount", label: "Most liked" },
  { key: "downloadCount", label: "Most downloaded" },
];

const PAGE_SIZE = 48;
const DEBOUNCE_MS = 350;

type Result = { key: string; items: CollectionSummary[]; error: string | null };

function PackCard({ collection: c }: { collection: CollectionSummary }) {
  const author = creatorName(c);
  return (
    <li className="relative flex flex-col gap-2.5">
      <CoverGrid urls={c.coverImageUrls} />
      <div className="flex flex-col gap-1.5">
        <Link
          href={`/collections/${c._id}`}
          className="truncate text-xs font-medium leading-[18px] text-ink after:absolute after:inset-0 hover:underline hover:decoration-[1.5px] hover:underline-offset-[3px]"
        >
          {c.name}
        </Link>
        <span className="flex items-center gap-2 text-[11px] leading-4 text-ink-2">
          <Avatar name={author} picture={creatorPicture(c)} className="size-5 text-[9px]" />
          <span className="min-w-0 flex-1 truncate">{author}</span>
          <span className="flex items-center gap-1">
            <Heart aria-hidden className="size-3.5" />
            <span className="sr-only">Likes:</span>
            {formatCount(c.likesCount)}
          </span>
          <span className="flex items-center gap-1">
            <Download aria-hidden className="size-3.5" />
            <span className="sr-only">Downloads:</span>
            {formatCount(c.downloadCount)}
          </span>
        </span>
      </div>
    </li>
  );
}

export function CommunityScreen() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<SortKey>("createdAt");
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  // Debounce the search box so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const key = `${debounced}\u0000${sort}\u0000${attempt}`;

  useEffect(() => {
    let alive = true;
    listCollections({ q: debounced || undefined, sort, limit: PAGE_SIZE })
      .then((res) => {
        if (alive) setResult({ key, items: res.data.items, error: null });
      })
      .catch((err: unknown) => {
        if (alive) {
          setResult({ key, items: [], error: err instanceof Error ? err.message : "The server did not answer." });
        }
      });
    return () => {
      alive = false;
    };
  }, [key, debounced, sort]);

  const loading = result?.key !== key;
  const items = result?.items ?? [];

  const announcement = loading
    ? "Loading collections"
    : result?.error
      ? "Could not load collections"
      : `${items.length} ${items.length === 1 ? "collection" : "collections"}${debounced ? ` for “${debounced}”` : ""}`;

  let body: React.ReactNode;
  if (!result) {
    body = (
<Loading label="Loading collections" announce={false} className="justify-center py-16" />
    );
  } else if (result.error) {
    body = (
      <EmptyState
        tone="danger"
        title="Could not load community collections"
        description={result.error}
        actions={<Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}
      />
    );
  } else if (items.length === 0) {
    body = debounced ? (
      <EmptyState
        icon={<Search aria-hidden className="size-5" />}
        title="No collections found"
        description={`Nothing matches “${debounced}”. Try another word or tag.`}
        actions={
          <Button variant="ghost" onClick={() => setQuery("")}>
            Clear search
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={<Compass aria-hidden className="size-5" />}
        title="No community collections yet"
        description="Publish one of your collections to start the shelf."
        actions={
          <Button asChild>
            <Link href="/dashboard/collections">Open my collections</Link>
          </Button>
        }
      />
    );
  } else {
    body = (
      <ul
        aria-busy={loading || undefined}
        className={cn(
          "grid grid-cols-[repeat(auto-fill,minmax(min(232px,100%),1fr))] gap-x-5 gap-y-7",
          loading && "opacity-60"
        )}
      >
        {items.map((c) => (
          <PackCard key={c._id} collection={c} />
        ))}
      </ul>
    );
  }

  return (
    <>
      <Topbar>
        <Crumbs items={[{ label: "Community" }]} />
      </Topbar>
      <PageBody className="flex flex-col gap-5">
        <PageTitle title="Community collections" description="Collections other creators extracted, named and published." />
        <div role="search" className="flex flex-wrap gap-2">
          <InputGroup className="min-w-0 flex-[1_1_320px]" icon={<Search aria-hidden className="size-4 flex-none" />}>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search collections, tags…"
              aria-label="Search collections"
            />
          </InputGroup>
          <Select
            aria-label="Sort collections"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="w-full sm:w-[190px]"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <p role="status" className="sr-only">
          {announcement}
        </p>
        {body}
      </PageBody>
    </>
  );
}
