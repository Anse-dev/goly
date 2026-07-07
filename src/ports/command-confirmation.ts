export interface CommandConfirmation {
  askBeforeRunning(
    worktreeName: string,
    commands: readonly string[],
  ): Promise<boolean>;
}
