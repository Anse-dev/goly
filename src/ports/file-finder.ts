export interface FileFinder {
  findFiles(
    baseDir: string,
    pattern: string,
    exclude: string,
    limit: number,
  ): Promise<Array<{ fsPath: string }>>;
}
