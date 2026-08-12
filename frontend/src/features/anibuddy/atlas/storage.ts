import type { AtlasProject } from "@/features/anibuddy/atlas/types";

const DATABASE = "anibuddy-atlas";
const STORE = "source-blobs";
export const PROJECT_STORAGE_KEY = "anibuddy:atlas-project:v4";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function saveAtlasBlob(key: string, blob: Blob): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(blob, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function readAtlasBlob(key: string): Promise<Blob | null> {
  const database = await openDatabase();
  const value = await new Promise<Blob | null>((resolve, reject) => {
    const request = database.transaction(STORE, "readonly").objectStore(STORE).get(key);
    request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return value;
}

export function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function saveProjectSnapshot(project: AtlasProject): void {
  localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(project));
}

export function readProjectSnapshot(): AtlasProject | null {
  try {
    const project = JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY) ?? "null") as AtlasProject | null;
    return project?.schemaVersion === 4 ? project : null;
  } catch {
    return null;
  }
}
