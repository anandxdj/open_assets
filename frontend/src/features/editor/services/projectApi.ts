import { apiClient } from "@/lib/api-client";
import type { JobResponse } from "@/types";

interface Envelope<T> { success: boolean; message: string; data: T }

export interface CanvasTransform { x: number; y: number; width: number; height: number }
export interface CanvasViewport { x: number; y: number; zoom: number }
export interface EditorLayer extends CanvasTransform {
  id: string;
  kind: "source" | "asset";
  sourceBoxId?: string;
  name: string;
  visible: boolean;
  locked: boolean;
}
export interface EditorProjectPage {
  id: string;
  jobId: string;
  name: string;
  overviewFrame: CanvasTransform;
  viewport: CanvasViewport;
  layers: EditorLayer[];
  job: JobResponse | null;
}
export interface EditorProject {
  id: string;
  name: string;
  revision: number;
  pages: EditorProjectPage[];
  updatedAt: string;
}
export interface ProjectSummary { id: string; name: string; pageCount: number; updatedAt: string }

export async function createEditorProject(pages: { jobId: string; name: string }[], name?: string) {
  const result = await apiClient.post<Envelope<EditorProject>>("/api/editor-projects", { pages, name });
  return result.data;
}
export async function getEditorProject(projectId: string) {
  return (await apiClient.get<Envelope<EditorProject>>(`/api/editor-projects/${projectId}`)).data;
}
export async function listEditorProjects() {
  return (await apiClient.get<Envelope<ProjectSummary[]>>("/api/editor-projects")).data;
}
export async function renameEditorProject(projectId: string, name: string) {
  return (await apiClient.patch<Envelope<{ revision: number; name: string }>>(`/api/editor-projects/${projectId}`, { name })).data;
}
export async function addProjectPage(projectId: string, jobId: string, name: string) {
  return (await apiClient.post<Envelope<EditorProject>>(`/api/editor-projects/${projectId}/pages`, { jobId, name })).data;
}
export async function saveProjectPage(projectId: string, pageId: string, revision: number, patch: Partial<Pick<EditorProjectPage, "name" | "overviewFrame" | "viewport" | "layers">>) {
  return (await apiClient.put<Envelope<{ revision: number; page: EditorProjectPage }>>(`/api/editor-projects/${projectId}/pages/${pageId}`, { revision, ...patch })).data;
}
export async function reorderProjectPages(projectId: string, pageIds: string[]) {
  return (await apiClient.put<Envelope<{ revision: number }>>(`/api/editor-projects/${projectId}/pages/order`, { pageIds })).data;
}
export async function deleteProjectPage(projectId: string, pageId: string) {
  return (await apiClient.del<Envelope<{ revision: number }>>(`/api/editor-projects/${projectId}/pages/${pageId}`)).data;
}
export async function restoreProjectPage(projectId: string, pageId: string) {
  return (await apiClient.post<Envelope<{ revision: number }>>(`/api/editor-projects/${projectId}/pages/${pageId}/restore`)).data;
}
