import { test } from "node:test";
import assert from "node:assert/strict";

import { normaliseRepositorySetting } from "../config.ts";

const SLUG = "davarntrades/Trajectory-Always-On-Executive-Intelligence-";

test("a bare owner/name slug is used as-is", () => {
  assert.equal(normaliseRepositorySetting(SLUG), SLUG);
});

test("a pasted clone or browser URL is reduced to owner/name", () => {
  // This is the likeliest way the setting goes wrong: it passes the configured
  // check, then fails later as a 404 from GitHub, which is far harder to
  // attribute than a missing variable.
  assert.equal(normaliseRepositorySetting(`https://github.com/${SLUG}`), SLUG);
  assert.equal(normaliseRepositorySetting(`https://www.github.com/${SLUG}`), SLUG);
  assert.equal(normaliseRepositorySetting(`https://github.com/${SLUG}.git`), SLUG);
  assert.equal(normaliseRepositorySetting(`https://github.com/${SLUG}/`), SLUG);
  assert.equal(normaliseRepositorySetting(`git@github.com:${SLUG}.git`), SLUG);
});

test("surrounding whitespace does not make the setting unreadable", () => {
  assert.equal(normaliseRepositorySetting(`  ${SLUG}\n`), SLUG);
});

test("absent or blank settings resolve to undefined, not an empty string", () => {
  // An empty string would be falsy anyway, but returning undefined keeps the
  // configured check and the missing-variable list in agreement.
  assert.equal(normaliseRepositorySetting(undefined), undefined);
  assert.equal(normaliseRepositorySetting(""), undefined);
  assert.equal(normaliseRepositorySetting("   "), undefined);
});
