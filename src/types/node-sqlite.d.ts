declare module "node:sqlite" {
  type SqliteValue = string | number | bigint | Uint8Array | null;

  export class StatementSync {
    all(...parameters: SqliteValue[]): Record<string, unknown>[];
    get(...parameters: SqliteValue[]): Record<string, unknown> | undefined;
    run(...parameters: SqliteValue[]): {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
  }

  export class DatabaseSync {
    constructor(location: string);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
