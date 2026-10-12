import assert from "node:assert/strict";
import test from "node:test";
import { parseBoard } from "../src/types.ts";

test("parseBoard returns an empty board for malformed top-level data", () => {
  assert.deepEqual(parseBoard("null"), { version: 1, items: [], edges: [] });
  assert.deepEqual(parseBoard("[]"), { version: 1, items: [], edges: [] });
  assert.deepEqual(parseBoard("not json"), { version: 1, items: [], edges: [] });
});

test("parseBoard drops only entries that carry no data", () => {
  const board = parseBoard(JSON.stringify({
    version: 1,
    items: [{ id: "ok", type: "note", x: 10, y: 20, w: 200 }, null, 42],
    edges: [{ id: "edge" }, null],
  }));
  assert.deepEqual(board.items.map((it) => it.id), ["ok"]);
  assert.equal(board.edges.length, 1);
});

// whatever parseBoard drops is erased from disk on the next save, so items it
// doesn't fully understand (newer card types, odd values) must survive the load
test("parseBoard keeps items it cannot fully validate", () => {
  const board = parseBoard(JSON.stringify({
    items: [
      { id: "future", type: "card-from-newer-version", x: 0, y: 0, w: 200 },
      { id: "odd-number", type: "note", x: "10", y: 20, w: 0 },
    ],
    edges: [],
  }));
  assert.deepEqual(board.items.map((it) => it.id), ["future", "odd-number"]);
});
