// Deprecated compatibility entry point. Keep the old path non-mutating so an
// operator cannot bypass target confirmation on the controlled CLI.
console.error(
  "Este script foi desativado. Use `npm run ops:startup -- schema --confirm-db=<nome-do-banco> [--apply]`.",
);
process.exitCode = 1;
