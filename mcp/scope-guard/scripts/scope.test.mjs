/**
 * Deterministic unit tests for Scope policy logic (no network, no server).
 * DNS is injected, so every rebinding / mixed-answer / NXDOMAIN branch is
 * exercised in CI.
 *
 * Run: node --test mcp/scope-guard/scripts/scope.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Scope } from "../dist/scope.js";

function makeScope(allow, lookup) {
  const dir = mkdtempSync(join(tmpdir(), "scope-test-"));
  const s = new Scope(join(dir, "scope.json"), lookup);
  for (const e of allow) assert.equal(s.add(e), null);
  return s;
}

test("public hostname resolving to loopback is denied as rebinding", async () => {
  const s = makeScope(["localtest.me"], async () => [{ address: "127.0.0.1" }, { address: "::1" }]);
  const r = await s.check("http://localtest.me:3000");
  assert.equal(r.allowed, false);
  assert.match(r.reason, /rebinding/);
});

test("public hostname resolving to metadata address is hard-denied", async () => {
  const s = makeScope(["rebind.example"], async () => [{ address: "169.254.169.254" }]);
  const r = await s.check("http://rebind.example");
  assert.equal(r.allowed, false);
  assert.match(r.reason, /metadata/i);
});

test("mixed public+private answers are denied (fail closed)", async () => {
  const s = makeScope(["dual.example"], async () => [{ address: "93.184.216.34" }, { address: "10.0.0.5" }]);
  const r = await s.check("http://dual.example");
  assert.equal(r.allowed, false);
  assert.match(r.reason, /private address/);
});

test("NXDOMAIN fails closed even when scoped", async () => {
  const s = makeScope(["gone.example"], async () => {
    throw Object.assign(new Error("no such record"), { code: "ENOTFOUND" });
  });
  const r = await s.check("http://gone.example");
  assert.equal(r.allowed, false);
  assert.match(r.reason, /fail-closed/);
});

test("internally-scoped name resolving public is denied as class mismatch", async () => {
  const s = makeScope(["intranet.local"], async () => [{ address: "93.184.216.34" }]);
  const r = await s.check("http://intranet.local");
  assert.equal(r.allowed, false);
  assert.match(r.reason, /class mismatch/);
});

test("consistent resolutions are allowed", async () => {
  const s = makeScope(["ok.example"], async () => [{ address: "93.184.216.34" }]);
  const r = await s.check("http://ok.example");
  assert.equal(r.allowed, true);
});

test("IP literals and CIDR entries skip DNS entirely", async () => {
  let called = 0;
  const s = makeScope(["10.50.77.0/24"], async () => {
    called++;
    return [{ address: "127.0.0.1" }];
  });
  const r = await s.check("http://10.50.77.9:8080");
  assert.equal(r.allowed, true);
  assert.equal(called, 0, "DNS must not be consulted for CIDR matches");
});

test("canonicalization: expanded IPv6 loopback matches ::1 entry", async () => {
  const s = makeScope([]); // fresh file -> default allowlist includes canonical "::1"
  const dupErr = await s.add("::1");
  assert.match(dupErr ?? "", /already scoped/);
  const r = await s.check("http://[0:0:0:0:0:0:0:1]:3000");
  assert.equal(r.allowed, true);
  assert.equal(r.matched, "::1");
});

test("mapped-v6 literals are judged by embedded IPv4", async () => {
  const s = makeScope([]);
  assert.match((await s.add("::ffff:169.254.169.254")) ?? "", /hard-denied/);
  const r = await s.check("http://[::ffff:a9fe:a9fe]");
  assert.equal(r.allowed, false);
});

test("reserved v4 literals are refused at add time", async () => {
  const s = makeScope([]);
  for (const entry of ["224.0.0.1", "192.0.2.1", "192.88.99.5", "100.64.1.2", "0.0.0.0"]) {
    const err = await s.add(entry);
    assert.match(err ?? "", /hard-denied/, `${entry} should be refused`);
  }
});

test("CIDR overlap with reserved space is refused", async () => {
  const s = makeScope([]);
  for (const entry of ["169.254.0.0/16", "192.88.99.0/24", "240.0.0.0/4"]) {
    const err = await s.add(entry);
    assert.match(err ?? "", /hard-denied/, `${entry} should be refused`);
  }
  const ok = await s.add("203.0.113.0/24");
  // TEST-NET-3 is classified reserved via literal rules; CIDR form must refuse too
  assert.match(ok ?? "", /hard-denied|TEST|refused/, `203.0.113.0/24 unexpectedly accepted: ${ok}`);
});
