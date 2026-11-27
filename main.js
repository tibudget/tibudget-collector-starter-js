import { parseHTML, AccessDeny, CollectError, TemporaryUnavailable, CollectorUtils } from "tibu";

const DOMAIN = "https://tests.tibudget.com";
const TIME_ZONE = "Europe/Paris";
const SUBSCRIPTION_ID = "maison-plus";
const PROGRESS_KEY = "tibu.collect.progress";

/**
 * Signals cooperative interruption without treating completed work as a failure.
 */
class MustStop extends Error {}

/**
 * Returns a required element, reporting website markup changes as collection failures.
 * @param {Element|Document} parent Search root.
 * @param {string} selector CSS selector.
 * @returns {Element} Matching element.
 */
function required(parent, selector) {
  const element = parent?.querySelector(selector);
  if (!element) {
    throw new CollectError(`Required element not found: ${selector}`);
  }
  return element;
}

/**
 * Reads a required amount using SDK parsing and rejects currencies outside the demo's EUR accounts.
 * @param {Element} element Element containing a single monetary amount.
 * @returns {number} Amount in euros.
 */
function euroAmount(element) {
  const value = CollectorUtils.elementToAmount(element, "fr-FR");
  if (value.currencyCode !== "EUR") {
    throw new CollectError("starter.history.invalid");
  }
  return value.amount;
}

/**
 * Java starter conversion: signs in, synchronizes accounts and subscription, then
 * collects history oldest first. Previous UUIDs and synchronization choices are preserved.
 */
export default class StarterCollector {
  /**
   * Receives host services, configuration and copied previous results.
   * @param {Object} context SDK CollectorContext.
   */
  initialize(context) {
    this.context = context;
    this.sdkVersion = context.sdkVersion;
    this.counterpartyUuid = CollectorUtils.nameUUIDFromString("tibu:maison-demo");
    this.settings = context.settings;
    this.accounts = context.previousAccounts;
    this.recurringPayments = context.previousRecurringPayments;
    this.transactions = [];
    this.configuration = context.configuration;
    this.subscriptionInvoices = [];
    this.progress = 0;
    this.stopped = false;
    this.minIntervalBetweenRequestInMs = 200;
    this.lastRequestTime = null;
    this.currentUrl = null;
  }

  /**
   * Checks required credentials using the Java starter's field and message keys.
   * @returns {Array<Object>} Configuration error messages.
   */
  validate() {
    return ["login", "password"]
      .filter(field => typeof this.configuration[field] !== "string" || this.configuration[field].trim() === "")
      .map(field => ({ type: "ERROR", fieldName: field, messageKey: `form.error.${field}.required`, messageArguments: [] }));
  }

  /**
   * Records the host's cooperative stop request; complete at least one transaction.
   */
  stop() {
    this.stopped = true;
  }

  /**
   * Honors stop only after this run has produced useful completed work, as in Java.
   * @returns {boolean} Whether subsequent requests should stop.
   */
  mustStop() {
    return (this.stopped || this.context.isStopRequested()) && this.transactions.length > 0;
  }

  /**
   * Connects and collects; an interruption leaves completed transactions and progress intact.
   * @returns {Promise<boolean>} True when finished; false when another run is needed.
   */
  async collect() {
    try {
      await this.signIn();
      await this.synchronizeAccounts();
      await this.synchronizeRecurringPayments();
      return await this.synchronizeTransactions();
    } catch (error) {
      if (error instanceof MustStop) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Resolves the demo site's absolute or root-relative resource paths without a browser URL API.
   * @param {string} path Website path or absolute URL.
   * @returns {string} Absolute URL; the native provider enforces host permissions.
   */
  fullURL(path) {
    return /^https?:\/\//i.test(path) ? path : `${DOMAIN}/${path.replace(/^\//, "")}`;
  }

  /**
   * Applies cooperative stop and nonblocking host throttling before each network request.
   */
  async beforeRequest() {
    if (this.mustStop()) {
      throw new MustStop();
    }
    if (this.lastRequestTime !== null) {
      const remaining = this.minIntervalBetweenRequestInMs - (Date.now() - this.lastRequestTime);
      if (remaining > 0) {
        await CollectorUtils.sleep(remaining);
      }
    }
    if (this.mustStop()) {
      throw new MustStop();
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Prepares navigation headers and preserves the previous response's location as Referer.
   * @returns {Object<string,string>} Request headers.
   */
  headers() {
    const headers = {
      "User-Agent": this.settings["user-agent"] ?? "Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "fr-FR,fr;q=1",
      "Sec-GPC": "1",
      Connection: "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      Priority: "u=0, i",
      Pragma: "no-cache",
      "Cache-Control": "no-cache"
    };
    if (this.currentUrl !== null) {
      headers.Referer = this.currentUrl;
    }
    return headers;
  }

  /**
   * Fetches HTML through the injected provider, preserving native cookies and domain checks.
   * @param {string} path Website path.
   * @param {?Object<string,string>} [fields=null] Optional form body.
   * @returns {Promise<Document>} Parsed response document.
   */
  async page(path, fields = null) {
    await this.beforeRequest();
    const url = this.fullURL(path);
    const provider = this.context.internetProvider;
    const response = fields === null
      ? await provider.get(url, this.headers())
      : await provider.post(url, CollectorUtils.encodeForm(fields), "application/x-www-form-urlencoded; charset=UTF-8", this.headers());
    if (!response || response.code !== 200) {
      throw new TemporaryUnavailable(response ? `HTTP error ${response.code} for ${path}` : `Empty response for ${path}`);
    }
    this.currentUrl = response.location ?? url;
    return parseHTML(response.body).document;
  }

  /**
   * Includes the form CSRF token and only explicitly selected values, avoiding unchecked inputs.
   * @param {Document} document Current page.
   * @param {string} inputName Field identifying the form.
   * @param {Object<string,string>} values Submitted values.
   * @returns {Promise<Document>} Result page.
   */
  async submitForm(document, inputName, values) {
    const form = required(document, `form:has(input[name=${inputName}])`);
    const csrf = required(form, "input[name=csrf]").getAttribute("value") ?? "";
    return this.page(form.getAttribute("action"), { ...values, csrf });
  }

  /**
   * Reuses the current session or completes login and optional SMS OTP authentication.
   */
  async signIn() {
    let home = await this.page("/fr/compte");
    if (!home.querySelector(".account-heading")) {
      const fields = { login: this.configuration.login, password: this.configuration.password };
      if (this.configuration.withOtp) {
        fields.with_otp = "1";
      }
      home = await this.submitForm(home, "login", fields);
      if (home.querySelector("input[name=otp]")) {
        const provider = this.context.otpProvider;
        if (!provider) {
          throw new AccessDeny("error.otp.no_provider");
        }
        const code = await provider.getCode(provider.Channel.SMS, "Maison démo", provider.PATTERN_4_DIGIT, "starter.otp.prompt");
        if (code === null) {
          throw new AccessDeny("error.otp.no_code");
        }
        home = await this.submitForm(home, "otp", { otp: code });
        if (!home.querySelector(".account-heading")) {
          throw new AccessDeny("error.otp.code_refused");
        }
      } else if (!home.querySelector(".account-heading")) {
        throw new AccessDeny("error.login.fail");
      }
    }
    this.customerAccountHomePage = home;
    this.configurationName = `Maison démo (${CollectorUtils.maskEmail(this.configuration.login)})`;
    this.configurationIdHash = CollectorUtils.hash(this.configuration.login);
  }

  /**
   * Finds or creates a website account without replacing an existing UUID or user options.
   * @param {string} id Stable website reference.
   * @param {string} type Account enum value.
   * @param {string} currencyCode Currency or POINTS.
   * @param {number} balance Current balance.
   * @returns {Promise<Object>} Account DTO.
   */
  async synchronizeAccount(id, type, currencyCode, balance) {
    let account = this.accounts.find(candidate => candidate.id === id);
    if (!account) {
      account = {
        id, uuid: await CollectorUtils.randomUUID(), type, label: "Maison démo",
        counterpartyUuid: this.counterpartyUuid, currencyCode, timeZoneId: TIME_ZONE,
        currentBalance: balance, lastUpdate: null, metadatas: {}, paymentMethods: [], syncEnabled: true
      };
      this.accounts.push(account);
    }
    if (account.syncEnabled) {
      Object.assign(account, { type, label: "Maison démo", currencyCode, timeZoneId: TIME_ZONE, currentBalance: balance });
    }
    return account;
  }

  /**
   * Refreshes the shopping and loyalty accounts and the loyalty card metadata.
   */
  async synchronizeAccounts() {
    await this.synchronizeAccount(this.configuration.login, "SHOPPING", "EUR", 0);
    const loyalty = required(this.customerAccountHomePage, ".loyalty");
    const points = required(loyalty, "progress").getAttribute("value");
    if (!/^\d+$/.test(points)) {
      throw new CollectError("starter.history.invalid");
    }
    const cardNumber = CollectorUtils.elementToText(required(loyalty, "figcaption"));
    const account = await this.synchronizeAccount(cardNumber, "LOYALTY_CARD", "POINTS", Number(points));
    if (account.syncEnabled) {
      account.metadatas = {
        ...account.metadatas,
        "tibu:loyalty_card_reference": cardNumber,
        "tibu:loyalty_card_barcode_type": "CODE_128",
        "tibu:loyalty_card_bg_color": "#FFFFFF"
      };
    }
  }

  /**
   * Updates the demo site's single subscription and preserves its UUID and account linkage.
   */
  async synchronizeRecurringPayments() {
    this.subscriptionInvoices = [];
    const account = this.accounts.find(candidate => candidate.id === this.configuration.login);
    if (!account.syncEnabled) {
      return;
    }
    let plan = this.recurringPayments[0];
    if (!plan) {
      plan = {
        id: SUBSCRIPTION_ID, uuid: await CollectorUtils.randomUUID(), accountUuid: account.uuid,
        dateEnd: null, dateStart: null, resumeDate: null, files: [], items: []
      };
      this.recurringPayments.push(plan);
    } else if (plan.accountUuid !== account.uuid) {
      throw new CollectError("error.recurring_payments.wrong_account");
    }
    const subscription = required(this.customerAccountHomePage, ".subscription");
    Object.assign(plan, {
      label: "Maison Plus", expectedAmount: -euroAmount(required(subscription, "h2 small")),
      acceptableAmountVariationRatio: 0, recurrenceInterval: 1, recurrenceUnit: "MONTH", state: "ACTIVE"
    });
  }

  /**
   * Restores the Java-compatible checkpoint containing the last date and completed references.
   * @returns {Object} Mutable checkpoint.
   */
  loadProgress() {
    const saved = this.settings[PROGRESS_KEY];
    return saved === undefined ? { lastTransactionDate: null, transactionReferences: [] } : JSON.parse(saved);
  }

  /**
   * Saves only complete transactions and keeps sorted references for the checkpoint's date.
   * @param {Object} progress Mutable checkpoint.
   * @param {Object} pending Completed history reference.
   */
  saveProgress(progress, pending) {
    if (progress.lastTransactionDate !== pending.date) {
      progress.lastTransactionDate = pending.date;
      progress.transactionReferences = [];
    }
    progress.transactionReferences = [...new Set([...progress.transactionReferences, pending.id])].sort();
    this.settings[PROGRESS_KEY] = JSON.stringify(progress);
  }

  /**
   * Processes each page oldest first and advances the checkpoint only after complete details.
   * @returns {Promise<boolean>} Whether collection finished without a stop request.
   */
  async synchronizeTransactions() {
    const account = this.accounts.find(candidate => candidate.type === "SHOPPING");
    if (!account) {
      throw new CollectError("No account to synchronize?");
    }
    if (!account.syncEnabled) {
      return true;
    }
    const progress = this.loadProgress();
    const fromDate = progress.lastTransactionDate;
    let previousDate = null;
    let nextPage = null;
    do {
      const page = await this.readTransactionPage(account, fromDate, nextPage);
      for (const pending of page.transactions) {
        if (previousDate !== null && pending.date < previousDate) {
          throw new CollectError("Transaction pages must be ordered from oldest to newest.");
        }
        previousDate = pending.date;
        if (progress.lastTransactionDate !== null && (
          pending.date < progress.lastTransactionDate ||
          (pending.date === progress.lastTransactionDate && progress.transactionReferences.includes(pending.id))
        )) {
          continue;
        }
        const transaction = await this.collectTransaction(account, pending);
        if (transaction === null) {
          return false;
        }
        this.transactions.push(transaction);
        this.saveProgress(progress, pending);
      }
      nextPage = page.nextPage;
    } while (nextPage !== null);
    return !this.mustStop();
  }

  /**
   * Extracts a dated website reference, rejecting malformed ISO dates before checkpointing.
   * @param {Element} element Order or invoice article.
   * @param {string} attribute Stable reference attribute.
   * @returns {Object} Reference, local date and HTML details.
   */
  pendingTransaction(element, attribute) {
    const date = required(element, "time[datetime]").getAttribute("datetime");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw new CollectError("starter.history.invalid");
    }
    return { id: element.getAttribute(attribute), date, details: element };
  }

  /**
   * Reads descending website pages in reverse order and merges subscription invoices by date.
   * @param {Object} account Shopping account.
   * @param {?string} fromDate Last completed local date.
   * @param {?string} nextPage Next page token.
   * @returns {Promise<Object>} Chronologically sorted references and next token.
   */
  async readTransactionPage(account, fromDate, nextPage) {
    let pageNumber;
    if (nextPage === null) {
      this.previousPageEndDate = null;
      const numbers = [...this.customerAccountHomePage.querySelectorAll(".pagination a")].map(link => Number(CollectorUtils.elementToText(link)));
      if (numbers.length === 0 || numbers.some(number => !Number.isInteger(number) || number < 1)) {
        throw new CollectError("starter.history.invalid");
      }
      pageNumber = Math.max(...numbers);
      const invoices = await this.page(required(this.customerAccountHomePage, ".subscription a").getAttribute("href"));
      this.subscriptionInvoices = [...invoices.querySelectorAll("article[data-invoice-id]")]
        .map(invoice => this.pendingTransaction(invoice, "data-invoice-id"));
    } else {
      pageNumber = Number(nextPage);
    }
    const document = await this.page(`/fr/compte?page=${pageNumber}`);
    const references = [...document.querySelectorAll("article[data-order-id]")]
      .map(order => this.pendingTransaction(order, "data-order-id"));
    if (references.length === 0) {
      throw new CollectError("starter.history.invalid");
    }
    const mostRecentDate = references.map(reference => reference.date).sort().at(-1);
    for (const invoice of this.subscriptionInvoices) {
      if ((this.previousPageEndDate === null || invoice.date > this.previousPageEndDate) && (pageNumber === 1 || invoice.date <= mostRecentDate)) {
        references.push(invoice);
      }
    }
    this.previousPageEndDate = mostRecentDate;
    const transactions = references.filter(reference => fromDate === null || reference.date >= fromDate);
    transactions.sort((left, right) => {
      const leftKey = `${left.date}\u0000${left.id}`;
      const rightKey = `${right.date}\u0000${right.id}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    return { transactions, nextPage: pageNumber > 1 ? String(pageNumber - 1) : null };
  }

  /**
   * Downloads a granted file and retains stop requests until the current transaction is complete.
   * @param {string} path Resource path.
   * @param {string} type File enum value.
   * @param {string} label File label.
   * @param {string} contentType Expected content type.
   * @returns {Promise<Object>} File DTO containing an execution-scoped capability.
   */
  async downloadAttachment(path, type, label, contentType) {
    await this.beforeRequest();
    const response = await this.context.internetProvider.downloadFile(this.fullURL(path), this.headers(), contentType);
    if (!response || response.code < 200 || response.code >= 300 || !response.body?.startsWith("tibu-file:")) {
      throw new CollectError(`Cannot download file '${label}'`);
    }
    return { type, label, contentType, file: response.body };
  }

  /**
   * Completes an order or subscription invoice, including items, photos and invoice files.
   * Dates use the account's time zone via the native host rather than the device's default zone.
   * @param {Object} account Shopping account.
   * @param {Object} pending Dated history reference.
   * @returns {Promise<Object>} Complete transaction DTO.
   */
  async collectTransaction(account, pending) {
    const details = pending.details;
    const subscription = details.hasAttribute("data-invoice-id");
    const date = await CollectorUtils.startOfDay(pending.date, TIME_ZONE);
    const label = CollectorUtils.elementToText(required(details, "h2,h3"));
    const transaction = {
      id: pending.id, accountUuid: account.uuid, type: "PURCHASE", state: "COMPLETED",
      dateTransaction: date, dateValue: date, label, labelOriginal: label, details: label,
      amount: -euroAmount(required(details, ".order-footer > strong")), currencyCode: "EUR",
      counterpartyUuid: this.counterpartyUuid, recurrentPaymentUuid: null, locationInfos: null,
      metadatas: {}, payments: [], files: [], items: []
    };
    if (subscription) {
      transaction.recurrentPaymentUuid = this.recurringPayments.find(plan => plan.id === SUBSCRIPTION_ID).uuid;
      transaction.items.push({ label: "Maison Plus", price: -transaction.amount, quantity: 1, quantityUnit: "MONTH", files: [], references: {} });
    } else {
      const states = { paid: "COMPLETED", pending: "PENDING", cancelled: "DELETED" };
      transaction.state = states[details.getAttribute("data-status")];
      if (!transaction.state) {
        throw new CollectError("starter.history.invalid");
      }
      for (const itemElement of details.querySelectorAll(".items > li")) {
        const quantity = CollectorUtils.elementToInteger(itemElement.querySelector(".item-name .muted"));
        if (!Number.isInteger(quantity) || quantity <= 0) {
          throw new CollectError("starter.history.invalid");
        }
        const item = {
          label: CollectorUtils.elementToText(required(itemElement, ".item-name strong")), price: euroAmount(required(itemElement, "li > strong")),
          quantity, quantityUnit: "UNIT", brand: null, url: null, files: [], references: {}
        };
        const image = itemElement.querySelector("img");
        if (image) {
          item.files.push(await this.downloadAttachment(image.getAttribute("src"), "IMAGE", item.label, "image/jpeg"));
        }
        transaction.items.push(item);
      }
    }
    const invoice = details.querySelector("a.invoice");
    if (invoice) {
      transaction.files.push(await this.downloadAttachment(invoice.getAttribute("href"), "INVOICE", pending.id, "application/pdf"));
    }
    return transaction;
  }
}
