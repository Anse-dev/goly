export interface WorkspaceWatcher {
  watch(
    baseDir: string,
    pattern: string,
    listener: () => void,
  ): { dispose(): void };
}
