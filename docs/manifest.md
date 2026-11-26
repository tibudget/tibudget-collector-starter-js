# JavaScript collector manifest specification

## Status and scope

This document defines version 1 of the JavaScript collector package manifest. It is the contract to implement for JavaScript collectors, not a description of an available JavaScript runtime or installer.

The Android application already has a shared `CollectorDefinition` / `CollectorInput` model and a Java adapter that reads `@Input` annotations. The JavaScript definition provider is currently a placeholder. Manifest parsing, ZIP installation and JavaScript execution are not implemented yet.

The manifest describes configuration fields and presentation resources without executing collector code. It does not define the JavaScript execution lifecycle, the HTTP/OTP/PDF SDK, publication signatures or the account/transaction DTO schemas.

The terms **MUST**, **MUST NOT**, **SHOULD** and **MAY** indicate requirements, recommendations and optional behavior for the future implementation.

## Package layout

A collector is distributed as a ZIP with the following fixed layout. The ZIP MUST contain these entries directly, without an enclosing `collector-amazon/` directory:

```text
collector-amazon.zip
├── main.js
├── manifest.json
├── icon.png
└── _locales/
    ├── en/
    │   └── messages.json
    └── fr/
        └── messages.json
```

The fixed locations are:

| Entry | Meaning |
| --- | --- |
| `manifest.json` | Package manifest, read before executing any code. |
| `main.js` | JavaScript entry module. |
| `icon.png` | Collector logo, in PNG format. |
| `_locales/<locale>/messages.json` | Translations for one locale, using the known Java collector message keys. |

The manifest, entry module, logo and default-locale message file MUST exist. Additional locale directories are optional. JavaScript modules or other supporting files MAY also be included, but do not change these fixed entry locations.

All JSON and JavaScript files MUST use UTF-8. JSON MUST NOT contain comments, duplicate object keys or trailing commas. Package entries MUST remain inside the ZIP root, use `/` separators and MUST NOT contain absolute paths or `..` path segments.

The technology is inferred from this package format and its `main.js` entry point. There is no `technology`, `entryPoint`, `resources`, `uuid` or configurable logo/message path in the manifest. The archive filename is descriptive, not the collector's identity; the UUID remains part of the catalog and installation metadata.

## Manifest structure

| Property | Type | Required | Meaning |
| --- | --- | --- | --- |
| `manifest_version` | Integer | Yes | MUST be `1` for this specification. |
| `version` | String | Yes | Nonempty collector release version, identical to the catalog version. This specification does not define version ordering. |
| `author` | String | Yes | Nonempty package author name. |
| `default_locale` | String | Yes | Fallback locale, with a corresponding `_locales/<locale>/messages.json` file. |
| `host_permissions` | Array of strings | Yes | Hostnames the collector may access through Tibu's network SDK. Use `[]` when no network access is needed. |
| `inputs` | Array | Yes | Field declarations. Use `[]` when there is no configuration form. |

Locale identifiers use language tags such as `en`, `fr` or `fr-CA`. Directory names MUST match the declared tags exactly. Locale tags MUST NOT contain path separators or traversal segments.

Host permissions are plain hostnames, for example `tests.tibudget.com`. They MUST NOT contain a scheme, port, path, credentials or wildcard. Names are compared case-insensitively and duplicates are invalid. Permissions match the exact host: `tibudget.com` does not authorize `cdn.tibudget.com`. A network request MUST be rejected if its destination host is absent from the list, including a redirect destination. This does not provide a direct networking API to the script: requests still pass through Tibu's host SDK and domain checks.

A reader MUST reject unsupported manifest versions, unknown properties and invalid field declarations before activating the package. New properties or changed semantics require an updated specification and a compatible reader.

The JavaScript reader maps `manifest_version` to the internal `CollectorDefinition.schemaVersion`, infers `CollectorTechnology.JAVASCRIPT`, and maps `host_permissions` to the common allowed-domain metadata. It produces the same common field model as the Java annotation reader. JavaScript packages MUST NOT declare Java classes, annotations or reflection metadata.

### Minimal manifest

```json
{
  "manifest_version": 1,
  "version": "1.0.0",
  "author": "John Doe",
  "default_locale": "en",
  "host_permissions": ["tests.tibudget.com", "cdn.tibudget.com"],
  "inputs": [
    {
      "name": "login",
      "type": "STRING",
      "maxLength": 254,
      "order": 1
    },
    {
      "name": "password",
      "type": "STRING",
      "password": true,
      "order": 2
    }
  ]
}
```

## Input declaration

Each object in `inputs` describes one configurable value. Labels and helper text are resolved from fixed message keys, not declared in the manifest.

| Property | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | String | Required | Stable configuration key, unique within the manifest. |
| `type` | String | Required | One of the types listed below; names are case-sensitive. |
| `defaultValue` | Type-dependent or `null` | `null` | Initial value used only when no saved value exists. |
| `required` | Boolean | `true` | Whether an active field requires a value. |
| `size` | Integer | `-1` | Preferred text width in characters; a presentation hint, not a limit. |
| `maxLength` | Integer | `-1` | Maximum length for a `STRING`; `-1` means unspecified. |
| `order` | Integer | `-1` | Ascending display order. Ties retain declaration order. |
| `password` | Boolean | `false` | Masks a `STRING` field; does not itself encrypt its contents. |
| `fieldset` | String | `""` | Group identifier used by visibility rules. Empty means ungrouped. |
| `hideFieldset` | Array of strings | `[]` | Groups hidden when this boolean field is `true`. |
| `showFieldset` | Array of strings | `[]` | Groups hidden when this boolean field is `false`. |
| `choices` | Array of strings | `[]` | Allowed stable identifiers for a `CHOICE` field. |

Names MUST match `[A-Za-z_][A-Za-z0-9_]*`. Renaming a field changes its saved configuration key; names SHOULD remain stable across releases.

`size` MUST be `-1` or a positive integer. `maxLength` MUST be `-1` or a nonnegative integer. `order` MUST be an integer. A field's non-null default MUST match its declared type and constraints. Manifest defaults MUST NOT contain real credentials or personal account data.

### Supported types and runtime values

| `type` | Non-null value | Default rules and behavior |
| --- | --- | --- |
| `STRING` | JSON string | Empty strings are allowed as initial values. A required active field MUST contain a nonblank value before collection. |
| `INTEGER` | JSON integer | No fractional values. Version 1 uses the signed 32-bit range, matching the existing Java `int` form field. |
| `BOOLEAN` | JSON boolean | Both `true` and `false` are valid values, including when required. |
| `DATE` | JSON integer | Unix epoch milliseconds representing an instant. No ISO date strings, JavaScript `Date` objects or relative values such as `today`. |
| `CHOICE` | JSON string | Value MUST be an identifier from `choices`. No numeric enum ordinals. |
| `FILE` | JSON string | Opaque file reference supplied by Tibu after user selection. Only a missing or `null` manifest default is allowed. |
| `ACCOUNT` | JSON object | Account selected through Tibu, using the shared account DTO representation. Only a missing or `null` manifest default is allowed. |

`DATE` values MUST be finite safe integers in the supported date range of the host. For a date-only default, authors SHOULD use midnight UTC and document the intended date interpretation. For example, `1767225600000` is `2026-01-01T00:00:00Z`.

`FILE` values are not package resource paths and do not grant arbitrary filesystem access. The collector MUST use the host SDK to consume them. `ACCOUNT` choices come from the host's selectable accounts, not a static list in the manifest. The exact JavaScript SDK representation of account values must be specified with the SDK; this document does not introduce a new account DTO.

`password: true`, a non-default `size`, and a non-default `maxLength` are valid only for `STRING`. A `CHOICE` field MUST declare a nonempty list of unique, nonempty identifiers. Other field types MUST NOT declare nonempty `choices`.

A required field MAY have no default: the form is initially incomplete and the user must fill it in. Readers MUST preserve saved `false`, `0` and optional empty strings instead of replacing them with defaults. Missing values use `defaultValue`; an explicitly saved `null` represents an unset value rather than permission to overwrite it with a default.

### Visibility and fieldsets

Only `BOOLEAN` inputs may declare nonempty `hideFieldset` or `showFieldset` arrays. Referenced groups MUST be nonempty and correspond to at least one input's `fieldset`. A controller MUST NOT target its own group or list the same group in both arrays. Cyclic group dependencies are invalid.

Rules are evaluated as follows:

- A `true` controller hides the groups in `hideFieldset`.
- A `false` controller hides the groups in `showFieldset`.
- An unset controller contributes no hide rule.
- A field is hidden when any controller hides its group. Hide takes precedence over show.
- A hidden field retains its stored value but does not block form submission because it is empty or invalid.
- Rules are evaluated independently of input declaration or display order. Visibility is a presentation rule, not a permission boundary.

The existing Android form uses its established inactive-field presentation. This specification does not require a particular visual treatment or guarantee that inactive fields disappear from the layout.

### Choices and translations

Choice identifiers are stable data values. Their labels are resolved using `form.label.<name>.<choice>` in the message files. For example, a `mode` field with choice `PERSONAL` uses `form.label.mode.PERSONAL`.

If the choice label is absent, the host displays the identifier. If a field label is absent, it displays the field name. Missing tooltip text is omitted. The reader generates the common model's `labelKey` and `tooltipKey` from the field name; these properties are not manifest input options.

## Messages and logo

### Message file format

Each `_locales/<locale>/messages.json` file is a flat JSON object mapping message keys to string values. The keys are identical to those used in Java collectors' `.properties` files; the JavaScript package changes the storage format and location, not the key conventions.

Values are strings directly, not nested objects containing a `message` property. JSON escaping applies: use `\n` for line breaks and `\"` for quotes. Java `.properties` escaping and line continuations do not apply.

| Key | Meaning |
| --- | --- |
| `title` | Localized collector display name. |
| `title.task` | Optional localized collection task title. |
| `description` | Short collector description. |
| `description.long` | Optional detailed collector description. |
| `author` | Optional display author; falls back to manifest `author`. Does not change package author identity. |
| `form.label.<name>` | Configuration field label. |
| `form.tooltip.<name>` | Optional field helper text. |
| `form.label.<name>.<choice>` | Label for a stable choice identifier. |

The default-locale file MUST contain nonempty `title` and `description` values. Names, descriptions and field labels MUST NOT be duplicated as manifest properties. Existing additional Java message keys MAY also be used as flat string keys. Localized author display text is optional; the manifest remains the source of package authorship.

### Locale resolution

For a requested locale, the reader looks for the full language tag, then its base language, then `default_locale`. For example, `fr-CA` tries `_locales/fr-CA/messages.json`, then `_locales/fr/messages.json`, then `_locales/en/messages.json` when the default locale is `en`.

Files override individual keys in that order: the most specific available translation wins, and missing keys fall back to the next available file. An empty translated string is an explicit value, not a missing key. Duplicate locale candidates are evaluated only once. A missing optional locale file is skipped; a present but malformed file is a package validation error.

This is the target behavior for the JavaScript reader, not a claim that the existing embedded Java loader already implements this fallback chain. The reader exposes the resolved messages through the same message lookup contract used by Java collectors.

### Logo

The installer resolves the fixed `icon.png` file into a host-readable image reference used by `CollectorDefinition.logoUrl`. The UI continues to consume the same logo reference abstraction as Java collectors. There is no logo path in the manifest and no localized logo lookup.

## Complete example

```json
{
  "manifest_version": 1,
  "version": "1.0.0",
  "author": "John Doe",
  "default_locale": "en",
  "host_permissions": [
    "tests.tibudget.com",
    "cdn.tibudget.com"
  ],
  "inputs": [
    {
      "name": "online",
      "type": "BOOLEAN",
      "defaultValue": true,
      "order": 1,
      "hideFieldset": [
        "fileImport"
      ],
      "showFieldset": [
        "credentials"
      ]
    },
    {
      "name": "login",
      "type": "STRING",
      "maxLength": 254,
      "order": 2,
      "fieldset": "credentials"
    },
    {
      "name": "password",
      "type": "STRING",
      "password": true,
      "order": 3,
      "fieldset": "credentials"
    },
    {
      "name": "statement",
      "type": "FILE",
      "order": 4,
      "fieldset": "fileImport"
    },
    {
      "name": "mode",
      "type": "CHOICE",
      "defaultValue": "PERSONAL",
      "choices": [
        "PERSONAL",
        "BUSINESS"
      ],
      "order": 5
    },
    {
      "name": "historyMonths",
      "type": "INTEGER",
      "defaultValue": 3,
      "order": 6
    },
    {
      "name": "startDate",
      "type": "DATE",
      "defaultValue": 1767225600000,
      "order": 7
    },
    {
      "name": "settlementAccount",
      "type": "ACCOUNT",
      "required": false,
      "order": 8
    }
  ]
}
```

Example `_locales/en/messages.json`:

```json
{
  "title": "Example collector",
  "title.task": "Collect your transactions",
  "description": "Import transactions from an online account or statement file.",
  "description.long": "Connect to your account or import a statement.\nChoose the period to collect.",
  "form.label.online": "Connect online",
  "form.tooltip.online": "Disable to import a statement instead.",
  "form.label.login": "Login",
  "form.label.password": "Password",
  "form.label.statement": "Statement file",
  "form.label.mode": "Account category",
  "form.label.mode.PERSONAL": "Personal account",
  "form.label.mode.BUSINESS": "Business account",
  "form.label.historyMonths": "History in months",
  "form.label.startDate": "Earliest transaction date",
  "form.label.settlementAccount": "Settlement account"
}
```

Example `_locales/fr/messages.json`, with unspecified keys inherited from English:

```json
{
  "title": "Collecteur exemple",
  "description": "Importez les transactions de votre compte ou d’un relevé.",
  "form.label.login": "Identifiant",
  "form.label.password": "Mot de passe",
  "form.label.mode.PERSONAL": "Compte personnel"
}
```

## Configuration passed to the collector

The configuration is an object keyed by input names. It contains values, not the manifest's field definitions. Defaults and saved values are resolved by the host before validation. The exact function receiving this object will be defined by the JavaScript SDK.

Example values for the online mode, with the optional account left unset:

```json
{
  "online": true,
  "login": "tester@example.com",
  "password": "synthetic-test-password",
  "statement": null,
  "mode": "PERSONAL",
  "historyMonths": 3,
  "startDate": 1767225600000,
  "settlementAccount": null
}
```

The collector MUST perform its own business validation before collection. Manifest validation does not establish that credentials work, a file has the expected format, or an account is eligible. Hidden stale values MUST NOT override the mode selected by the controlling fields. Password values and other credentials MUST NOT be included in logs or diagnostics.

## Mapping from Java inputs

| Java source | Manifest / common field |
| --- | --- |
| Annotated field name | `name` |
| `String` | `type: "STRING"` |
| `int` / `Integer` | `type: "INTEGER"` |
| `boolean` / `Boolean` | `type: "BOOLEAN"` |
| `Date` | `type: "DATE"`, default converted to epoch milliseconds |
| Enum class and constants | `type: "CHOICE"`, constant names in `choices` |
| `File` | `type: "FILE"` |
| `AccountDto` | `type: "ACCOUNT"` |
| Initial field value | `defaultValue`, normalized for the common model |
| `@Input.required` | `required` |
| `@Input.size` | `size` |
| `@Input.maxlen` | `maxLength` |
| `@Input.order` | `order` |
| `@Input.password` | `password` |
| `@Input.fieldset` | `fieldset` |
| `@Input.hideFieldset` | `hideFieldset` |
| `@Input.showFieldset` | `showFieldset` |
| `form.label.<fieldName>` | Same message key; generated internal `labelKey` |
| `form.tooltip.<fieldName>` | Same message key; generated internal `tooltipKey` |

The Java adapter remains responsible for reading Java annotations and converting saved portable values back to Java field types. JavaScript collectors consume the common configuration directly and do not emulate Java getters, setters or annotations.

## Reader implementation checklist

Before enabling JavaScript packages, the reader and form adapter must implement this contract, including validation and value resolution. In particular, the current form's use of fallback defaults for null values must be reconciled with the explicit-null rule above; the JavaScript placeholder does not yet perform that resolution.

The reader must validate the package and manifest, infer the technology, resolve the fixed entry point and image path, load locale JSON files, apply host permissions, produce the shared field descriptions, and report unsupported metadata as an installation or configuration error. A package MUST NOT become runnable merely because its manifest can be parsed.
