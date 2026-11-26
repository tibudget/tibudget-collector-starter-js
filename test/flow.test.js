import assert from "node:assert/strict";
import test from "node:test";
import StarterCollector from "../main.js";
import { parseHTML } from "linkedom";

/**
 * Creates an initialized collector with fixed account identities and configurable host providers.
 */
function initializedCollector(overrides = {}) {
  const collector = new StarterCollector();
  collector.initialize({
    configuration: { login: "camille@example.test", password: "demo1234", withOtp: true }, settings: {},
    previousAccounts: [{ id: "camille@example.test", uuid: "shopping-uuid", type: "SHOPPING", syncEnabled: true }],
    previousRecurringPayments: [], isStopRequested: () => false,
    ...overrides
  });
  collector.minIntervalBetweenRequestInMs = 0;
  return collector;
}

/**
 * Supplies history references while retaining the real checkpointing and stop behavior.
 */
function historyCollector(pages) {
  const collector = initializedCollector();
  collector.signIn = async () => {};
  collector.synchronizeAccounts = async () => {};
  collector.synchronizeRecurringPayments = async () => {};
  collector.readTransactionPage = async () => {
    await collector.beforeRequest();
    const page = pages.shift();
    assert.ok(page, "All requested pages must be supplied");
    return page;
  };
  collector.collectTransaction = async (account, pending) => ({ id: pending.id, accountUuid: account.uuid });
  return collector;
}

test("validation preserves Java message keys for blank credentials", () => {
  const collector = initializedCollector({ configuration: { login: " ", password: "" } });
  assert.deepEqual(collector.validate().map(message => [message.fieldName, message.messageKey]), [
    ["login", "form.error.login.required"], ["password", "form.error.password.required"]
  ]);
});

test("login submits only chosen fields with CSRF and completes SMS OTP", async () => {
  const submitted = [];
  const pages = [
    '<form action="/fr/connexion"><input name="login"><input name="csrf" value="login-token"><input type="checkbox" name="unchecked" value="1"></form>',
    '<form action="/fr/otp"><input name="otp"><input name="csrf" value="otp-token"></form>',
    '<h1 class="account-heading">Account</h1>'
  ];
  const collector = initializedCollector({
    internetProvider: {
      async get() { return { code: 200, body: pages.shift() }; },
      async post(url, body) {
        submitted.push({ url, fields: Object.fromEntries(new URLSearchParams(body)) });
        return { code: 200, body: pages.shift() };
      }
    },
    otpProvider: {
      Channel: { SMS: "SMS" }, PATTERN_4_DIGIT: "\\d{4}",
      async getCode(...args) {
        assert.deepEqual(args, ["SMS", "Maison démo", "\\d{4}", "starter.otp.prompt"]);
        return "1234";
      }
    }
  });
  await collector.signIn();
  assert.deepEqual(submitted, [
    { url: "https://tests.tibudget.com/fr/connexion", fields: { login: "camille@example.test", password: "demo1234", with_otp: "1", csrf: "login-token" } },
    { url: "https://tests.tibudget.com/fr/otp", fields: { otp: "1234", csrf: "otp-token" } }
  ]);
});

test("OTP failure categories distinguish missing provider, missing code and refused code", async () => {
  for (const [provider, expectedKey] of [
    [null, "error.otp.no_provider"],
    [{ getCode: async () => null }, "error.otp.no_code"],
    [{ getCode: async () => "0000" }, "error.otp.code_refused"]
  ]) {
    const collector = initializedCollector({ otpProvider: provider && { ...provider, Channel: { SMS: "SMS" }, PATTERN_4_DIGIT: "\\d{4}" } });
    collector.page = async () => parseHTML('<form><input name="login"></form>').document;
    collector.submitForm = async () => parseHTML('<form><input name="otp"></form>').document;
    await assert.rejects(collector.signIn(), { name: "AccessDeny", messageKey: expectedKey });
  }
});

test("stop before collection still saves one complete transaction and avoids the next request", async () => {
  const pages = [
    { transactions: [{ id: "first-purchase", date: "2026-01-02" }], nextPage: "next" },
    { transactions: [{ id: "second-purchase", date: "2026-01-03" }], nextPage: null }
  ];
  const collector = historyCollector(pages);
  collector.stop();
  assert.equal(await collector.collect(), false);
  assert.deepEqual(collector.transactions.map(transaction => transaction.id), ["first-purchase"]);
  assert.deepEqual(collector.loadProgress(), { lastTransactionDate: "2026-01-02", transactionReferences: ["first-purchase"] });
  assert.equal(pages.length, 1);
});

test("incomplete details leave checkpoint unchanged", async () => {
  const collector = historyCollector([{ transactions: [{ id: "incomplete-purchase", date: "2026-01-02" }], nextPage: null }]);
  collector.collectTransaction = async () => null;
  assert.equal(await collector.collect(), false);
  assert.deepEqual(collector.transactions, []);
  assert.deepEqual(collector.settings, {});
});

test("same-date references resume without duplicates or skipped new purchases", async () => {
  const collector = historyCollector([{ transactions: [
    { id: "older-purchase", date: "2026-01-01" },
    { id: "saved-purchase", date: "2026-01-02" },
    { id: "new-purchase", date: "2026-01-02" }
  ], nextPage: null }]);
  collector.settings["tibu.collect.progress"] = JSON.stringify({ lastTransactionDate: "2026-01-02", transactionReferences: ["saved-purchase"] });
  assert.equal(await collector.collect(), true);
  assert.deepEqual(collector.transactions.map(transaction => transaction.id), ["new-purchase"]);
  assert.deepEqual(collector.loadProgress().transactionReferences, ["new-purchase", "saved-purchase"]);
});

test("disabled shopping account skips history", async () => {
  const collector = historyCollector([]);
  collector.accounts[0].syncEnabled = false;
  assert.equal(await collector.collect(), true);
  assert.deepEqual(collector.transactions, []);
  assert.deepEqual(collector.settings, {});
});

test("history going backwards fails before advancing past older uncollected purchases", async () => {
  const collector = historyCollector([
    { transactions: [{ id: "newer-purchase", date: "2026-01-02" }], nextPage: "older-page" },
    { transactions: [{ id: "older-purchase", date: "2026-01-01" }], nextPage: null }
  ]);
  await assert.rejects(collector.collect(), { name: "CollectError" });
  assert.deepEqual(collector.loadProgress().transactionReferences, ["newer-purchase"]);
});

test("subscription amounts use SDK parsing and retain the existing plan identity", async () => {
  const plan = { id: "maison-plus", uuid: "existing-plan", accountUuid: "shopping-uuid" };
  const collector = initializedCollector({ previousRecurringPayments: [plan] });
  collector.customerAccountHomePage = parseHTML('<div class="subscription"><h2><small>1 234,56 € /mois</small></h2></div>').document;
  await collector.synchronizeRecurringPayments();
  assert.equal(plan.expectedAmount, -1234.56);
  assert.equal(plan.uuid, "existing-plan");
  assert.equal(collector.recurringPayments.length, 1);
});

test("required subscription amounts reject missing, malformed and foreign-currency prices", async () => {
  for (const price of ["", "<small>unavailable</small>", "<small>12,50 USD</small>"]) {
    const collector = initializedCollector({
      previousRecurringPayments: [{ id: "maison-plus", uuid: "existing-plan", accountUuid: "shopping-uuid" }]
    });
    collector.customerAccountHomePage = parseHTML(`<div class="subscription"><h2>${price}</h2></div>`).document;
    await assert.rejects(collector.synchronizeRecurringPayments(), { name: "CollectError" });
    assert.deepEqual(collector.settings, {});
  }
});

test("HTTP and download service rejections preserve the SDK error and its arguments", async () => {
  const { ConnectionFailure } = await import("tibu");
  const failure = new ConnectionFailure("service.failure", "retry-later");
  const collector = initializedCollector({
    internetProvider: {
      async get() { throw failure; },
      async downloadFile() { throw failure; }
    }
  });
  await assert.rejects(collector.page("/fr/compte"), error => error === failure);
  await assert.rejects(collector.downloadAttachment("/invoice.pdf", "INVOICE", "invoice", "application/pdf"), error => error === failure);
});
