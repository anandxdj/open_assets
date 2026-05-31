"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Search, Heart, Download, Loader2, Boxes } from "lucide-react";
import {
  listCollections,
  type CollectionSummary,
  type SortKey,
} from "@/features/collections/api";
import { cn } from "@/lib/utils";
import { Navbar } from "@/components/layout/Navbar";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "createdAt", label: "Newest" },
  { key: "likesCount", label: "Most Liked" },
  { key: "downloadCount", label: "Most Downloaded" },
];

function creatorName(c: CollectionSummary): string {
  return typeof c.creator === "string" ? "Unknown" : c.creator?.name ?? "Unknown";
}

function creatorPicture(c: CollectionSummary): string | undefined {
  return typeof c.creator === "string" ? undefined : c.creator?.picture;
}

function AuthorBadge({ collection }: { collection: CollectionSummary }) {
  const name = creatorName(collection);
  const picture = creatorPicture(collection);
  return (
    <div className="flex items-center gap-1.5 mt-1.5">
      {picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={picture} alt={name} className="h-4 w-4 rounded-full object-cover border border-zinc-200 dark:border-zinc-700" />
      ) : (
        <span className="h-4 w-4 rounded-full grid place-items-center bg-zinc-100 dark:bg-zinc-800 text-[8px] font-black text-[#00ff66] border border-zinc-200 dark:border-zinc-700">
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider truncate">{name}</span>
    </div>
  );
}

function CoverCollage({ urls }: { urls: string[] }) {
  const cells = urls.slice(0, 4);
  while (cells.length < 4 && urls.length > 0) cells.push(urls[cells.length % urls.length]);
  if (cells.length === 0) {
    return (
      <div className="aspect-[4/3] w-full grid place-items-center bg-zinc-50 dark:bg-zinc-900/60 border-b border-zinc-200 dark:border-zinc-800">
        <Boxes className="h-8 w-8 text-zinc-400 dark:text-zinc-700" />
      </div>
    );
  }
  return (
    <div className="aspect-[4/3] w-full grid grid-cols-2 grid-rows-2 gap-px bg-zinc-200 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-800 overflow-hidden">
      {cells.map((u, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={u} alt="" className="h-full w-full object-cover bg-zinc-50 dark:bg-zinc-950" loading="lazy" />
      ))}
    </div>
  );
}

export default function CollectionsGalleryPage() {
  const [items, setItems] = useState<CollectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<SortKey>("createdAt");

  // Debounce the search box so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listCollections({ q: debounced || undefined, sort, limit: 48 });
      setItems(res.data.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [debounced, sort]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-background text-foreground font-mono transition-colors duration-200">
      <Navbar />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-black uppercase tracking-tight">Public Collections</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 uppercase tracking-wider">
            Community-shared asset packs — extracted, named and ready to download.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-600" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search packs, tags…"
              className="w-full bg-card border border-zinc-200 dark:border-zinc-800 focus:border-[#00ff66] outline-none rounded px-9 py-2.5 text-sm placeholder:text-zinc-400 dark:placeholder:text-zinc-600 text-foreground transition-colors"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={cn(
                  "text-[10px] px-3 py-2.5 border uppercase font-bold tracking-wider rounded transition-colors cursor-pointer",
                  sort === s.key
                    ? "bg-[#00ff66] text-black border-[#00ff66]"
                    : "text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid place-items-center py-24">
            <Loader2 className="h-7 w-7 text-[#00ff66] animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="grid place-items-center py-24 text-center gap-3">
            <Boxes className="h-10 w-10 text-zinc-400 dark:text-zinc-700" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">No collections found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {items.map((c) => (
              <Link
                key={c._id}
                href={`/collections/${c._id}`}
                className="group border border-zinc-200 dark:border-zinc-800 bg-card rounded-md overflow-hidden hover:border-[#00ff66]/60 hover:-translate-y-1 transition-all duration-200"
              >
                <CoverCollage urls={c.coverImageUrls} />
                <div className="p-4">
                  <h3 className="text-sm font-black uppercase tracking-wide truncate group-hover:text-[#00ff66] transition-colors text-foreground">
                    {c.name}
                  </h3>
                  <AuthorBadge collection={c} />
                  {c.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2.5">
                      {c.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="text-[9px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 rounded uppercase tracking-wider"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-4 mt-3 text-[10px] text-zinc-400 dark:text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Heart className="h-3 w-3" /> {c.likesCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <Download className="h-3 w-3" /> {c.downloadCount}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
