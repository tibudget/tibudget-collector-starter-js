# JavaScript collector host bridge

## Scope

The bridge implements the provider interfaces and collection data contract from `tibudget-api` in a QuickJS runtime. JavaScript uses plain objects and arrays, not Java objects or reflection. All provider methods return Promises, including methods that are synchronous in the Java API. Blocking provider operations run on the host IO dispatcher.

The bridge is available after a collector source is loaded and initialized. It does not install ZIP packages, parse manifests, resolve input defaults or implement the JavaScript configuration definition reader. Those remain separate from runtime execution.

## Entry point and initialization

`main.js` must default-export a class or object implementing `initialize(context)` and `collect()`. A class is instantiated without constructor arguments. `initialize` is the JavaScript equivalent of the Java API's `init` plus the configuration previously injected through annotated fields.

```javascript
import { AccessDeny } from "tibu";

export default class StarterCollector {
  initialize(context) {
    this.configuration = context.configuration;
    this.internetProvider = context.internetProvider;
    this.counterpartyProvider = context.counterpartyProvider;
    this.otpProvider = context.otpProvider;
    this.pdfToolsProvider = context.pdfToolsProvider;
    this.settings = context.settings;
    this.accounts = context.previousAccounts;
    this.recurringPayments = context.previousRecurringPayments;
    this.transactions = [];
    this.progress = 0;
  }

  validate() {
    if (!this.configuration.login) {
      return [{
        type: "ERROR",
        fieldName: "login",
        messageKey: "form.error.login.required",
        messageArguments: []
      }];
    }
    return [];
  }

  async collect() {
    const response = await this.internetProvider.get("https://tests.tibudget.com/", null);
    if (response.code === 401) {
      throw new AccessDeny("error.login.fail");
    }
    // Implement the website-specific collection here.
    this.progress = 100;
    return true;
  }
}
```

The initialization object contains:

| Property | JavaScript representation |
| --- | --- |
| `configuration` | Object containing the saved input values, keyed by manifest input names. |
| `internetProvider` | Async HTTP and download methods described below. |
| `counterpartyProvider` | Async `find` method supporting string or numeric values. |
| `otpProvider` | Async code retrieval plus channel and pattern constants. |
| `pdfToolsProvider` | Async text extraction for granted file references. |
| `settings` | Mutable object containing persisted string-to-string state. |
| `previousAccounts` | Array of account DTO objects, including user labels and `syncEnabled`. |
| `previousRecurringPayments` | Array of recurring payment DTO objects. |
| `isStopRequested` | Synchronous function returning the host's cooperative stop flag. |

Data is copied across the JSON boundary. Mutating `settings` or DTOs in JavaScript does not mutate the original Kotlin objects immediately; the bridge imports a fresh snapshot after successful lifecycle methods. Manifest default resolution must happen before these values are supplied to the bridge.

## InternetProvider

The Java argument order is preserved:

```javascript
const response = await internetProvider.get(url, headers = null);
const response = await internetProvider.post(url, body, contentType, headers = null);
const response = await internetProvider.downloadFile(url, headers = null, forceContentType = null);
const response = await internetProvider.downloadFile(url, headers, forceContentType, body, bodyContentType);
```

Headers are objects whose values are strings. POST payloads and content types are strings. The download method selects the Java GET or POST overload according to whether the final two arguments are supplied.

Responses have the same fields as `InternetProvider.Response`:

```javascript
{
  code: 200,
  message: "OK",
  method: "GET",
  location: "https://tests.tibudget.com/",
  protocol: "HTTP/2",
  body: "response text",
  headers: { "Content-Type": "text/html" }
}
```

HTTP error status codes remain response data; the collector decides whether they indicate an authentication rejection, retry condition or another error. Provider exceptions reject the Promise. Requests still use the host-supplied provider, including its domain whitelist, cookies, authentication and existing request handling. The bridge adds no direct `fetch`, sockets or filesystem APIs.

For a successful download, `body` contains an opaque `tibu-file:...` reference rather than the original host path. Non-successful download responses keep their original response body.

## CounterpartyProvider

```javascript
const counterpartyUuid = await counterpartyProvider.find("tibu:id:fr:siret", "00123456789012");
const counterpartyUuid = await counterpartyProvider.find("custom:numeric-key", 42.5);
```

A string invokes `find(String, String)`; a number invokes `find(String, Double)`. Leading zeros in identifiers therefore require a string. Results are UUID strings or `null`. Metadata validity and uniqueness checks remain the responsibility of the supplied provider, exactly as in the Java API.

## OTPProvider

```javascript
const code = await otpProvider.getCode(
  otpProvider.Channel.EMAIL,
  "Example",
  otpProvider.PATTERN_6_DIGIT,
  "Enter the code sent by email"
);
```

Channels are `"SMS"`, `"EMAIL"` and `"TOTP"`. `PATTERN_4_DIGIT` and `PATTERN_6_DIGIT` contain the Java API's regex strings. Keyword, pattern and prompt may be `null`. The result is a string or `null`, preserving the provider's behavior when no code is available.

## PDFToolsProvider and files

```javascript
const invoice = await internetProvider.downloadFile(invoiceUrl, null, "application/pdf");
const invoiceText = await pdfToolsProvider.extractText(invoice.body);
```

A granted file can also appear in a returned file DTO:

```javascript
this.transactions[0].files = [{
  type: "INVOICE",
  label: "Invoice",
  contentType: "application/pdf",
  file: invoice.body
}];
```

The bridge resolves the reference back to the host `File` when decoding the DTO. File objects already supplied in host DTOs are also converted into granted references. Arbitrary paths, guessed references and references from another execution are rejected before invoking the PDF provider.

References last only for the current execution. Do not persist them in settings for reuse in a later run. The bridge does not currently resolve file-picker URI strings stored in configuration; package/input resource handling must grant such files separately before they can be used by this API.

## DTO representation

Use the field names defined in `tibudget-api`: for example `accountUuid`, `dateTransaction`, `dateValue`, `currencyCode`, `metadatas`, `recurrentPaymentUuid`, `items`, `payments` and `files`.

- Dates are integer Unix epoch milliseconds. Use `date.getTime()` when starting from a JavaScript `Date`; ISO strings are not accepted for Java `Date` DTO fields.
- Enums are exact Java enum constant names, such as `"PURCHASE"`, `"COMPLETED"`, `"SHOPPING"` and `"UNIT"`. Unknown enum names are rejected.
- Collections are arrays, and metadata maps are objects. File fields contain granted reference strings.
- Settings values must all be strings. Serialize structured checkpoints explicitly with `JSON.stringify` and restore them with `JSON.parse`.
- DTOs are data, not Java class instances. Java constructor helpers and business validation are not synthesized by this bridge. Supply the identifiers and required fields documented by the API, and preserve existing account UUIDs, user labels and synchronization flags.

## Lifecycle and exported state

`initialize(context)` and `collect()` are required and may be async. Optional `validate()` may be async and must return an array of message DTO objects. If absent it returns `[]`. Every message needs a valid `type` and a nonempty `messageKey`; `fieldName` may be null and omitted `messageArguments` becomes `[]`.

`collect()` must return a boolean: `true` means finished, `false` means another run is needed. An omitted return is an error, not an empty successful collection.

Result getters mirror the Java API and must be synchronous. As a convenience, the corresponding plain property can be used when the getter is absent:

| Java-style getter | Property | Default |
| --- | --- | --- |
| `getAccounts()` | `accounts` | `[]` |
| `getRecurringPayments()` | `recurringPayments` | `[]` |
| `getTransactions()` | `transactions` | `[]` |
| `getSettings()` | `settings` | Initialization settings |
| `getConfigurationName()` | `configurationName` | `null` |
| `getConfigurationIdHash()` | `configurationIdHash` | `null` |
| `getProgress()` | `progress` | `0` |
| `getOpenIdJSONConfiguration()` | `openIdJSONConfiguration` | `null` |
| `getDatadomeClientId()` | `datadomeClientId` | `null` |

The bridge caches these values after successful lifecycle calls. Kotlin getters read the last completed snapshot and do not enter QuickJS concurrently. Progress must be an integer from 0 to 100. Live progress streaming is not part of this bridge.

An optional `initConnection(uri)` receives the full callback URI as a string and must return the configuration title, synchronously or asynchronously. The JavaScript executor exposes this operation; routing UI authentication callbacks to it remains separate from the bridge itself.

## Errors

The `tibu` ES module exports the Java API's error categories:

```javascript
import {
  CollectError,
  AccessDeny,
  ConnectionFailure,
  TemporaryUnavailable,
  ParameterError
} from "tibu";

throw new AccessDeny("error.login.fail");
throw new TemporaryUnavailable("error.maintenance", "Example");
throw new ParameterError("login", "form.error.login.required");
```

All errors accept `(messageKey, ...messageArguments)`, except `ParameterError`, which takes `(fieldName, messageKey, ...messageArguments)`. An uncaught error is reconstructed as the corresponding Java exception so existing orchestration retains its failure category and user-facing messages.

Provider rejections expose `name`, `message`, `messageKey`, `fieldName` and `messageArguments` to JavaScript. An Internet provider `IOException` is exposed as `ConnectionFailure`; a PDF processing `IOException` is exposed as `CollectError`, preserving the distinction between communication and parsing failures. Ordinary JavaScript programming errors remain internal failures rather than being classified as authentication rejection.

## Cooperative stop and disposal

The host sets a thread-safe stop flag. After an awaited provider call finishes, the bridge invokes the optional collector `stop()` once before returning control to the collector. It also checks the flag after lifecycle calls. Collectors can check `context.isStopRequested()` between their own processing steps.

A collector must finish or discard an incomplete transaction, preserve completed work in its results and settings, and return `false` when more data remains. This is cooperative: synchronous infinite loops still cannot be forcibly interrupted by the pinned QuickJS binding.

Closing the executor cancels native jobs, releases its context and drops its file references. Returned DTO files remain owned by the application; the bridge does not delete them.

## Host-side loading

For an already available source:

```kotlin
val executor = JavaScriptCollectorExecutor()
try {
    executor.loadCollector(mainSource)
    executor.initialize(context)
    val messages = executor.validate()
    // Continue only when validation has no ERROR messages.
    val complete = executor.collect()
    // Read executor.accounts, transactions, settings and other snapshot values.
} finally {
    executor.close()
}
```

The factory also accepts an optional `collectorScriptPath` for the host to supply an existing `main.js`. This is an integration point, not a JavaScript ZIP installer. Additional modules must be registered before loading the entry source, and the package reader is responsible for their paths and dependency order.

## Runtime tools and portable utilities

The shared `tibudget-collector-sdk` now also exports `md5`, `hash`,
`nameUUIDFromString`, `maskEmail` and `encodeForm` through the `tibu` module.
These are the helpers actually required by the Java starter conversion; other Java
collector-utils features have not been ported. Hashes and name-based UUIDs reproduce
Java's UTF-8 behavior and are compatibility identifiers, not authentication primitives.

The collector initialization context includes `runtimeTools`:

```javascript
const uuid = await context.runtimeTools.randomUUID();
const timestamp = await context.runtimeTools.startOfDay("2026-03-30", "Europe/Paris");
await context.runtimeTools.sleep(200);
```

`randomUUID()` obtains a secure native version 4 UUID. `startOfDay()` uses the native
IANA timezone database and returns epoch milliseconds, including daylight-saving rules.
`sleep()` is a cancellable, nonblocking delay of an integer from 0 to 60000 milliseconds.
The JSON host operations are `runtime.randomUUID`, `runtime.startOfDay` and `runtime.sleep`.
They follow the same result/error envelopes and cooperative stop checks as providers.
These methods avoid assuming Web Crypto, Intl or browser timers exist in QuickJS.
Android implements them; simulator and iOS implementations must implement the same contract.
