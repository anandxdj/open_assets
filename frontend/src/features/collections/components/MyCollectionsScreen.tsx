"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Ellipsis, Eye, Folder, Globe, LayoutGrid, List, LoaderCircle, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Crumbs, PageBody, PageTitle, Topbar } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/feedback";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { TabButton } from "@/components/ui/tabs";
import {
  createCollection,
  deleteCollection,
  listMyCollections,
  updateCollection,
  type CollectionSummary,
} from "@/features/collections/api";
import { ConfirmDeleteDialog, NameDialog } from "@/features/collections/components/CollectionDialogs";
import { CoverGrid } from "@/features/collections/components/CoverGrid";
import { formatCount, isUntitled, plural } from "@/features/collections/format";
import { formatFullDate, formatRelativeTime, useNow } from "@/features/jobs/time";

type Filter = "all" | "drafts" | "public";
type View = "grid" | "list";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "drafts", label: "Drafts" },
  { value: "public", label: "Public" },
];

type DialogState =
  | { kind: "create" }
  | { kind: "rename"; collection: CollectionSummary }
  | { kind: "publish"; collection: CollectionSummary }
  | { kind: "delete"; collection: CollectionSummary }
  | null;

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function editedLabel(updatedAt: string, now: number) {
  const rel = formatRelativeTime(Date.parse(updatedAt), now);
  return `Edited ${rel === "Just now" || rel === "Yesterday" ? rel.toLowerCase() : rel}`;
}

function VisibilityBadge({ isPublic }: { isPublic: boolean }) {
  return isPublic ? (
    <Badge tone="success">
      <Globe aria-hidden />
      Public
    </Badge>
  ) : (
    <Badge>
      <Lock aria-hidden />
      Draft
    </Badge>
  );
}

function menuTriggerId(c: CollectionSummary) {
  return `collection-actions-${c._id}`;
}

type CardActions = {
  onRename: (c: CollectionSummary) => void;
  onTogglePublish: (c: CollectionSummary) => void;
  onDelete: (c: CollectionSummary) => void;
};

function CollectionMenu({ collection: c, busy, actions }: { collection: CollectionSummary; busy: boolean; actions: CardActions }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          id={menuTriggerId(c)}
          variant="ghost"
          size="sm"
          icon
          aria-label={`Actions for ${c.name}`}
          className="relative z-10 -mr-1.5 -mt-1 flex-none"
        >
          {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : <Ellipsis aria-hidden />}
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => actions.onRename(c)}>
          <Pencil aria-hidden />
          Rename
        </MenuItem>
        <MenuItem onSelect={() => actions.onTogglePublish(c)}>
          {c.isPublic ? <Lock aria-hidden /> : <Globe aria-hidden />}
          {c.isPublic ? "Unpublish" : "Publish"}
        </MenuItem>
        <MenuItem asChild>
          <Link href={`/collections/${c._id}`}>
            <Eye aria-hidden />
            View
          </Link>
        </MenuItem>
        <MenuSeparator />
        <MenuItem danger onSelect={() => actions.onDelete(c)}>
          <Trash2 aria-hidden />
          Delete
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function metaLine(c: CollectionSummary, now: number) {
  return c.isPublic
    ? `${plural(c.likesCount, "like")} · ${plural(c.downloadCount, "download")}`
    : editedLabel(c.updatedAt, now);
}

function CollectionGrid({
  items,
  busyId,
  actions,
  now,
}: {
  items: CollectionSummary[];
  busyId: string | null;
  actions: CardActions;
  now: number;
}) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(232px,100%),1fr))] gap-x-5 gap-y-7">
      {items.map((c) => (
        <li key={c._id} className="relative flex flex-col gap-2.5" aria-busy={busyId === c._id || undefined}>
          <CoverGrid urls={c.coverImageUrls} />
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Link
                href={`/collections/${c._id}`}
                className="truncate text-xs font-medium leading-[18px] text-ink after:absolute after:inset-0 hover:underline hover:decoration-[1.5px] hover:underline-offset-[3px]"
              >
                {c.name}
              </Link>
              <span className="text-[11px] leading-4 text-ink-2">{metaLine(c, now)}</span>
            </div>
            <VisibilityBadge isPublic={c.isPublic} />
            <CollectionMenu collection={c} busy={busyId === c._id} actions={actions} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function CollectionTable({
  items,
  busyId,
  actions,
  now,
}: {
  items: CollectionSummary[];
  busyId: string | null;
  actions: CardActions;
  now: number;
}) {
  return (
    <div className="oa-table-box">
      <table className="oa-table">
        <caption className="sr-only">Your collections</caption>
        <thead>
          <tr>
            <th scope="col">Collection</th>
            <th scope="col">Visibility</th>
            <th scope="col">Likes</th>
            <th scope="col">Downloads</th>
            <th scope="col" className="hidden sm:table-cell">
              Edited
            </th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c._id} aria-busy={busyId === c._id || undefined}>
              <td>
                <span className="flex items-center gap-3">
                  <CoverGrid urls={c.coverImageUrls} className="w-12 flex-none border" />
                  <Link href={`/collections/${c._id}`} className="max-w-[260px] truncate text-[13px] font-medium hover:underline">
                    {c.name}
                  </Link>
                </span>
              </td>
              <td>
                <VisibilityBadge isPublic={c.isPublic} />
              </td>
              <td className="text-ink-2">{formatCount(c.likesCount)}</td>
              <td className="text-ink-2">{formatCount(c.downloadCount)}</td>
              <td className="hidden text-ink-2 sm:table-cell">
                <time dateTime={c.updatedAt} title={formatFullDate(Date.parse(c.updatedAt))}>
                  {formatRelativeTime(Date.parse(c.updatedAt), now)}
                </time>
              </td>
              <td className="text-right">
                <CollectionMenu collection={c} busy={busyId === c._id} actions={actions} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilterTabs({
  value,
  onChange,
  counts,
}: {
  value: Filter;
  onChange: (next: Filter) => void;
  counts: Record<Filter, number>;
}) {
  function handleKeyDown(event: React.KeyboardEvent) {
    const index = FILTERS.findIndex((f) => f.value === value);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % FILTERS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + FILTERS.length) % FILTERS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = FILTERS.length - 1;
    else return;
    event.preventDefault();
    onChange(FILTERS[next].value);
    document.getElementById(`collections-tab-${FILTERS[next].value}`)?.focus();
  }

  return (
    <div role="tablist" aria-label="Filter collections" className="oa-tabs flex-1 border-b-0" onKeyDown={handleKeyDown}>
      {FILTERS.map((f) => (
        <TabButton
          key={f.value}
          id={`collections-tab-${f.value}`}
          aria-controls="collections-panel"
          tabIndex={value === f.value ? 0 : -1}
          active={value === f.value}
          count={counts[f.value]}
          onClick={() => onChange(f.value)}
        >
          {f.label}
        </TabButton>
      ))}
    </div>
  );
}

export function MyCollectionsScreen() {
  const [items, setItems] = useState<CollectionSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<View>("grid");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  // Dialogs opened from a card menu send focus back to that menu's button (or
  // to the current tab when the card is gone) instead of dropping it on <body>.
  const returnFocusTo = useRef<string | null>(null);
  const now = useNow();

  useEffect(() => {
    let alive = true;
    listMyCollections()
      .then((res) => {
        if (!alive) return;
        setItems(res.data);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoadError(errorMessage(err, "The server did not answer."));
        setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  function retryLoad() {
    setStatus("loading");
    setAttempt((n) => n + 1);
  }

  function replace(next: CollectionSummary) {
    setItems((prev) => prev.map((x) => (x._id === next._id ? next : x)));
  }

  async function setVisibility(c: CollectionSummary, isPublic: boolean, name?: string): Promise<boolean> {
    setBusyId(c._id);
    try {
      const res = await updateCollection(c._id, name ? { name, isPublic } : { isPublic });
      replace(res.data);
      toast.success(isPublic ? "Published to the community" : "Moved back to drafts", { description: res.data.name });
      return true;
    } catch (err) {
      toast.error(isPublic ? "Could not publish" : "Could not unpublish", { description: errorMessage(err, "Try again.") });
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function openFromMenu(next: Exclude<DialogState, null | { kind: "create" }>) {
    returnFocusTo.current = menuTriggerId(next.collection);
    setDialog(next);
  }

  function restoreFocus(event: Event) {
    const target =
      (returnFocusTo.current && document.getElementById(returnFocusTo.current)) ||
      document.getElementById(`collections-tab-${filter}`);
    returnFocusTo.current = null;
    if (target) {
      event.preventDefault();
      target.focus();
    }
  }

  const actions: CardActions = {
    onRename: (c) => openFromMenu({ kind: "rename", collection: c }),
    onDelete: (c) => openFromMenu({ kind: "delete", collection: c }),
    onTogglePublish: (c) => {
      if (busyId === c._id) return;
      // Unpublishing is always allowed; an unnamed pack must be named before it goes public.
      if (c.isPublic) void setVisibility(c, false);
      else if (isUntitled(c.name)) openFromMenu({ kind: "publish", collection: c });
      else void setVisibility(c, true);
    },
  };

  async function handleCreate(name: string) {
    try {
      const res = await createCollection({ name });
      setItems((prev) => [res.data, ...prev]);
      toast.success("Collection created", { description: res.data.name });
      return true;
    } catch (err) {
      toast.error("Could not create the collection", { description: errorMessage(err, "Try again.") });
      return false;
    }
  }

  async function handleRename(c: CollectionSummary, name: string) {
    if (name === c.name) return true;
    setBusyId(c._id);
    try {
      const res = await updateCollection(c._id, { name });
      replace(res.data);
      toast.success("Collection renamed", { description: res.data.name });
      return true;
    } catch (err) {
      toast.error("Could not rename", { description: errorMessage(err, "Try again.") });
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(c: CollectionSummary) {
    setBusyId(c._id);
    try {
      await deleteCollection(c._id);
      setItems((prev) => prev.filter((x) => x._id !== c._id));
      toast.success("Collection deleted", { description: c.name });
      return true;
    } catch (err) {
      toast.error("Could not delete", { description: errorMessage(err, "Try again.") });
      return false;
    } finally {
      setBusyId(null);
    }
  }

  const counts: Record<Filter, number> = {
    all: items.length,
    drafts: items.filter((c) => !c.isPublic).length,
    public: items.filter((c) => c.isPublic).length,
  };
  const visible = items.filter((c) => (filter === "all" ? true : filter === "public" ? c.isPublic : !c.isPublic));
  const closeDialog = (open: boolean) => !open && setDialog(null);

  let body: React.ReactNode;
  if (status === "loading") {
    body = (
      <div role="status" className="oa-label flex items-center justify-center gap-2.5 py-16">
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
        Loading collections
      </div>
    );
  } else if (status === "error") {
    body = (
      <EmptyState
        tone="danger"
        title="Could not load your collections"
        description={loadError}
        actions={<Button onClick={retryLoad}>Try again</Button>}
      />
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        icon={<Folder aria-hidden className="size-5" />}
        title="No collections yet"
        description="Save assets from any export and we start a private draft pack for you."
        actions={
          <Button asChild>
            <Link href="/upload">Extract a sheet</Link>
          </Button>
        }
      />
    );
  } else {
    body = (
      <>
        <div className="flex flex-wrap items-center gap-3 border-b-[1.5px] border-line">
          <FilterTabs value={filter} onChange={setFilter} counts={counts} />
          <Segmented<View>
            ariaLabel="View"
            value={view}
            onChange={setView}
            className="mb-1.5"
            options={[
              { value: "grid", label: <LayoutGrid aria-hidden className="size-3.5" />, ariaLabel: "Grid view" },
              { value: "list", label: <List aria-hidden className="size-3.5" />, ariaLabel: "List view" },
            ]}
          />
        </div>
        <div role="tabpanel" id="collections-panel" aria-labelledby={`collections-tab-${filter}`}>
          {visible.length === 0 ? (
            filter === "drafts" ? (
              <EmptyState title="No drafts" description="Every collection you have is public." />
            ) : (
              <EmptyState
                title="Nothing published yet"
                description="Publish a draft from its menu to share it with the community."
              />
            )
          ) : view === "grid" ? (
            <CollectionGrid items={visible} busyId={busyId} actions={actions} now={now} />
          ) : (
            <CollectionTable items={visible} busyId={busyId} actions={actions} now={now} />
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar>
        <Crumbs items={[{ label: "My collections" }]} />
        <span className="flex-1" />
        <Button variant="primary" size="sm" onClick={() => setDialog({ kind: "create" })}>
          <Plus aria-hidden />
          New collection
        </Button>
      </Topbar>
      <PageBody className="flex flex-col gap-5">
        <PageTitle title="My collections" description="Drafts stay private until you publish them to the community." />
        {body}
      </PageBody>

      <NameDialog
        open={dialog?.kind === "create"}
        onOpenChange={closeDialog}
        title="New collection"
        description="Starts as a private draft. Add assets to it from any export."
        submitLabel="Create collection"
        placeholder="e.g. Retro RPG assets"
        onSubmit={handleCreate}
      />
      <NameDialog
        open={dialog?.kind === "rename"}
        onOpenChange={closeDialog}
        onCloseAutoFocus={restoreFocus}
        title="Rename collection"
        submitLabel="Save name"
        initialName={dialog?.kind === "rename" ? dialog.collection.name : ""}
        onSubmit={(name) => (dialog?.kind === "rename" ? handleRename(dialog.collection, name) : Promise.resolve(true))}
      />
      <NameDialog
        open={dialog?.kind === "publish"}
        onOpenChange={closeDialog}
        onCloseAutoFocus={restoreFocus}
        title="Name your collection"
        description="Give this pack a name before you publish it to the community."
        submitLabel="Publish"
        placeholder="e.g. Retro RPG assets"
        minLength={2}
        onSubmit={(name) =>
          dialog?.kind === "publish" ? setVisibility(dialog.collection, true, name) : Promise.resolve(true)
        }
      />
      <ConfirmDeleteDialog
        open={dialog?.kind === "delete"}
        onOpenChange={closeDialog}
        onCloseAutoFocus={restoreFocus}
        name={dialog?.kind === "delete" ? dialog.collection.name : ""}
        onConfirm={() => (dialog?.kind === "delete" ? handleDelete(dialog.collection) : Promise.resolve(true))}
      />
    </>
  );
}
