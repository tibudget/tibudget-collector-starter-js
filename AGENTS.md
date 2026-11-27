# Development guidelines

This repository is the JavaScript skeleton of the Tibu Java collector starter.

- For a new collector, follow [Create a JavaScript collector](docs/create-collector.md) and [Implementation rules](docs/how-to-implement-collector.md). For guide maintenance, follow [Update collector guides](docs/update-collector.md).
- Keep the project in JavaScript using standard ECMAScript modules and npm.
- Follow the package and input format in [Collector package format](docs/collector-package-format.md).
- Keep the package entry point at `main.js`, the logo at `logo.png`, and translations at `_locales/<locale>/messages.json`.
- Preserve established configuration keys and message keys when maintaining a collector. When adapting the demo to a new service, replace demo-specific inputs and messages with verified service requirements.
- Implement collector behavior when requested, using the installed SDK contracts and observed website behavior. Do not invent the host SDK contract.
- Runtime code must not depend on Node.js APIs; Node.js is used only for development and packaging.
- Future requests, downloads, authentication and OTP interactions must use the Tibu host SDK.
- Write code, comments and documentation in English.
- Use two-space indentation, readable control flow, and comments that explain non-obvious constraints.
