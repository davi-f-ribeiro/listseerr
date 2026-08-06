import { describe, expect, test } from 'bun:test';
import { resolve } from 'path';
import { Database } from 'bun:sqlite';
import { is } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

const MIGRATIONS_FOLDER = resolve(import.meta.dir, '../../../migrations');

// Applies every migration in order to an empty database, exactly like bootstrap does.
function migrateFreshDatabase(): Database {
  const sqlite = new Database(':memory:');
  migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });
  return sqlite;
}

function columnsOf(sqlite: Database, table: string): string[] {
  const rows = sqlite.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
  return rows.map((row) => row.name).sort();
}

describe('migrations', () => {
  test('apply cleanly to an empty database', () => {
    expect(() => migrateFreshDatabase().close()).not.toThrow();
  });

  // Guards against schema.ts changing without a matching generated migration: the
  // migrated database and the Drizzle schema must describe the same tables/columns.
  test('produce a database matching schema.ts', () => {
    const sqlite = migrateFreshDatabase();

    const tables = Object.values<unknown>(schema)
      .filter((value) => is(value, SQLiteTable))
      .map((table) => getTableConfig(table));
    expect(tables.length).toBeGreaterThan(0);

    for (const table of tables) {
      const expected = table.columns.map((column) => column.name).sort();
      expect({ [table.name]: columnsOf(sqlite, table.name) }).toEqual({
        [table.name]: expected,
      });
    }

    sqlite.close();
  });
});
