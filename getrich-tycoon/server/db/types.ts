export type Row = Record<string, unknown>;

export interface Queryable {
  /** Run a statement with $1..$n placeholders and return rows. */
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Database extends Queryable {
  readonly kind: 'postgres' | 'sqlite';
  /** Execute a multi-statement script without parameters (DDL). */
  exec(sql: string): Promise<void>;
  /** Run `fn` inside a single ACID transaction; rolled back on any error. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
