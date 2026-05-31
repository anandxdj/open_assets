"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTheme } from "next-themes";
import {
  ArrowLeft,
  Heart,
  Download,
  Loader2,
  ChevronDown,
  X,
  Boxes,
} from "lucide-react";
import {
  getCollection,
  likeCollection,
  collectionDownloadUrl,
  folderDownloadUrl,
  type CollectionTree,
  type CollectionImage,
} from "@/features/collections/api";
import { cn } from "@/lib/utils";
import { Navbar } from "@/components/layout/Navbar";

function creatorName(c: CollectionTree): string {
  return typeof c.creator === "string" ? "Unknown" : c.creator?.name ?? "Unknown";
}

function fmtBytes(bytes?: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [collection, setCollection] = useState<CollectionTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [likes, setLikes] = useState(0);
  const [liking, setLiking] = useState(false);
  const [preview, setPreview] = useState<CollectionImage | null>(null);
  const [downloading, setDownloading] = useState(false);
  const { resolvedTheme } = useTheme();

  const handleDownloadImage = async (url: string, name: string) => {
    if (downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch image");
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${name}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Failed to download image directly:", error);
      // Fallback: Open in new tab
      window.open(url, "_blank");
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await getCollection(id);
        setCollection(res.data);
        setLikes(res.data.likesCount);
        setOpen(new Set(res.data.folders.map((f) => f._id))); // expand all initially
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load collection");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const toggleFolder = useCallback((fid: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(fid)) next.delete(fid);
      else next.add(fid);
      return next;
    });
  }, []);

  const handleLike = async () => {
    if (liking) return;
    setLiking(true);
    try {
      const res = await likeCollection(id);
      setLikes(res.data.likesCount);
    } catch {
      // most likely not authenticated — surface lightly
      setError("Sign in to like collections.");
    } finally {
      setLiking(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <Loader2 className="h-7 w-7 text-[#00ff66] animate-spin" />
      </div>
    );
  }

  if (error && !collection) {
    return (
      <div className="min-h-screen bg-background grid place-items-center font-mono text-center gap-4 px-6">
        <Boxes className="h-10 w-10 text-zinc-400 dark:text-zinc-700" />
        <p className="text-sm text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{error}</p>
        <Link href="/collections" className="text-[10px] text-[#00ff66] uppercase font-black tracking-widest">
          ← Back to gallery
        </Link>
      </div>
    );
  }

  if (!collection) return null;
  const totalAssets = collection.folders.reduce((n, f) => n + f.images.length, 0);

  return (
    <div className="min-h-screen bg-background text-foreground font-mono transition-colors duration-200">
      <Navbar />

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Back Link Breadcrumb */}
        <div className="mb-6">
          <Link
            href="/collections"
            className="inline-flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-foreground uppercase font-black tracking-widest transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Gallery
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-8">
        {/* Sidebar */}
        <aside className="lg:sticky lg:top-20 self-start border border-zinc-200 dark:border-zinc-800 bg-card rounded-md p-5 h-fit">
          <h1 className="text-xl font-black uppercase tracking-tight text-foreground">{collection.name}</h1>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 uppercase tracking-wider">by {creatorName(collection)}</p>
          {collection.description && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-3 leading-relaxed">{collection.description}</p>
          )}

          {collection.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-4">
              {collection.tags.map((t) => (
                <span key={t} className="text-[9px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 rounded uppercase tracking-wider">
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 mt-5 text-center">
            <Stat label="Assets" value={totalAssets} />
            <Stat label="Likes" value={likes} />
            <Stat label="Downloads" value={collection.downloadCount} />
          </div>

          <div className="flex flex-col gap-2 mt-5">
            <a
              href={collectionDownloadUrl(id)}
              className="py-3 px-4 bg-[#00ff66] text-black font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-1.5 hover:bg-[#00e55b] hover:shadow-[0_0_20px_rgba(0,255,102,0.35)] border border-[#00ff66] transition-all rounded"
            >
              <Download className="h-3.5 w-3.5" /> Download whole pack
            </a>
            <button
              onClick={handleLike}
              disabled={liking}
              className="py-2.5 px-4 bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-foreground border border-zinc-200 dark:border-zinc-700 transition-all rounded disabled:opacity-50 cursor-pointer"
            >
              <Heart className="h-3.5 w-3.5" /> Like
            </button>
            {error && <p className="text-[9px] text-[#ff7c00] uppercase tracking-wider mt-1">{error}</p>}
          </div>
        </aside>

        {/* Folders */}
        <section className="flex flex-col gap-4">
          {collection.folders.map((folder) => {
            const isOpen = open.has(folder._id);
            const checkerBg = resolvedTheme === "light"
              ? "linear-gradient(45deg,#f4f4f5 25%,transparent 25%),linear-gradient(-45deg,#f4f4f5 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#f4f4f5 75%),linear-gradient(-45deg,transparent 75%,#f4f4f5 75%)"
              : "linear-gradient(45deg,#1a1a1a 25%,transparent 25%),linear-gradient(-45deg,#1a1a1a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1a1a1a 75%),linear-gradient(-45deg,transparent 75%,#1a1a1a 75%)";

            return (
              <div key={folder._id} className="border border-zinc-200 dark:border-zinc-800 bg-card rounded-md overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-900">
                  <button
                    onClick={() => toggleFolder(folder._id)}
                    className="flex items-center gap-2 text-sm font-black uppercase tracking-wide hover:text-[#00ff66] transition-colors text-foreground cursor-pointer"
                  >
                    <ChevronDown className={cn("h-4 w-4 transition-transform", !isOpen && "-rotate-90")} />
                    {folder.name}
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-600">({folder.images.length})</span>
                  </button>
                  <a
                    href={folderDownloadUrl(id, folder._id)}
                    className="text-[9px] text-zinc-500 dark:text-zinc-400 hover:text-[#00ff66] uppercase font-bold tracking-wider flex items-center gap-1 transition-colors"
                  >
                    <Download className="h-3 w-3" /> Zip
                  </a>
                </div>
                {isOpen && (
                  <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {folder.images.map((img) => (
                      <button
                        key={img._id}
                        onClick={() => setPreview(img)}
                        className="group aspect-square border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 rounded overflow-hidden hover:border-[#00ff66]/60 transition-colors relative cursor-pointer"
                        style={{
                          backgroundImage: checkerBg,
                          backgroundSize: "16px 16px",
                          backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.cloudinaryUrl} alt={img.name} loading="lazy" className="h-full w-full object-contain p-2" />
                        <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[8px] text-zinc-300 px-1.5 py-1 truncate uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
                          {img.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
        </div>
      </main>

      {/* Light-box modal */}
      {preview && (() => {
        const previewCheckerBg = resolvedTheme === "light"
          ? "linear-gradient(45deg,#f4f4f5 25%,transparent 25%),linear-gradient(-45deg,#f4f4f5 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#f4f4f5 75%),linear-gradient(-45deg,transparent 75%,#f4f4f5 75%)"
          : "linear-gradient(45deg,#16161a 25%,transparent 25%),linear-gradient(-45deg,#16161a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#16161a 75%),linear-gradient(-45deg,transparent 75%,#16161a 75%)";

        return (
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md grid place-items-center p-6"
            onClick={() => setPreview(null)}
          >
            <div
              className="bg-background border border-zinc-200 dark:border-zinc-800 rounded-lg max-w-3xl w-full max-h-[88vh] overflow-auto text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-900">
                <h3 className="text-sm font-black uppercase tracking-wide truncate text-foreground">{preview.name}</h3>
                <button onClick={() => setPreview(null)} className="text-zinc-500 hover:text-foreground transition-colors cursor-pointer">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid md:grid-cols-[1fr_240px] gap-0">
                <div
                  className="grid place-items-center p-6 min-h-[280px]"
                  style={{
                    backgroundImage: previewCheckerBg,
                    backgroundSize: "20px 20px",
                    backgroundPosition: "0 0,0 10px,10px -10px,-10px 0",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview.cloudinaryUrl} alt={preview.name} className="max-h-[60vh] max-w-full object-contain" />
                </div>
                <div className="p-5 border-t md:border-t-0 md:border-l border-zinc-200 dark:border-zinc-900 flex flex-col gap-3">
                  <Meta label="Resolution" value={preview.width && preview.height ? `${preview.width}×${preview.height}` : "—"} />
                  <Meta label="Size" value={fmtBytes(preview.sizeBytes)} />
                  <Meta label="Upscaled" value={preview.upscaled ? "Yes" : "No"} />
                  {preview.geminiMetadata?.description && (
                    <div>
                      <p className="text-[9px] text-zinc-500 dark:text-zinc-600 uppercase tracking-widest">AI description</p>
                      <p className="text-xs text-zinc-700 dark:text-zinc-300 mt-1 leading-relaxed">{preview.geminiMetadata.description}</p>
                    </div>
                  )}
                  {preview.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {preview.tags.map((t) => (
                        <span key={t} className="text-[9px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 rounded uppercase tracking-wider">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => handleDownloadImage(preview.cloudinaryUrl, preview.name)}
                    disabled={downloading}
                    className={cn(
                      "mt-auto py-2.5 px-4 font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-1.5 border transition-all rounded cursor-pointer",
                      downloading
                        ? "bg-zinc-800 text-zinc-400 border-zinc-700 cursor-not-allowed"
                        : "bg-[#00ff66] text-black border-[#00ff66] hover:bg-[#00e55b] hover:shadow-[0_0_20px_rgba(0,255,102,0.35)]"
                    )}
                  >
                    {downloading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Downloading...
                      </>
                    ) : (
                      <>
                        <Download className="h-3.5 w-3.5" /> Download file
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 rounded py-2">
      <p className="text-sm font-black text-[#00ff66]">{value}</p>
      <p className="text-[8px] text-zinc-500 dark:text-zinc-500 uppercase tracking-widest mt-0.5">{label}</p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[9px] text-zinc-500 dark:text-zinc-600 uppercase tracking-widest">{label}</span>
      <span className="text-xs text-zinc-800 dark:text-zinc-300 font-bold">{value}</span>
    </div>
  );
}
