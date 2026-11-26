# Development guidelines

This repository is the JavaScript skeleton of the Tibu Java collector starter.

- Keep the project in JavaScript using standard ECMAScript modules and npm.
- Follow the package and input format in [Manifest specification](docs/manifest.md).
- Keep the package entry point at `main.js`, the logo at `icon.png`, and translations at `_locales/<locale>/messages.json`.
- Preserve the Java starter's configuration keys and message keys during conversion.
- Do not implement collector behavior or invent the host SDK contract until explicitly requested.
- Runtime code must not depend on Node.js APIs; Node.js is used only for development and packaging.
- Future requests, downloads, authentication and OTP interactions must use the Tibu host SDK.
- Write code, comments and documentation in English.
- Use two-space indentation, readable control flow, and comments that explain non-obvious constraints.
