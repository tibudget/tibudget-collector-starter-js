# Create a JavaScript collector

Use this guide to adapt the starter with an AI agent. Supply the customer account URL,
a collector name and a destination directory. An npm package name and a seller SIRET
are useful when known.

Read [Implementation rules](how-to-implement-collector.md), [AGENTS.md](../AGENTS.md),
the [package format](collector-package-format.md) and the installed SDK's
`node_modules/tibu/docs/collector-agent-guide.md` before implementing.

The developer signs in locally and checks the meaning of the data. The agent inspects
the site, implements the collector and runs available checks. A successful request or
passing test alone does not establish that the imported data is correct.

## 1. Prepare the project

- Use Node.js 22 or newer, npm and the `zip` command for development.
- Work in the requested destination. If starting from a separate starter checkout,
  copy project sources without `.git`, `node_modules`, `dist`, generated documentation
  or IDE files. Preserve unrelated existing work; do not overwrite a destination blindly.
- Set the project name, description, author and version in `package.json`. Keep the
  published SDK dependency under the runtime alias `tibu`:
  `"tibu": "npm:@tibudget/collector-sdk@0.1.0"`. Update the lockfile with npm.
- Set repository links and remotes to the new collector, or leave them unset when no
  repository exists. Never leave the starter remote as the new collector's publication target.
  Creating a repository, pushing or publishing requires a user request.
- Replace demo metadata, `logo.png`, messages and host permissions with the target
  service's resources. Preserve the license and attribution obligations.
- Keep `main.js`, `manifest.json`, `logo.png` and `_locales/<locale>/messages.json`.
  `package.json` is the source of `version` and `author`: the build writes both into
  the source manifest before archiving it. Do not maintain competing values manually.
- Update the README and collector-specific instructions in `AGENTS.md`. Keep the
  shared guides generic. Remove demo fixtures and tests as their behavior is replaced;
  a passing Maison démo replay is not evidence for a different website.

Install dependencies with `npm ci`. If dependency declarations changed, update the
lockfile with `npm install` first. No sibling SDK checkout is needed.

## 2. Understand the site

- Open the supplied URL. Identify the sign-in page, redirects, form fields, CSRF tokens and authentication requests.
- Identify credentials, OTP or other two-factor authentication, and OpenID. Identify protections such as DataDome,
  Cloudflare, reCAPTCHA and other anti-bot challenges. Distinguish observed behavior from assumptions.
- Give the developer a short initial report: sign-in method, detected protections and unresolved points.
- Check that browser tools allow the developer to sign in and the agent to inspect pages and requests.
  If unavailable, explain how to install or configure suitable tools before continuing browser analysis.
- Let the developer sign in locally. Do not copy passwords, OTP codes or browser session secrets into the conversation,
  source code or saved analysis artifacts. Do not enable persistent browser session storage or network recordings for this analysis.
- Inspect how to detect a valid session, failed sign-in and an expired session.
- Analyze accounts, transactions, pagination, details and documents. Identify stable service IDs,
  date and amount formats, currencies, transaction states and how changed transactions can be found.
- The user may provide a SIRET associated with the customer area. Use it as a starting point to find the counterparty UUID
  through the public API: `https://api.tibudget.com/public/counterparties?fr-siret=12345678901234` (replace the example with the supplied SIRET).
  The supplied SIRET may be incorrect, and one customer area may cover several SIRETs, for example supermarkets or franchises.
  Cross-check the returned counterparty against seller details and SIRETs shown in the customer area and invoices before using its UUID.
  When several sellers are involved, identify the counterparty for each relevant record instead of applying one UUID to the whole customer area.
  If the lookup returns no match or the evidence is ambiguous, report the unresolved match and ask the user for clarification; do not guess a UUID.

Before implementing, explain what the first version will support and what still needs investigation.
Verify OpenID support in the installed JavaScript SDK and target host; do not assume Java API methods or simulator support are available.
Report any limitation and agree on a suitable host test when it applies.

## 3. Implement the observed flow

- A supplied customer area URL may contain an identifier specific to the user's account or session.
  Do not hardcode that identifier or URL in the collector. Start from a generic entry or sign-in URL when available,
  follow the site's redirects and read account-specific URLs or identifiers from the authenticated navigation or responses.
  Verify this flow on the site; do not assume that the supplied URL works for other users.
- Follow the [mandatory rules for unsupported controls](how-to-implement-collector.md#unsupported-controls-mandatory-behavior).
- Replace or remove demo-specific tests as the starter is adapted. Add focused tests for implemented behavior;
  do not keep a passing demo test as evidence that the new collector works.
- Do not keep empty directories.

Follow [Implementation rules](how-to-implement-collector.md). Implement authentication,
accounts, applicable recurring payments, then transactions and documents. Keep the flow
linear and readable. Use SDK helpers and injected providers instead of recreating them.

Keep the existing lifecycle and test harness as references, while replacing site-specific
selectors, request bodies, identity rules and DTO mappings. Explain unsupported features.
Do not invent successful data, empty results or fallback amounts to conceal missing evidence.

Run:

```sh
npm run check
npm test
npm run build
```

The current build produces `dist/collector-starter-js.zip`; adapt that descriptive filename
and its README references for the new collector if needed. Preserve the fixed archive entries.
Inspect the archive for the expected logo, manifest and locales and the absence of development
files. `npm pack` creates an npm package, not an installable collector ZIP.

## 4. Check the first live collect together

Use the JavaScript-capable Tibu host or a verified compatible simulator. This starter does
not supply a JavaScript live simulator CLI. Do not reuse Maven commands, Java launcher classes
or headless commands from the Java starter. If no compatible host is available, complete the
local work and report live and target-engine checks as pending, with the capability needed.

Enter credentials locally, start with a fresh execution, and compare older and recent records:

| Check | Expected evidence |
| --- | --- |
| Authentication | Valid login works; failed login and OTP have meaningful errors. |
| Accounts and plans | Stable source IDs, correct links, preserved UUIDs and synchronization choices. |
| Transactions | Correct dates, time zones, currencies, signs, types, states and item details. |
| History | Pagination reaches old records; output is oldest first; changed records are refreshed. |
| Documents | Correct readable attachments, invoice and payment information, no duplicate expenses. |
| Resume | Stop keeps completed work; a new instance resumes without gaps or duplicate identities. |

A partial first version may be useful, but state its limits before accepting its output as a reference.
Never claim QuickJS compatibility from Node tests alone.

## 5. Record a run when supported and read its findings

Use the existing `test/helpers/load-collector.js` and SDK runtime pattern for deterministic
local tests. Replace the demo recording and expected output with reviewed synthetic or
anonymized target-service fixtures. Keep raw captures and personal documents outside Git.
Record real traffic only when requested and supported by the chosen tooling.

When a compatible tool provides a report, distinguish a finished run from valid data.
Read field paths and rule explanations, fix errors and investigate warnings. A report
must not repeat private values. Do not invent report fields, filenames or exit codes:
use the chosen tool's documented contract. A timeout is not a successful Stop check.

The starter's demo HAR replay is a project test, not a generic recorder, validator or
resume-check CLI. Adapt its harness to observed target behavior instead of claiming those tools exist.

## 6. Replay, fix and compare

Once the collect is complete, its data has been validated and the developer has checked
its meaning, save a local reference using the chosen tool's documented workflow. Use the
same inputs and an empty session for an independent fresh replay.

Replay uses recorded responses and must not fall back to live HTTP. This lets the agent
reproduce a problem and check a fix without repeatedly contacting the site. Separate result
differences from validation findings. For each problem, explain the cause, correct the
collector, run the relevant npm checks, then replay again.

A mismatch in method, URL or POST body identifies a request that differs from the recording.
Inspect that request locally. Changed authentication tokens or a changed request flow may
require another scenario; do not disable checks just to get a passing result. Never replace
the reference automatically when a comparison fails. If a fix intentionally changes the data,
review the difference with the developer before updating the reference.

## 7. Check interruptions and changed data

Start with one manual Stop and Run in a compatible host. Then, for a suitable complete
recording, test stopping after recorded responses and resuming in new collector instances.
Compare gathered results with an uninterrupted run and check UUID preservation. If the
collector repeats login or navigation on resume, provide continuation responses for that
flow; a missing continuation recording does not prove the collector is broken.

Add focused scenarios as the implementation grows: a transaction updated after the last
collect, a new record on an already collected date, a failed download, an expired session,
malformed required values, a temporary server error or an offline I/O failure. Keep original
recordings intact when deriving changed-response scenarios. Test successive runs with the
same restored settings and previous results, without resetting the session between runs.
Compare original UUIDs for successive runs; normalize identities only for comparisons of
independent fresh sessions, without hiding identity bugs.

Keep this stage small at first: one complete scenario and one interruption are a useful
starting point. Add a focused regression test for each bug instead of requiring every
possible scenario before the first version works. Use fixed dates and injected host services.

## 8. Finish with evidence

Run the relevant tests and build. Report implemented behavior, fixture checks, live checks,
target-engine checks and remaining limitations separately. Review the final diff and archive.
Update the README with setup, supported inputs and known limitations. Keep credentials and
private artifacts out of Git. Do not push or publish unless requested.

## Entry prompt

> Read AGENTS.md and docs/how-to-implement-collector.md, then follow docs/create-collector.md to create a JavaScript collector from this starter for customer account URL `<URL>`, named `<NAME>`, in `<DESTINATION>`. Inspect the actual website, let me sign in locally, implement the supported flow with the published Tibu SDK, replace demo tests with relevant fixtures, and run tests and ZIP packaging. Guide me through a live check when a compatible host is available. Report verified behavior and remaining limits. Do not publish.
