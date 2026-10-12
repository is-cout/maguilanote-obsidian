import assert from "node:assert/strict";
import test from "node:test";
import { segmentIntersectsRect } from "../src/geometry.ts";

test("segment selection detects crossing lines", () => {
  assert.equal(segmentIntersectsRect(-10, 5, 20, 5, 0, 0, 10, 10), true);
  assert.equal(segmentIntersectsRect(-10, -10, -2, -2, 0, 0, 10, 10), false);
  assert.equal(segmentIntersectsRect(0, 0, 10, 10, 0, 0, 10, 10), true);
  assert.equal(segmentIntersectsRect(5, 5, 5, 5, 0, 0, 10, 10), true);
});
