import { memoryFiles, type JsonFiles } from '@lbcwallet/services';

export interface FileBackend {
  loadFiles(): Promise<{ files: Record<string, string> }>;
  writeFile(options: { name: string; content: string }): Promise<void>;
  deleteFile(options: { name: string }): Promise<void>;
}

export interface DurableFiles extends JsonFiles {
  /** Resolves once every change so far is on disk. */
  flush(): Promise<void>;
}

/**
 * The services read documents synchronously, so everything is loaded into
 * memory at startup and every change is written through to app storage, in
 * order. `flush()` lets callers wait until a change is durable (the app waits
 * before reporting success to the UI, so a new wallet is never only in memory).
 */
export async function durableFiles(backend: FileBackend, onError: (message: string) => void): Promise<DurableFiles> {
  const { files } = await backend.loadFiles();
  let queue: Promise<void> = Promise.resolve();
  const persist = (name: string, json: string | null) => {
    queue = queue
      .then(() => (json === null ? backend.deleteFile({ name }) : backend.writeFile({ name, content: json })))
      .catch((err: unknown) => onError(`could not save ${name}: ${(err as Error)?.message ?? String(err)}`));
  };
  const docs = memoryFiles(files, persist);
  return { ...docs, flush: () => queue };
}
