// Ordered, one-off schema changes made after schema.sql first shipped.
// Append only; never edit an entry that has been deployed. Each runs once,
// in a transaction, and is recorded in schema_migrations.
export const MIGRATIONS = [
  // { name: "0001-example", sql: "alter table cases add column if not exists x text" },
];
