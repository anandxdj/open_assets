"use client";

import { useId, useRef, useState } from "react";
import { Folder, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
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
  /** Naming pattern for the saved names. Omit to keep the default names (the server decides). */
  namingPattern?: string;
}

const NEW = "__new__";

function assetsLabel(n: number) {
  return `${n} asset${n === 1 ? "" : "s"}`;
}

/** "Save to collection" button and dialog for the export screen. */
export function ExportToCollectionButton({ jobId, selectedIds, disabled, namingPattern }: Props) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [collectionId, setCollectionId] = useState<string>(NEW);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [folders, setFolders] = useState<CollectionFolder[]>([]);
  const [folderId, setFolderId] = useState<string>(NEW);
  const [newFolderName, setNewFolderName] = useState("Assets");
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const folderRequest = useRef(0);

  const count = selectedIds.length;

  function handleOpenChange(next: boolean) {
    if (saving) return;
    setOpen(next);
    if (!next) return;
    // Fresh form every time it opens.
    setCollectionId(NEW);
    setNewCollectionName("");
    setFolders([]);
    setFolderId(NEW);
    setNewFolderName("Assets");
    setNameError(null);
    setLoadingCollections(true);
    listMyCollections()
      // Own collections and the team's, minus any the caller may not edit (a read-only team).
      .then((res) => setCollections(res.data.filter((c) => c.access?.canEdit !== false)))
      .catch(() => setCollections([]))
      .finally(() => setLoadingCollections(false));
  }

  // When an existing collection is chosen, load its folders.
  function handleCollectionChange(next: string) {
    setCollectionId(next);
    setNameError(null);
    const request = ++folderRequest.current;
    if (next === NEW) {
      setFolders([]);
      setFolderId(NEW);
      setLoadingFolders(false);
      return;
    }
    setLoadingFolders(true);
    getCollection(next)
      .then((res) => {
        if (request !== folderRequest.current) return;
        setFolders(res.data.folders);
        setFolderId(res.data.folders[0]?._id ?? NEW);
      })
      .catch(() => {
        if (request === folderRequest.current) setFolders([]);
      })
      .finally(() => {
        if (request === folderRequest.current) setLoadingFolders(false);
      });
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (count === 0) {
      toast.error("Select at least one asset first.");
      return;
    }
    if (collectionId === NEW && !newCollectionName.trim()) {
      setNameError("Name your new collection.");
      return;
    }
    setSaving(true);
    try {
      // 1. Ensure collection.
      let targetCollection = collectionId;
      if (collectionId === NEW) {
        targetCollection = (await createCollection({ name: newCollectionName.trim() })).data._id;
      }

      // 2. Ensure folder.
      let targetFolder = folderId;
      if (folderId === NEW || collectionId === NEW) {
        targetFolder = (await createFolder(targetCollection, { name: newFolderName.trim() || "Assets" })).data._id;
      }

      // 3. Push the selected crops.
      await exportJobToFolder(targetCollection, targetFolder, jobId, selectedIds, namingPattern);
      toast.success(`Saved ${assetsLabel(count)} to the collection`);
      setOpen(false);
    } catch (err) {
      toast.error("Could not save to the collection", {
        description: err instanceof Error ? err.message : "Export failed",
      });
    } finally {
      setSaving(false);
    }
  }

  const collectionField = `${ids}-collection`;
  const nameField = `${ids}-name`;
  const folderField = `${ids}-folder`;
  const folderNameField = `${ids}-folder-name`;
  const creatingFolder = folderId === NEW || collectionId === NEW;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled || count === 0}>
          <Folder aria-hidden />
          Save {count} to collection
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Save ${assetsLabel(count)} to a collection`}
        description="Only you can see it until you publish. Team collections are visible to your team."
      >
        <form onSubmit={handleSave} noValidate className="contents">
          <DialogBody>
            <Field label="Collection" htmlFor={collectionField}>
              <Select
                id={collectionField}
                value={collectionId}
                onChange={(e) => handleCollectionChange(e.target.value)}
                disabled={saving}
                aria-busy={loadingCollections || undefined}
              >
                <option value={NEW}>New collection…</option>
                {collections.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                    {c.teamId ? " (team)" : c.isPublic ? "" : " (draft)"}
                  </option>
                ))}
              </Select>
            </Field>

            {collectionId === NEW && (
              <Field label="Name" htmlFor={nameField} error={nameError}>
                <Input
                  id={nameField}
                  value={newCollectionName}
                  placeholder="e.g. RPG assets v1"
                  invalid={Boolean(nameError)}
                  aria-describedby={nameError ? `${nameField}-note` : undefined}
                  disabled={saving}
                  onChange={(e) => {
                    setNewCollectionName(e.target.value);
                    if (nameError) setNameError(null);
                  }}
                />
              </Field>
            )}

            <Field
              label="Folder"
              htmlFor={folderField}
              help={loadingFolders ? "Loading folders…" : collectionId === NEW ? "A new collection starts with one folder." : undefined}
            >
              <Select
                id={folderField}
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                disabled={collectionId === NEW || loadingFolders || saving}
                aria-describedby={loadingFolders || collectionId === NEW ? `${folderField}-note` : undefined}
              >
                <option value={NEW}>New folder…</option>
                {folders.map((f) => (
                  <option key={f._id} value={f._id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>

            {creatingFolder && (
              <Field label="Folder name" htmlFor={folderNameField}>
                <Input
                  id={folderNameField}
                  value={newFolderName}
                  placeholder="Assets"
                  disabled={saving}
                  onChange={(e) => setNewFolderName(e.target.value)}
                />
              </Field>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={saving}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="primary" disabled={saving} aria-busy={saving || undefined}>
              {saving && <LoaderCircle aria-hidden className="animate-spin" />}
              Save {assetsLabel(count)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
