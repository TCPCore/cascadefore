export function save(row) {
  db.query('INSERT INTO ledger (id, amount) VALUES (?, ?)', row);
}
