"use client";

import { useEffect, useState } from "react";
import { FolderPlus, Loader2, X, Check, Boxes } from "lucide-react";
import { toast } from "sonner";
import {
  listMyCollections,
  getCollection,
  createCollection,
  createFolder,
  exportJobToFolder,
  type CollectionSummary,
  type CollectionFolder,
} from "@/features/collections/api";

interface Props {
  jobId: string;
  selectedIds: string[];
  disabled?: boolean;
}

const NEW = "__new__";

export function ExportToCollectionButton({ jobId, selectedIds, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [collectionId, setCollectionId] = useState<string>(NEW);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [folders, setFolders] = useState<CollectionFolder[]>([]);
  const [folderId, setFolderId] = useState<string>(NEW);
  const [newFolderName, setNewFolderName] = useState("Assets");
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    listMyCollections()
      .then((res) => setCollections(res.data))
      .catch(() => setCollections([]));
  }, [open]);

  // When an existing collection is chosen, load its folders.
  useEffect(() => {
    if (!open || collectionId === NEW) {
      setFolders([]);
      setFolderId(NEW);
      return;
    }
    setLoadingFolders(true);
    getCollection(collectionId)
      .then((res) => {
        setFolders(res.data.folders);
        setFolderId(res.data.folders[0]?._id ?? NEW);
      })
      .catch(() => setFolders([]))
      .finally(() => setLoadingFolders(false));
  }, [collectionId, open]);

  async function handleSave() {
    if (selectedIds.length === 0) {
      toast.error("Select at least one asset first.");
      return;
    }
    setSaving(true);
    try {
      // 1. Ensure collection.
      let targetCollection = collectionId;
      if (collectionId === NEW) {
        if (!newCollectionName.trim()) {
          toast.error("Name your new collection.");
          setSaving(false);
          return;
        }
        targetCollection = (await createCollection({ name: newCollectionName.trim() })).data._id;
      }

      // 2. Ensure folder.
      let targetFolder = folderId;
      if (folderId === NEW || collectionId === NEW) {
        targetFolder = (await createFolder(targetCollection, { name: newFolderName.trim() || "Assets" })).data._id;
      }

      // 3. Push the selected crops.
      await exportJobToFolder(targetCollection, targetFolder, jobId, selectedIds);
      toast.success(`Exported ${selectedIds.length} asset${selectedIds.length !== 1 ? "s" : ""} to collection`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled || selectedIds.length === 0}
        className="py-3 px-5 bg-[#ff7c00] text-black font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-1.5 hover:bg-[#ff8f24] hover:shadow-[0_0_20px_rgba(255,124,0,0.35)] border border-[#ff7c00] transition-all duration-200 cursor-pointer rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Boxes className="h-3.5 w-3.5" />
        Export to Collection ({selectedIds.length})
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md grid place-items-center p-6 font-mono" onClick={() => !saving && setOpen(false)}>
          <div className="bg-[#0a0a0c] border border-zinc-800 rounded-lg w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-900">
              <h3 className="text-sm font-black uppercase tracking-wide text-zinc-100 flex items-center gap-2">
                <FolderPlus className="h-4 w-4 text-[#ff7c00]" /> Export to Collection
              </h3>
              <button onClick={() => !saving && setOpen(false)} className="text-zinc-500 hover:text-white transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-4">
              {/* Collection */}
              <div>
                <label className="text-[9px] text-zinc-500 uppercase tracking-widest">Collection</label>
                <select
                  value={collectionId}
                  onChange={(e) => setCollectionId(e.target.value)}
                  className="w-full mt-1 bg-zinc-950 border border-zinc-800 focus:border-[#ff7c00] outline-none rounded px-3 py-2 text-sm text-zinc-100"
                >
                  <option value={NEW}>+ New collection…</option>
                  {collections.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name} {c.isPublic ? "" : "(draft)"}
                    </option>
                  ))}
                </select>
                {collectionId === NEW && (
                  <input
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    placeholder="New collection name"
                    className="w-full mt-2 bg-zinc-950 border border-zinc-800 focus:border-[#ff7c00] outline-none rounded px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
                  />
                )}
              </div>

              {/* Folder */}
              <div>
                <label className="text-[9px] text-zinc-500 uppercase tracking-widest">Folder</label>
                {loadingFolders ? (
                  <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading folders…
                  </div>
                ) : (
                  <select
                    value={folderId}
                    onChange={(e) => setFolderId(e.target.value)}
                    disabled={collectionId === NEW}
                    className="w-full mt-1 bg-zinc-950 border border-zinc-800 focus:border-[#ff7c00] outline-none rounded px-3 py-2 text-sm text-zinc-100 disabled:opacity-50"
                  >
                    <option value={NEW}>+ New folder…</option>
                    {folders.map((f) => (
                      <option key={f._id} value={f._id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                )}
                {(folderId === NEW || collectionId === NEW) && (
                  <input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="New folder name"
                    className="w-full mt-2 bg-zinc-950 border border-zinc-800 focus:border-[#ff7c00] outline-none rounded px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
                  />
                )}
              </div>

              <button
                onClick={handleSave}
                disabled={saving}
                className="py-3 px-4 bg-[#ff7c00] text-black font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-1.5 hover:bg-[#ff8f24] border border-[#ff7c00] transition-colors rounded disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save {selectedIds.length} asset{selectedIds.length !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
