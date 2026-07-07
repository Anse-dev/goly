type Disposable = {
  dispose(): void;
};

type ConfigurationValues = Record<string, unknown>;

const DEFAULT_CONFIG: ConfigurationValues = {
  baseDirectory: '~/workspaces',
  autoRefresh: false,
  refreshInterval: 15000,
  autoOpenInNewWindow: false,
  confirmBeforeDelete: true,
  confirmBeforeDeleteBranch: true,
  envFilePatterns: [],
  postCreateCommands: [],
  confirmBeforePostCreateCommands: true,
  maxWorktrees: 0,
};

let configValues: ConfigurationValues = { ...DEFAULT_CONFIG };
let warningMessageResult: string | undefined;
let executedCommands: unknown[][] = [];

export function __resetMock(): void {
  configValues = { ...DEFAULT_CONFIG };
  warningMessageResult = undefined;
  executedCommands = [];
  workspace.isTrusted = true;
  window.activeTextEditor = undefined;
  window.visibleTextEditors = [];
  window.terminals = [];
  window.tabGroups.all = [];
  debug.breakpoints = [];
}

export function __setMockConfig(values: ConfigurationValues): void {
  configValues = { ...configValues, ...values };
}

export function __setWarningMessageResult(value: string | undefined): void {
  warningMessageResult = value;
}

export function __getExecutedCommands(): unknown[][] {
  return executedCommands.map((command) => [...command]);
}

export class Uri {
  readonly scheme: string;
  readonly fsPath: string;

  private constructor(
    fsPath: string,
    scheme = 'file',
    private readonly serialized = `${scheme}://${fsPath}`,
  ) {
    this.fsPath = fsPath;
    this.scheme = scheme;
  }

  static file(fsPath: string): Uri {
    return new Uri(fsPath, 'file', `file://${fsPath}`);
  }

  static parse(value: string): Uri {
    if (value.startsWith('file://')) {
      return new Uri(value.slice('file://'.length), 'file', value);
    }
    // For non-file URIs, fsPath holds the raw URL string — only use scheme detection in tests.
    const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
    return new Uri(value, schemeMatch?.[1] ?? 'file', value);
  }

  toString(): string {
    return this.serialized;
  }
}

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}

export class Location {
  readonly range: { start: Position };

  constructor(
    readonly uri: Uri,
    position: Position,
  ) {
    this.range = { start: position };
  }
}

export class SourceBreakpoint {
  constructor(
    readonly location: Location,
    readonly enabled = true,
    readonly condition?: string,
  ) {}
}

export class TabInputText {
  constructor(readonly uri: Uri) {}
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

export class ThemeIcon {
  constructor(
    readonly id: string,
    readonly color?: ThemeColor,
  ) {}
}

export class TreeItem {
  contextValue?: string;
  iconPath?: ThemeIcon;
  tooltip?: string;

  constructor(
    readonly label: string,
    readonly collapsibleState: TreeItemCollapsibleState,
  ) {}
}

export class EventEmitter<T> {
  private readonly listeners = new Set<(event: T) => void>();

  readonly event = (listener: (event: T) => void): Disposable => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  fire(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export enum ViewColumn {
  One = 1,
  Two = 2,
  Three = 3,
  Four = 4,
  Five = 5,
  Six = 6,
  Seven = 7,
  Eight = 8,
  Nine = 9,
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum ProgressLocation {
  Notification = 15,
}

export const workspace = {
  isTrusted: true,
  workspaceFolders: [] as Array<{ uri: Uri }>,
  getConfiguration: () => ({
    get: <T>(key: string, fallback: T): T =>
      Object.prototype.hasOwnProperty.call(configValues, key)
        ? (configValues[key] as T)
        : fallback,
  }),
  onDidChangeConfiguration: (): Disposable => ({ dispose: () => undefined }),
  createFileSystemWatcher: (): Disposable & {
    onDidChange(listener: () => void): Disposable;
    onDidCreate(listener: () => void): Disposable;
    onDidDelete(listener: () => void): Disposable;
  } => ({
    dispose: () => undefined,
    onDidChange: () => ({ dispose: () => undefined }),
    onDidCreate: () => ({ dispose: () => undefined }),
    onDidDelete: () => ({ dispose: () => undefined }),
  }),
  findFiles: async (): Promise<Uri[]> => [],
  openTextDocument: async (uri: Uri): Promise<{ uri: Uri }> => ({ uri }),
};

export const window = {
  activeTextEditor: undefined as
    { document: { uri: Uri }; viewColumn?: ViewColumn } | undefined,
  visibleTextEditors: [] as Array<{
    document: { uri: Uri };
    viewColumn?: ViewColumn;
  }>,
  terminals: [] as Array<{
    name: string;
    creationOptions: { cwd?: string | Uri };
    show(): void;
  }>,
  tabGroups: {
    all: [] as Array<{ tabs: Array<{ input: unknown }> }>,
  },
  createOutputChannel: () => ({
    appendLine: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
  }),
  showWarningMessage: async (): Promise<string | undefined> =>
    warningMessageResult,
  showErrorMessage: async (): Promise<undefined> => undefined,
  showInformationMessage: async (): Promise<undefined> => undefined,
  showQuickPick: async (): Promise<undefined> => undefined,
  showInputBox: async (): Promise<undefined> => undefined,
  showTextDocument: async (): Promise<undefined> => undefined,
  withProgress: async <T>(
    _options: unknown,
    task: () => PromiseLike<T> | T,
  ): Promise<T> => task(),
  createTerminal: (options: { name: string; cwd?: string | Uri }) => {
    const terminal = {
      name: options.name,
      creationOptions: { cwd: options.cwd },
      show: () => undefined,
    };
    window.terminals.push(terminal);
    return terminal;
  },
  createStatusBarItem: () => ({
    text: '',
    tooltip: '',
    command: undefined as string | undefined,
    show: () => undefined,
    dispose: () => undefined,
  }),
  registerTreeDataProvider: (): Disposable => ({ dispose: () => undefined }),
};

export const commands = {
  executeCommand: async (...args: unknown[]): Promise<undefined> => {
    executedCommands.push(args);
    return undefined;
  },
  registerCommand: (): Disposable => ({ dispose: () => undefined }),
  getCommands: async (): Promise<string[]> => [],
};

export const debug = {
  breakpoints: [] as SourceBreakpoint[],
  addBreakpoints: (breakpoints: SourceBreakpoint[]): void => {
    debug.breakpoints.push(...breakpoints);
  },
  removeBreakpoints: (breakpoints: readonly SourceBreakpoint[]): void => {
    const removals = new Set(breakpoints);
    debug.breakpoints = debug.breakpoints.filter(
      (breakpoint) => !removals.has(breakpoint),
    );
  },
};

export class RelativePattern {
  constructor(
    readonly base: string,
    readonly pattern: string,
  ) {}
}
