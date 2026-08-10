import type { WorkerRequest, WorkerResponse } from './contracts';
import { browser } from 'wxt/browser';

export async function callWorker(message: WorkerRequest): Promise<WorkerResponse> {
  return browser.runtime.sendMessage(message) as Promise<WorkerResponse>;
}
