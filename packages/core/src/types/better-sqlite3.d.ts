declare module "better-sqlite3" {
  namespace Database {
    interface Database {
      pragma(source: string): unknown;
      exec(source: string): void;
      prepare(source: string): {
        get(...parameters: unknown[]): unknown;
        all(...parameters: unknown[]): unknown[];
        run(...parameters: unknown[]): unknown;
      };
      transaction<T>(callback: () => T): () => T;
      close(): void;
    }
  }
  const Database: {
    new (filename: string): Database.Database;
  };
  export = Database;
}
