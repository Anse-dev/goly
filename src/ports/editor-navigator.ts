export interface EditorNavigator {
  openFolderInNewWindow(folderPath: string): Promise<void>;
}
