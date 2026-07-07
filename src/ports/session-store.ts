export interface SessionStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Promise<void>;
}
