// The welcome after sign-up (server/auth.mjs): dates of birth as people give them, the age the tutor is
// told, and accounts made before the welcome counting as welcomed. A throwaway database.   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';

const DB = path.join(os.tmpdir(), `primer-welcome-${process.pid}.db`);
process.env.PRIMER_DB = DB;
const auth = await import('../server/auth.mjs');
const { db, q } = await import('../server/db.mjs');
test.after(() => {
  db.close();
  for (const f of [DB, DB + '-wal', DB + '-shm']) rmSync(f, { force: true });
});

const year = new Date().getFullYear();

test('a date of birth: a whole date, or the year alone; nothing impossible, nothing too young or too old', () => {
  assert.equal(auth.cleanDob('2010-05-17'), '2010-05-17');
  assert.equal(auth.cleanDob('2010'), '2010');
  assert.equal(auth.cleanDob(String(year - 2)), null, 'younger than 3');
  assert.equal(auth.cleanDob(String(year - 111)), null, 'older than 110');
  assert.equal(auth.cleanDob('2010-02-30'), null, 'no 30 February');
  assert.equal(auth.cleanDob('2010-13-01'), null, 'no 13th month');
  assert.equal(auth.cleanDob(`${year + 1}-01-01`), null, 'not in the future');
  for (const bad of ['', 'abc', '10-05-2010', '2010/05/17', null, undefined]) assert.equal(auth.cleanDob(bad), null);
});

test('age: from the whole date, or from the year alone', () => {
  const y = year - 20;
  assert.equal(auth.ageOf(String(y)), 20);
  assert.equal(auth.ageOf(`${y}-01-01`), 20); // the birthday has been this year
  assert.equal(auth.ageOf(`${y}-12-31`), new Date().getMonth() === 11 && new Date().getDate() === 31 ? 20 : 19);
  assert.equal(auth.ageOf('nonsense'), null);
});

test('the tutor is told the age only when it is known', () => {
  assert.match(auth.learnerLine({ name: 'Asha', dob: String(year - 14) }), /Asha, about 14 years old/);
  assert.equal(auth.learnerLine({ name: 'Ravi', dob: null }), 'The learner is Ravi.');
  assert.equal(auth.learnerLine({ name: '', dob: null }), 'The learner is a learner.');
});

test('accounts made before the welcome count as welcomed; a new one has it to do', () => {
  const old = Number(q("INSERT INTO users (email, name, pass, created_at, welcomed_at) VALUES ('old@test.invalid', 'Old', 'x', 1, 1)").run().lastInsertRowid);
  const fresh = Number(q("INSERT INTO users (email, name, pass, created_at) VALUES ('new@test.invalid', '', 'x', 2)").run().lastInsertRowid);
  const row = (id) => q('SELECT id, email, name, lang, dob, welcomed_at FROM users WHERE id = ?').get(id);
  assert.equal(auth.publicUser(row(old)).welcome, false);
  assert.equal(auth.publicUser(row(fresh)).welcome, true);
  assert.equal(auth.publicUser(row(fresh)).dob, null);
});
