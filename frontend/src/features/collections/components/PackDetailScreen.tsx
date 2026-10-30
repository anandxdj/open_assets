"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Download, FolderPlus, Heart, Link2, LoaderCircle, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Crumbs, PageBody, Topbar, useActiveNav } from "@/components/layout/AppShell";
import { Avatar } from "@/components/layout/UserMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Loading, Notice } from "@/components/ui/feedback";
import { useAuth } from "@/features/auth/context/AuthContext";
import {
  collectionDownloadUrl,
  createFolder,
  deleteImage,
  downloadCollectionZip,
  downloadFolderZip,
  folderDownloadUrl,
  getCollection,
  likeCollection,
  type CollectionFolder,
  type CollectionImage,
  type CollectionTree,
} from "@/features/collections/api";
import { AssetPreviewDialog } from "@/features/collections/components/AssetPreviewDialog";
import { NameDialog } from "@/features/collections/components/CollectionDialogs";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { creatorName, creatorPicture } from "@/features/collections/format";
import { cn } from "@/lib/utils";

type LoadState =
  | { id: string; status: "ready"; collection: CollectionTree }
  | { id: string; status: "error"; message: string };

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] leading-4 text-ink-2">{label}</dt>
      <dd className="oa-section">{value.toLocaleString("en")}</dd>
    </div>
  );
}

/**
 * A folder's ZIP. Published packs use a plain link (it works signed out); private
 * and team collections fetch it with the access token, which a link cannot send.
 */
function FolderZip({ packId, folder, isPublic }: { packId: string; folder: CollectionFolder; isPublic: boolean }) {
  const [busy, setBusy] = useState(false);

  if (isPublic) {
    return (
      <Button asChild variant="ghost" size="sm">
        <a href={folderDownloadUrl(packId, folder._id)}>
          <Download aria-hidden />
          ZIP
          <span className="sr-only"> of {folder.name}</span>
        </a>
      </Button>
    );
  }

  async function handleDownload() {
    if (busy) return;
    setBusy(true);
    try {
      await downloadFolderZip(packId, folder._id, folder.name);
    } catch (err) {
      toast.error("Could not download the folder", { description: err instanceof Error ? err.message : "Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleDownload} aria-busy={busy || undefined}>
      {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : <Download aria-hidden />}
      ZIP
      <span className="sr-only"> of {folder.name}</span>
    </Button>
  );
}

function FolderSection({
  packId,
  folder,
  isPublic,
  canEdit,
  open,
  onToggle,
  previewId,
  onPreview,
  onDeleteImage,
}: {
  packId: string;
  folder: CollectionFolder;
  isPublic: boolean;
  canEdit: boolean;
  open: boolean;
  onToggle: () => void;
  previewId: string | null;
  onPreview: (image: CollectionImage) => void;
  onDeleteImage: (folder: CollectionFolder, image: CollectionImage) => void;
}) {
  const panelId = `folder-${folder._id}`;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={onToggle}
            className="flex min-w-0 items-center gap-2 text-left hover:text-brand-text"
          >
            <ChevronDown
              aria-hidden
              className={cn("size-4 flex-none text-ink-2 transition-transform", !open && "-rotate-90")}
            />
            <span className="oa-section truncate">{folder.name}</span>
            <span className="oa-count">
              {folder.images.length}
              <span className="sr-only"> {folder.images.length === 1 ? "asset" : "assets"}</span>
            </span>
          </button>
        </h2>
        <span className="flex-1" />
        <FolderZip packId={packId} folder={folder} isPublic={isPublic} />
      </div>
      <div id={panelId} hidden={!open}>
        {folder.images.length === 0 ? (
          <p className="text-xs leading-[18px] text-ink-2">This folder is empty.</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
            {folder.images.map((img) => (
              <li key={img._id} className="flex min-w-0 flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => onPreview(img)}
                  data-selected={previewId === img._id || undefined}
                  className="oa-tile oa-checker w-full cursor-zoom-in p-0 hover:border-line-strong"
                  aria-label={`Preview ${img.name}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.cloudinaryUrl} alt="" loading="lazy" className="h-[70%] w-[70%] object-contain" />
                </button>
                <span className="flex items-center gap-1">
                  <span className="oa-value min-w-0 flex-1 truncate text-[11.5px]" title={img.name}>
                    {img.name}
                  </span>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon
                      aria-label={`Delete ${img.name}`}
                      className="-mr-1.5 flex-none"
                      onClick={() => onDeleteImage(folder, img)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function PackDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const userId = user?._id;
  const [state, setState] = useState<LoadState | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set()); // every folder starts open
  const [likes, setLikes] = useState<number | null>(null);
  const [liked, setLiked] = useState(false);
  const [liking, setLiking] = useState(false);
  const [preview, setPreview] = useState<CollectionImage | null>(null);
  const [zipping, setZipping] = useState(false);
  const [newFolder, setNewFolder] = useState(false);
  const [deleting, setDeleting] = useState<{ folder: CollectionFolder; image: CollectionImage } | null>(null);

  useEffect(() => {
    // A private or team collection needs the access token, which a hard load only
    // has once the session is restored: asking earlier would be a 403.
    if (authLoading) return;
    let alive = true;
    getCollection(id)
      .then((res) => {
        if (alive) setState({ id, status: "ready", collection: res.data });
      })
      .catch((err: unknown) => {
        if (alive) {
          setState({ id, status: "error", message: err instanceof Error ? err.message : "Failed to load collection" });
        }
      });
    return () => {
      alive = false;
    };
  }, [id, authLoading, userId]);

  const current = state?.id === id ? state : null;
  const collection = current?.status === "ready" ? current.collection : null;

  /** Applies a change to the loaded tree without refetching it. */
  function updateTree(update: (tree: CollectionTree) => CollectionTree) {
    setState((s) => (s && s.id === id && s.status === "ready" ? { ...s, collection: update(s.collection) } : s));
  }

  async function handleCreateFolder(name: string) {
    try {
      const res = await createFolder(id, { name });
      updateTree((t) => ({ ...t, folders: [...t.folders, { ...res.data, images: [] }] }));
      toast.success("Folder created", { description: name });
      return true;
    } catch (err) {
      toast.error("Could not create the folder", { description: err instanceof Error ? err.message : "Try again." });
      return false;
    }
  }

  async function handleDeleteImage() {
    if (!deleting) return true;
    const { folder, image } = deleting;
    try {
      await deleteImage(id, folder._id, image._id);
      updateTree((t) => ({
        ...t,
        folders: t.folders.map((f) => (f._id === folder._id ? { ...f, images: f.images.filter((i) => i._id !== image._id) } : f)),
      }));
      toast.success("Image deleted", { description: image.name });
      return true;
    } catch (err) {
      toast.error("Could not delete the image", { description: err instanceof Error ? err.message : "Try again." });
      return false;
    }
  }

  async function handleDownloadPack(name: string) {
    if (zipping) return;
    setZipping(true);
    try {
      await downloadCollectionZip(id, name);
    } catch (err) {
      toast.error("Could not download the collection", { description: err instanceof Error ? err.message : "Try again." });
    } finally {
      setZipping(false);
    }
  }

  function toggleFolder(folderId: string) {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  async function handleLike() {
    if (liking) return;
    if (!user) {
      toast.error("Sign in to like collections", {
        action: { label: "Sign in", onClick: () => router.push(`/login?next=${encodeURIComponent(`/collections/${id}`)}`) },
      });
      return;
    }
    if (liked) {
      toast.info("You already like this collection");
      return;
    }
    setLiking(true);
    try {
      const res = await likeCollection(id);
      setLikes(res.data.likesCount);
      setLiked(true);
      toast.success("Added to your likes");
    } catch (err) {
      toast.error("Could not like this collection", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setLiking(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link", { description: window.location.href });
    }
  }

  // The owner and their team reach a pack through My collections; everyone else through the community.
  const own = collection !== null && collection.access.via !== "public";
  useActiveNav(own ? "/dashboard/collections" : null);
  const crumbs = [
    own ? { label: "My collections", href: "/dashboard/collections" } : { label: "Community", href: "/collections" },
    { label: collection?.name ?? "Collection" },
  ];

  let body: React.ReactNode;
  if (!current) {
    body = (
<Loading label="Loading collection" className="justify-center py-16" />
    );
  } else if (current.status === "error") {
    body = (
      <EmptyState
        tone="danger"
        headingLevel={1}
        title="Could not open this collection"
        description={current.message}
        actions={
          <Button asChild>
            <Link href="/collections">Back to community</Link>
          </Button>
        }
      />
    );
  } else {
    const c = current.collection;
    const author = creatorName(c);
    const totalAssets = c.folders.reduce((n, f) => n + f.images.length, 0);
    const canEdit = c.access.canEdit;
    body = (
      <div className="grid items-start gap-10 lg:grid-cols-[300px_minmax(0,1fr)]">
        <section aria-label="Collection details" className="flex flex-col gap-[18px] lg:sticky lg:top-0">
          <div className="flex flex-col gap-2">
            <h1 className="oa-h3 break-words">{c.name}</h1>
            <span className="flex items-center gap-2 text-xs leading-[18px] text-ink-2">
              <Avatar name={author} picture={creatorPicture(c)} className="size-5 text-[10px]" />
              by {author}
            </span>
            {c.team && (
              <span>
                <Badge>
                  <Users aria-hidden />
                  Shared with {c.team.name}
                </Badge>
              </span>
            )}
          </div>
          {c.access.teamReadOnly && (
            <Notice tone="warning" role="status">
              This team is read-only because the owner&apos;s plan no longer includes team sharing. You can view and
              download this collection, not edit it.
            </Notice>
          )}
          {c.description && <p className="text-xs leading-[18px] text-ink-2">{c.description}</p>}
          {c.tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
              {c.tags.map((t) => (
                <li key={t}>
                  <Badge>{t}</Badge>
                </li>
              ))}
            </ul>
          )}
          <dl className="grid grid-cols-3 gap-2 border-y-[1.5px] border-line py-3.5">
            <Stat label="Assets" value={totalAssets} />
            <Stat label="Likes" value={likes ?? c.likesCount} />
            <Stat label="Downloads" value={c.downloadCount} />
          </dl>
          <div className="flex gap-2">
            {c.isPublic ? (
              <Button asChild variant="primary" className="flex-1">
                <a href={collectionDownloadUrl(id)}>
                  <Download aria-hidden />
                  Download collection
                </a>
              </Button>
            ) : (
              <Button
                variant="primary"
                className="flex-1"
                aria-busy={zipping || undefined}
                onClick={() => handleDownloadPack(c.name)}
              >
                {zipping ? <LoaderCircle aria-hidden className="animate-spin" /> : <Download aria-hidden />}
                Download collection
              </Button>
            )}
            <Button
              icon
              aria-label="Like this collection"
              aria-pressed={liked}
              aria-busy={liking || undefined}
              onClick={handleLike}
              className={cn(liked && "bg-inverse text-inverse-fg")}
            >
              {liking ? (
                <LoaderCircle aria-hidden className="animate-spin" />
              ) : (
                <Heart aria-hidden className={cn(liked && "fill-current")} />
              )}
            </Button>
          </div>
        </section>

        <div className="flex min-w-0 flex-col gap-7">
          {canEdit && (
            <div className="flex">
              <Button size="sm" onClick={() => setNewFolder(true)}>
                <FolderPlus aria-hidden />
                New folder
              </Button>
            </div>
          )}
          {c.folders.length === 0 ? (
            <EmptyState
              title="No assets yet"
              description={canEdit ? "Add a folder, then save assets into it from any export." : "This collection has no folders to show."}
            />
          ) : (
            c.folders.map((folder) => (
              <FolderSection
                key={folder._id}
                packId={id}
                folder={folder}
                isPublic={c.isPublic}
                canEdit={canEdit}
                open={!closed.has(folder._id)}
                onToggle={() => toggleFolder(folder._id)}
                previewId={preview?._id ?? null}
                onPreview={setPreview}
                onDeleteImage={(f, image) => setDeleting({ folder: f, image })}
              />
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <Topbar>
        <Crumbs items={crumbs} />
        <span className="flex-1" />
        {collection && (
          <Button variant="ghost" size="sm" onClick={copyLink}>
            <Link2 aria-hidden />
            Copy link
          </Button>
        )}
      </Topbar>
      <PageBody>{body}</PageBody>
      <AssetPreviewDialog image={preview} onOpenChange={(open) => !open && setPreview(null)} />
      <NameDialog
        open={newFolder}
        onOpenChange={setNewFolder}
        title="New folder"
        description="Folders keep a collection's assets together. Everyone who can edit this collection sees it."
        submitLabel="Create folder"
        placeholder="e.g. Weapons"
        onSubmit={handleCreateFolder}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this image?"
        description={
          <>
            <span className="font-bold text-ink">{deleting?.image.name}</span> is removed from the collection and from
            storage. This cannot be undone.
          </>
        }
        confirmLabel="Delete image"
        onConfirm={handleDeleteImage}
      />
    </>
  );
}
