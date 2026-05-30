"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Loader2,
  Trash2,
  Globe,
  Lock,
  Heart,
  Download,
  Boxes,
  ExternalLink,
  Pencil,
  Check,
  X,
} from "lucide-react";
import {
  listMyCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  type CollectionSummary,
} from "@/features/collections/api";
import { cn } from "@/lib/utils";

/** Mirrors the backend guard: a pack is "unnamed" if blank or the placeholder. */
function isUntitled(name?: string): boolean {
  const n = (name ?? "").trim().toLowerCase();
  return n === "" || n === "untitled pack";
}

export default function MyCollectionsPage() {
  const [items, setItems] = useState<CollectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishName, setPublishName] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await listMyCollections();
      setItems(res.data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const res = await createCollection({ name: name.trim() });
      setItems((prev) => [res.data, ...prev]);
      setName("");
      setCreating(false);
    } catch {
      /* ignore */
    }
  }

  async function togglePublish(c: CollectionSummary) {
    // Unpublishing is always allowed.
    if (c.isPublic) {
      setBusyId(c._id);
      try {
        const res = await updateCollection(c._id, { isPublic: false });
        setItems((prev) => prev.map((x) => (x._id === c._id ? res.data : x)));
      } catch {
        /* ignore */
      } finally {
        setBusyId(null);
      }
      return;
    }

    // Publishing an unnamed pack: force a name via the dialog first.
    if (isUntitled(c.name)) {
      setPublishingId(c._id);
      setPublishName("");
      return;
    }

    setBusyId(c._id);
    try {
      const res = await updateCollection(c._id, { isPublic: true });
      setItems((prev) => prev.map((x) => (x._id === c._id ? res.data : x)));
    } catch {
      /* ignore */
    } finally {
      setBusyId(null);
    }
  }

  async function confirmPublish() {
    const c = items.find((x) => x._id === publishingId);
    if (!c) return;
    const next = publishName.trim();
    if (next.length < 2) return; // name required
    setBusyId(c._id);
    try {
      const res = await updateCollection(c._id, { name: next, isPublic: true });
      setItems((prev) => prev.map((x) => (x._id === c._id ? res.data : x)));
      setPublishingId(null);
      setPublishName("");
    } catch {
      /* ignore */
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(c: CollectionSummary) {
    if (!confirm(`Delete "${c.name}"? This removes its images permanently.`)) return;
    setBusyId(c._id);
    try {
      await deleteCollection(c._id);
      setItems((prev) => prev.filter((x) => x._id !== c._id));
    } catch {
      /* ignore */
    } finally {
      setBusyId(null);
    }
  }

  function startRename(c: CollectionSummary) {
    setEditingId(c._id);
    setDraftName(c.name);
  }

  async function saveRename(c: CollectionSummary) {
    const next = draftName.trim();
    if (!next || next === c.name) {
      setEditingId(null);
      return;
    }
    setBusyId(c._id);
    try {
      const res = await updateCollection(c._id, { name: next });
      setItems((prev) => prev.map((x) => (x._id === c._id ? res.data : x)));
      setEditingId(null);
    } catch {
      /* ignore */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 font-mono">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight">My Collections</h1>
          <p className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">
            Drafts are private until you publish them to the community.
          </p>
        </div>
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-1.5 text-xs px-4 py-2.5 bg-zinc-950 text-white dark:bg-white dark:text-black border-2 border-zinc-950 dark:border-white font-black uppercase tracking-wider hover:scale-105 transition-transform"
        >
          <Plus className="h-3.5 w-3.5 stroke-[3px]" /> New
        </button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="flex gap-2 mb-8">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Collection name…"
            className="flex-1 border-2 border-zinc-950 dark:border-zinc-700 bg-background outline-none px-4 py-2.5 text-sm focus:border-zinc-950 dark:focus:border-white"
          />
          <button
            type="submit"
            className="px-5 py-2.5 bg-zinc-950 text-white dark:bg-white dark:text-black border-2 border-zinc-950 dark:border-white font-black uppercase text-xs tracking-wider"
          >
            Create
          </button>
        </form>
      )}

      {loading ? (
        <div className="grid place-items-center py-24">
          <Loader2 className="h-7 w-7 animate-spin text-zinc-400" />
        </div>
      ) : items.length === 0 ? (
        <div className="grid place-items-center py-24 text-center gap-3 border-2 border-dashed border-zinc-300 dark:border-zinc-800">
          <Boxes className="h-10 w-10 text-zinc-400" />
          <p className="text-sm text-zinc-500 uppercase tracking-wider">No collections yet</p>
          <p className="text-xs text-zinc-400">
            Extract assets in the{" "}
            <Link href="/upload" className="underline font-bold">
              editor
            </Link>{" "}
            — a draft pack is created for you automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((c) => (
            <div key={c._id} className="border-2 border-zinc-950 dark:border-zinc-800 bg-background flex flex-col">
              <div className="aspect-[4/3] grid grid-cols-2 grid-rows-2 gap-px bg-zinc-200 dark:bg-zinc-800 border-b-2 border-zinc-950 dark:border-zinc-800 overflow-hidden">
                {c.coverImageUrls.length > 0 ? (
                  c.coverImageUrls.slice(0, 4).map((u, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={u} alt="" className="h-full w-full object-cover bg-zinc-100 dark:bg-zinc-950" loading="lazy" />
                  ))
                ) : (
                  <div className="col-span-2 row-span-2 grid place-items-center">
                    <Boxes className="h-8 w-8 text-zinc-400" />
                  </div>
                )}
              </div>

              <div className="p-4 flex flex-col flex-1">
                <div className="flex items-start justify-between gap-2">
                  {editingId === c._id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveRename(c);
                      }}
                      className="flex items-center gap-1 flex-1 min-w-0"
                    >
                      <input
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => e.key === "Escape" && setEditingId(null)}
                        className="flex-1 min-w-0 text-sm font-black uppercase tracking-wide bg-background border-b-2 border-zinc-950 dark:border-white outline-none px-0.5 py-0.5"
                      />
                      <button type="submit" disabled={busyId === c._id} className="shrink-0 text-green-600 hover:text-green-500" title="Save">
                        <Check className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className="shrink-0 text-zinc-500 hover:text-foreground" title="Cancel">
                        <X className="h-4 w-4" />
                      </button>
                    </form>
                  ) : (
                    <button
                      onClick={() => startRename(c)}
                      className="group/name flex items-center gap-1.5 min-w-0 text-left"
                      title="Rename"
                    >
                      <h3 className="text-sm font-black uppercase tracking-wide truncate">{c.name}</h3>
                      <Pencil className="h-3 w-3 text-zinc-400 opacity-0 group-hover/name:opacity-100 transition-opacity shrink-0" />
                    </button>
                  )}
                  <span
                    className={cn(
                      "text-[8px] px-1.5 py-0.5 border font-black uppercase tracking-widest shrink-0",
                      c.isPublic
                        ? "border-green-600 text-green-700 dark:text-green-400"
                        : "border-zinc-400 text-zinc-500",
                    )}
                  >
                    {c.isPublic ? "Public" : "Draft"}
                  </span>
                </div>

                <div className="flex items-center gap-3 mt-2 text-[10px] text-zinc-500">
                  <span className="flex items-center gap-1">
                    <Heart className="h-3 w-3" /> {c.likesCount}
                  </span>
                  <span className="flex items-center gap-1">
                    <Download className="h-3 w-3" /> {c.downloadCount}
                  </span>
                </div>

                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                  <button
                    onClick={() => togglePublish(c)}
                    disabled={busyId === c._id}
                    className="flex-1 flex items-center justify-center gap-1.5 text-[9px] px-2 py-2 border font-black uppercase tracking-wider border-zinc-950 dark:border-zinc-700 hover:bg-zinc-950 hover:text-white dark:hover:bg-white dark:hover:text-black transition-colors disabled:opacity-50"
                  >
                    {c.isPublic ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                    {c.isPublic ? "Unpublish" : "Publish"}
                  </button>
                  <Link
                    href={`/collections/${c._id}`}
                    className="flex items-center justify-center px-2 py-2 border border-zinc-950 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                    title="View"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                  <button
                    onClick={() => handleDelete(c)}
                    disabled={busyId === c._id}
                    className="flex items-center justify-center px-2 py-2 border border-red-600/60 text-red-600 hover:bg-red-600 hover:text-white transition-colors disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Publish dialog — a pack must be named before it can go public. */}
      {publishingId && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center p-6"
          onClick={() => busyId !== publishingId && setPublishingId(null)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              confirmPublish();
            }}
            className="bg-background border-2 border-zinc-950 dark:border-zinc-700 w-full max-w-sm p-5"
          >
            <div className="flex items-center gap-2 mb-1">
              <Globe className="h-4 w-4" />
              <h3 className="text-sm font-black uppercase tracking-wide">Name your collection</h3>
            </div>
            <p className="text-xs text-zinc-500 mb-4">
              Give this pack a name before publishing it to the community.
            </p>
            <input
              autoFocus
              value={publishName}
              onChange={(e) => setPublishName(e.target.value)}
              placeholder="e.g. Retro RPG Assets"
              className="w-full border-2 border-zinc-950 dark:border-zinc-700 bg-background outline-none px-4 py-2.5 text-sm focus:border-zinc-950 dark:focus:border-white"
            />
            <div className="flex items-center gap-2 mt-4">
              <button
                type="submit"
                disabled={publishName.trim().length < 2 || busyId === publishingId}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-zinc-950 text-white dark:bg-white dark:text-black border-2 border-zinc-950 dark:border-white font-black uppercase text-xs tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busyId === publishingId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
                Publish
              </button>
              <button
                type="button"
                onClick={() => setPublishingId(null)}
                className="px-4 py-2.5 border-2 border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:text-foreground font-black uppercase text-xs tracking-wider"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
