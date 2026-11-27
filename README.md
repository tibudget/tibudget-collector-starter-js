# Tibu JavaScript Collector Starter

JavaScript skeleton of the Java `tibudget-collector-starter` project for the [Maison démo test website](https://tests.tibudget.com).

This project provides collector metadata, configuration fields, message resources and ZIP packaging. Its collector implements the Java starter flow: login and optional SMS OTP, shopping and loyalty accounts, a subscription, oldest-first history, attachment downloads and resumable checkpoints.

## Requirements

- Node.js 22 or newer and npm.
- The `zip` command for collector packaging.

Node.js is a development tool here. The collector runs in Tibu's JavaScript engine. The SDK development dependency includes LinkeDOM for local tests; Android supplies the `tibu` module, including DOM parsing, at runtime.

## Getting started

```sh
npm ci
npm run check
npm test
npm run docs
npm run build
```

`npm run check` checks JavaScript syntax; it is not a collector behavior test or a full manifest validator.

`npm run build` checks syntax, synchronizes `version` and `author` in the source `manifest.json` from `package.json`, and creates `dist/collector-starter-js.zip` using that updated manifest. The ZIP contains these entries directly at its root:

```text
main.js
manifest.json
logo.png
_locales/
  en/
    messages.json
```

`npm pack` is also available as a standard npm operation, but produces an npm `.tgz` package, not the collector ZIP.

## Files

- `main.js`: Java starter conversion using the shared SDK and LinkeDOM, with JSDoc on lifecycle and website methods.
- `manifest.json`: collector version, author, default locale, host permissions and form declarations.
- `logo.png`: original Java starter logo.
- `_locales/en/messages.json`: all original Java message keys and values, converted to a flat JSON object.
- [`docs/collector-package-format.md`](docs/collector-package-format.md): ZIP layout, required files and formats, manifest properties, configuration inputs, translations and logo.
- `scripts/build.mjs`: development-only ZIP packaging, never included in the collector archive.

Read [AGENTS.md](AGENTS.md) before changing the project. The local specification is a snapshot and should be kept aligned with the Android project when the contract changes.

## Configuration inherited from Java

| Input | Type | Required | Default |
| --- | --- | --- | --- |
| `login` | `STRING` | Yes | Unset |
| `password` | `STRING`, masked | Yes | Unset |
| `withOtp` | `BOOLEAN` | No | `false` |

The domain permission remains `tests.tibudget.com`, matching the Java starter. Labels, descriptions, validation messages and other text retain their original message keys. Add translations at `_locales/<locale>/messages.json`.

The manifest's `default_locale` is `en`. The source Java starter currently provides English messages only; this skeleton does not invent additional translations.

## Shared SDK import

The npm development dependency `"tibu": "npm:@tibudget/collector-sdk@0.1.0"` installs
the published SDK under the module name used by collectors. No sibling SDK checkout is required:

```javascript
import { AccessDeny, CollectError, CollectorUtils } from "tibu";
```

At runtime Android registers `tibu` itself,
so the collector ZIP does not include the SDK, Node.js or `node_modules`. DOM parsing is provided through the SDK exports. The shared runtime is used by the local integration test,
while collector code imports error classes and the public `CollectorUtils` class.

`npm test` loads the actual `main.js` with the SDK runtime and fake host services.
It replays all 78 recorded HTTP operations from the Java starter and compares accounts,
recurring payments, transactions, amounts, zoned dates and attachment bytes with Java's
saved expected result. Additional tests cover OTP, CSRF, validation, stop, disabled accounts,
chronological ordering and checkpoint resume. These tests make no network requests. During conversion, the complete 78-operation replay was
also verified in Android's real QuickJS engine, including DTO decoding and native zoned dates.

After changing the sibling SDK, run `npm ci` again to refresh its installed local copy.

## Runtime requirements

The host must register the execution-bound `CollectorUtils` class from the SDK runtime.
The collector awaits `CollectorUtils.randomUUID()`, `CollectorUtils.startOfDay(date, timeZoneId)`
and `CollectorUtils.sleep(milliseconds)` for new identities, zoned dates and request throttling.
It uses the SDK's text, integer, amount, hashing, email masking and form encoding helpers.
The demo accepts EUR amounts; other detected currencies are rejected rather than relabeled.
Provider failures propagate with their original SDK error category.

The integration tests register these bound exports in an isolated Node module using
`node:vm`, with the experimental VM modules flag. They exercise the existing SDK runtime
without modifying global utility bindings. Node tests alone do not establish compatibility
with the target engine; the changes must also be verified in the host's QuickJS engine.
See the sibling SDK's `docs/collector-agent-guide.md` for collector development rules.

New accounts and subscriptions receive fresh native UUIDs; previous UUIDs, synchronization
flags and custom fields are preserved. Dates are local calendar dates until the host converts
them using `Europe/Paris`. Settings use the Java `tibu.collect.progress` checkpoint format.
The 200 ms minimum request interval can be set to zero on the initialized collector for replay.

The manifest, messages and ZIP layout retain the Java starter's configuration and resource keys.
Package installation and end-to-end UI execution in Android remain separate from this conversion.

See the SDK README for `export default`, lifecycle order and host responsibilities.

## License

CC0-1.0, preserving the Java starter's license. See [LICENSE](LICENSE).
