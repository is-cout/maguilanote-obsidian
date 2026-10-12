import assert from "node:assert/strict";
import test from "node:test";
import { parseBoard } from "../src/types.ts";

test("parseBoard returns an empty board for malformed top-level data", () => {
  assert.deepEqual(parseBoard("null"), { version: 1, items: [], edges: [] });
  assert.deepEqual(parseBoard("[]"), { version: 1, items: [], edges: [] });
  assert.deepEqual(parseBoard("not json"), { version: 1, items: [], edges: [] });
});

test("parseBoard rejects malformed items and edges at the file boundary", () => {
  const board = parseBoard(JSON.stringify({
    version: 1,
    items: [
      { id: "ok", type: "note", x: 10, y: 20, w: 200 },
      { id: "bad", type: "unknown", x: 10, y: 20, w: 200 },
      { id: "bad-number", type: "note", x: "10", y: 20, w: 200 },
      null,
    ],
    edges: [{ id: "edge" }, { id: 42 }],
  }));
  assert.equal(board.items.length, 1);
  assert.equal(board.edges.length, 1);
  assert.equal(board.items[0].id, "ok");
});

test("parseBoard rejects non-positive dimensions", () => {
  const board = parseBoard(JSON.stringify({
    items: [{ id: "zero", type: "note", x: 0, y: 0, w: 0 }, { id: "negative", type: "note", x: 0, y: 0, w: -1 }],
    edges: [],
  }));
  assert.equal(board.items.length, 0);
});
