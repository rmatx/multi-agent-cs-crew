/**
 * Test-only module resolver — maps the project's TypeScript path aliases for `node --test`.
 *
 * WHY THIS EXISTS. `tsconfig.json` declares `@/*` and `@shared/*`, which `tsc` and Next both
 * understand and Node does not. Until now every unit-tested module was deliberately
 * import-free (`toolRegistry.ts`, `moneyIntent.ts`, `needsInput.ts`, `policyScore.ts`,
 * `groundingGuard.ts`) so the question never arose — a good constraint for pure logic, and an
 * impossible one for the SessionStore, whose whole job is to talk to SQLite.
 *
 * The alternative was rewriting those imports as relative paths with `.ts` extensions, which
 * `tsc --noEmit` rejects without `allowImportingTsExtensions` — the same bind documented in
 * `toolRegistry.test.ts`. A twenty-line test-only resolver is a smaller price than either
 * bending the production import style around the test runner or leaving the durable stores
 * untested.
 *
 * Registered via `node --import ./scripts/test-resolver.mjs --test` (see package.json).
 * It affects the test process only and is not part of the app's runtime.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = process.cwd();

/** Same mapping as tsconfig `compilerOptions.paths`. Keep the two in step. */
function mapAlias(specifier) {
  if (specifier.startsWith("@shared/")) {
    return path.join(ROOT, "packages", "shared", "src", specifier.slice("@shared/".length));
  }
  if (specifier.startsWith("@/")) {
    return path.join(ROOT, specifier.slice(2));
  }
  return null;
}

/** Node needs an explicit extension; TypeScript source omits it. */
function withExtension(filePath) {
  if (existsSync(filePath) && path.extname(filePath) !== "") return filePath;
  for (const candidate of [`${filePath}.ts`, `${filePath}.tsx`, path.join(filePath, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Extensionless RELATIVE imports, e.g. `./demoOverlay` from inside `dateShift.ts`.
 *
 * TypeScript and Next resolve these; Node's ESM loader does not. It only surfaces when a
 * module that imports a sibling is loaded by the test runner — which is why it appeared the
 * moment QA wrote the first test for the temporal layer, and not before: every previously
 * tested module was either import-free or imported through an alias.
 */
function resolveRelative(specifier, parentURL) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  if (parentURL === undefined || !parentURL.startsWith("file:")) return null;
  const asPath = path.resolve(path.dirname(fileURLToPath(parentURL)), specifier);
  return withExtension(asPath);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const mapped = mapAlias(specifier);
    if (mapped !== null) {
      const resolved = withExtension(mapped);
      if (resolved !== null) return { url: pathToFileURL(resolved).href, shortCircuit: true };
      return nextResolve(specifier, context);
    }

    const relative = resolveRelative(specifier, context.parentURL);
    if (relative !== null) return { url: pathToFileURL(relative).href, shortCircuit: true };

    return nextResolve(specifier, context);
  },
});
