import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLayout } from '../lib/tablesAdmin.js';

const current = () => ({
  restaurant_id: 'r', revision: 1, count: 3, next_id: 4,
  sections: ['Main Hall', 'AC Room'],
  tables: [
    { id: 1, name: 'T1', section: 'Main Hall', capacity: 2 },
    { id: 2, name: 'T2', section: 'Main Hall', capacity: 4 },
    { id: 3, name: 'T3', section: 'AC Room', capacity: 4 }
  ]
});

test('rename, move, reorder, add and delete in one save', () => {
  const r = applyLayout(current(), {
    sections: ['AC Room', 'Main Hall', 'Patio'],
    tables: [
      { id: 3, name: 'Window 1', section: 'AC Room', capacity: 6 },
      { id: 1, name: 'T1', section: 'Main Hall', capacity: 2 },
      { name: 'P1', section: 'Patio', capacity: 4 }
    ]
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.sections, ['AC Room', 'Main Hall', 'Patio']);
  assert.deepEqual(r.data.tables, [
    { id: 3, name: 'Window 1', section: 'AC Room', capacity: 6 },
    { id: 1, name: 'T1', section: 'Main Hall', capacity: 2 },
    { id: 4, name: 'P1', section: 'Patio', capacity: 4 }
  ]);
  assert.equal(r.data.count, 3);
  assert.equal(r.data.next_id, 5);
  assert.equal(r.data.revision, 1, 'revision is bumped by the store, not here');
});

test('ids are never reused, even after deleting the highest table', () => {
  const r = applyLayout(current(), {
    sections: ['Main Hall'],
    tables: [{ id: 1, name: 'T1', section: 'Main Hall', capacity: 2 }, { name: 'New', section: 'Main Hall', capacity: 2 }]
  });
  assert.equal(r.data.tables[1].id, 4, 'T3 (id 3) was deleted but 4 is next, not 3');

  const noCounter = current();
  delete noCounter.next_id;
  const r2 = applyLayout(noCounter, {
    sections: ['Main Hall'],
    tables: [{ name: 'New', section: 'Main Hall', capacity: 2 }]
  });
  assert.equal(r2.data.tables[0].id, 4, 'falls back to max(existing ids) + 1');
});

test('section and table names are trimmed and matched case-insensitively to the section list', () => {
  const r = applyLayout(current(), {
    sections: [' Main Hall '],
    tables: [{ id: 1, name: ' T1 ', section: 'main hall', capacity: 2 }]
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.tables[0], { id: 1, name: 'T1', section: 'Main Hall', capacity: 2 });
});

test('duplicate table names (case-insensitive) are rejected', () => {
  const r = applyLayout(current(), {
    sections: ['Main Hall'],
    tables: [{ id: 1, name: 'T1', section: 'Main Hall', capacity: 2 }, { id: 2, name: 't1', section: 'Main Hall', capacity: 2 }]
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.code, 'INVALID_LAYOUT');
  assert.equal(r.errors[0].field, 'tables[1].name');
});

test('invalid sections, ids and capacities are rejected with field paths', () => {
  const run = (sections, tables) => applyLayout(current(), { sections, tables });
  assert.equal(run(['A', 'a'], []).errors[0].field, 'sections[1]');
  assert.equal(run([''], []).errors[0].field, 'sections[0]');
  assert.equal(run(['A'], [{ name: 'X', section: 'B', capacity: 2 }]).errors[0].field, 'tables[0].section');
  assert.equal(run(['A'], [{ id: 99, name: 'X', section: 'A', capacity: 2 }]).errors[0].field, 'tables[0].id');
  assert.equal(run(['A'], [{ id: 1, name: 'X', section: 'A', capacity: 2 }, { id: 1, name: 'Y', section: 'A', capacity: 2 }]).errors[0].field, 'tables[1].id');
  assert.equal(run(['A'], [{ name: 'X', section: 'A', capacity: 0 }]).errors[0].field, 'tables[0].capacity');
  assert.equal(run(['A'], [{ name: 'X', section: 'A', capacity: 2.5 }]).errors[0].field, 'tables[0].capacity');
  assert.equal(run(['A'], [{ name: 'X', section: 'A', capacity: 51 }]).errors[0].field, 'tables[0].capacity');
  assert.equal(applyLayout(current(), { sections: 'nope', tables: [] }).code, 'INVALID_LAYOUT');
  assert.equal(applyLayout(current(), null).code, 'INVALID_LAYOUT');
});

test('a table with an open bill cannot be renamed or deleted, but can change seats and section', () => {
  const open = new Set(['1']);

  const renamed = applyLayout(current(), {
    sections: ['Main Hall', 'AC Room'],
    tables: [
      { id: 1, name: 'Window', section: 'Main Hall', capacity: 2 },
      { id: 2, name: 'T2', section: 'Main Hall', capacity: 4 },
      { id: 3, name: 'T3', section: 'AC Room', capacity: 4 }
    ]
  }, open);
  assert.equal(renamed.ok, false);
  assert.equal(renamed.status, 409);
  assert.equal(renamed.code, 'TABLE_HAS_OPEN_BILL');
  assert.deepEqual(renamed.details, [{ id: 1, name: 'T1', action: 'rename' }]);
  assert.match(renamed.error, /T1 \(rename\)/);

  const deleted = applyLayout(current(), {
    sections: ['Main Hall', 'AC Room'],
    tables: [{ id: 2, name: 'T2', section: 'Main Hall', capacity: 4 }, { id: 3, name: 'T3', section: 'AC Room', capacity: 4 }]
  }, open);
  assert.deepEqual(deleted.details, [{ id: 1, name: 'T1', action: 'delete' }]);

  const moved = applyLayout(current(), {
    sections: ['Main Hall', 'AC Room'],
    tables: [
      { id: 1, name: 'T1', section: 'AC Room', capacity: 8 },
      { id: 2, name: 'T2', section: 'Main Hall', capacity: 4 },
      { id: 3, name: 'T3', section: 'AC Room', capacity: 4 }
    ]
  }, open);
  assert.equal(moved.ok, true);
  assert.deepEqual(moved.data.tables[0], { id: 1, name: 'T1', section: 'AC Room', capacity: 8 });
});

test('a layout with no tables is valid', () => {
  const r = applyLayout(current(), { sections: ['Main Hall'], tables: [] });
  assert.equal(r.ok, true);
  assert.equal(r.data.count, 0);
  assert.deepEqual(r.data.tables, []);
  assert.equal(r.data.next_id, 4);
});

// Additional tests for hostile input and mutation detection

test('hostile input: invalid types do not throw and do not mutate', () => {
  const snap = current();
  const snapBefore = JSON.parse(JSON.stringify(snap));

  const r1 = applyLayout(snap, { sections: ['A'], tables: [null, 5, 'x', [], {}, { name: 'T', section: 'A', capacity: 2, id: {} }] });
  assert.equal(r1.ok, false);
  assert.equal(r1.status, 400);
  assert.equal(r1.code, 'INVALID_LAYOUT');
  assert.deepEqual(snap, snapBefore, 'input object was not mutated by hostile table list');

  const r2 = applyLayout(snap, { sections: [null, 5, {}, ['x']], tables: [] });
  assert.equal(r2.ok, false);
  assert.equal(r2.status, 400);
  assert.equal(r2.code, 'INVALID_LAYOUT');
  assert.deepEqual(snap, snapBefore, 'input object was not mutated by hostile sections list');
});

test('happy path rename/move/reorder/add does not mutate input', () => {
  const snap = current();
  const snapBefore = JSON.parse(JSON.stringify(snap));

  const r = applyLayout(snap, {
    sections: ['AC Room', 'Main Hall', 'Patio'],
    tables: [
      { id: 3, name: 'Window 1', section: 'AC Room', capacity: 6 },
      { id: 1, name: 'T1', section: 'Main Hall', capacity: 2 },
      { name: 'P1', section: 'Patio', capacity: 4 }
    ]
  });
  assert.equal(r.ok, true);
  assert.deepEqual(snap, snapBefore, 'happy path also did not mutate current object');
});

test('next_id counter is respected when higher than max(existing ids) + 1', () => {
  const curr = {
    restaurant_id: 'r', revision: 1, count: 2, next_id: 10,
    sections: ['Main Hall'],
    tables: [
      { id: 1, name: 'T1', section: 'Main Hall', capacity: 2 },
      { id: 2, name: 'T2', section: 'Main Hall', capacity: 4 }
    ]
  };
  const r = applyLayout(curr, {
    sections: ['Main Hall'],
    tables: [{ id: 1, name: 'T1', section: 'Main Hall', capacity: 2 }, { name: 'New', section: 'Main Hall', capacity: 2 }]
  });
  assert.equal(r.data.tables[1].id, 10);
  assert.equal(r.data.next_id, 11);
});
