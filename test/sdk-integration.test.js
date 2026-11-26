import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createCollectorRuntime } from "tibu";
import StarterCollector from "../main.js";
import { loadCollector } from "./helpers/load-collector.js";

const replay = JSON.parse(await readFile(new URL("./fixtures/replay.json", import.meta.url), "utf8"));
const expected = JSON.parse(await readFile(new URL("./fixtures/collect.json", import.meta.url), "utf8"));

/**
 * Decodes recorded HAR content, preserving binary attachment bytes.
 */
function content(response) {
  const body = response.content;
  return body.encoding === "base64" ? Buffer.from(body.text, "base64") : Buffer.from(body.text, "utf8");
}

/**
 * Replays the same requests as Java and supplies fixed identities and dates to the SDK.
 */
async function replayStarter() {
  const uuidQueue = [...expected.accounts, ...expected.recurringPayments].map(record => record.uuid);
  const files = new Map();
  let position = 0;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
  const dates = new Map(expected.transactions.map(transaction => [formatter.format(new Date(transaction.dateTransaction)), Date.parse(transaction.dateTransaction)]));
  const runtime = createCollectorRuntime({
    shouldStop: () => false,
    call: async request => {
      const { method, arguments: args } = JSON.parse(request);
      let value;
      if (method === "runtime.randomUUID") {
        value = uuidQueue.shift();
        assert.ok(value, "Every generated UUID must have a Java counterpart");
      } else if (method === "runtime.startOfDay") {
        assert.equal(args[1], "Europe/Paris");
        value = dates.get(args[0]);
        assert.ok(Number.isFinite(value), `Missing fixed date ${args[0]}`);
      } else {
        const recorded = replay[position++];
        assert.ok(recorded, `Unexpected request ${method}`);
        assert.equal(args[0], recorded.request.url);
        assert.equal(method, recorded.download ? "internet.downloadFile" : recorded.request.method === "POST" ? "internet.post" : "internet.get");
        if (method === "internet.post") {
          assert.deepEqual(Object.fromEntries(new URLSearchParams(args[1])), Object.fromEntries(new URLSearchParams(recorded.request.postData.text)));
          assert.equal(args[2], recorded.request.postData.mimeType);
        }
        const response = recorded.response;
        let body = content(response).toString("utf8");
        if (recorded.download) {
          body = `tibu-file:replay-${position}`;
          files.set(body, { content: content(response).toString("base64"), encoding: "base64" });
        }
        value = {
          code: response.status, message: response.statusText, method: recorded.request.method,
          location: response._location ?? recorded.request.url, protocol: response.httpVersion,
          headers: Object.fromEntries(response.headers.map(header => [header.name, header.value])), body
        };
      }
      return JSON.stringify({ ok: true, value });
    }
  });
  const Collector = await loadCollector(runtime);
  const collector = new Collector();
  runtime.load(collector);
  assert.equal(JSON.parse(await runtime.initialize({
    configuration: { login: "camille@example.test", password: "demo1234", withOtp: false },
    settings: {}, previousAccounts: [], previousRecurringPayments: []
  })).ok, true);
  collector.minIntervalBetweenRequestInMs = 0;
  assert.deepEqual(JSON.parse(await runtime.run("validate")).value, []);
  const collected = JSON.parse(await runtime.run("collect"));
  assert.equal(collected.ok, true, JSON.stringify(collected.error));
  assert.equal(collected.value, true);
  assert.equal(position, replay.length, "Consume the complete Java replay");
  assert.equal(uuidQueue.length, 0);
  return { collector, snapshot: collected.snapshot, files };
}

/**
 * Selects expected DTO fields and resolves host capabilities before comparing to Java.
 * Java's result serializer omits some unused DTO fields; populated values remain checked.
 */
function project(actual, reference, files) {
  if (reference === null) {
    return actual ?? null;
  }
  if (Array.isArray(reference)) {
    assert.equal(actual.length, reference.length);
    return reference.map((entry, index) => project(actual[index], entry, files));
  }
  if (typeof reference === "object") {
    if (reference.encoding === "base64") {
      return files.get(actual);
    }
    return Object.fromEntries(Object.entries(reference).map(([key, value]) => [key, project(actual[key], value, files)]));
  }
  if (typeof reference === "string" && /^\d{4}-\d{2}-\d{2}T/.test(reference)) {
    assert.equal(actual, Date.parse(reference));
    return reference;
  }
  return actual;
}

test("complete starter matches the Java recorded scenario, including attachment bytes and zoned dates", async () => {
  const { snapshot, files } = await replayStarter();
  assert.deepEqual(project(snapshot, expected, files), expected);
  assert.equal(snapshot.configurationName, "Maison démo (camille@***.**)");
  assert.match(snapshot.configurationIdHash, /^[0-9a-f]{32}$/);
});

test("resuming the Java-compatible checkpoint skips all completed references", async () => {
  const { snapshot } = await replayStarter();
  const checkpoint = JSON.parse(snapshot.settings["tibu.collect.progress"]);
  const collector = new StarterCollector();
  collector.initialize({
    configuration: { login: "camille@example.test" }, settings: { ...snapshot.settings },
    previousAccounts: snapshot.accounts, previousRecurringPayments: snapshot.recurringPayments,
    isStopRequested: () => false
  });
  collector.readTransactionPage = async () => ({
    transactions: snapshot.transactions.map(transaction => ({
      id: transaction.id,
      date: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(transaction.dateTransaction))
    })), nextPage: null
  });
  collector.collectTransaction = async () => { throw new Error("Completed references must not be collected again"); };
  assert.equal(await collector.synchronizeTransactions(), true);
  assert.deepEqual(collector.transactions, []);
  assert.deepEqual(collector.loadProgress(), checkpoint);
});
