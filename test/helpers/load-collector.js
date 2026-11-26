import { readFile } from "node:fs/promises";
import { SourceTextModule, SyntheticModule } from "node:vm";
import * as linkedom from "linkedom";

/**
 * Registers execution-bound SDK exports as the host does, without changing global bindings.
 * @param {Object} runtime Existing SDK runtime for this execution.
 * @returns {Promise<Function>} Collector class linked to that runtime.
 */
export async function loadCollector(runtime) {
  const source = await readFile(new URL("../../main.js", import.meta.url), "utf8");
  const collector = new SourceTextModule(source);
  await collector.link(specifier => {
    const exports = specifier === "tibu"
      ? { ...runtime.errors, ...runtime.utilities, SDK_VERSION: runtime.SDK_VERSION }
      : specifier === "linkedom" ? linkedom : null;
    if (!exports) {
      throw new Error(`Unexpected collector import: ${specifier}`);
    }
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) {
        this.setExport(name, value);
      }
    });
  });
  await collector.evaluate();
  return collector.namespace.default;
}
