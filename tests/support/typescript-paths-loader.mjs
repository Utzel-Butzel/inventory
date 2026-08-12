const projectRoot = new URL("../../", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return nextResolve(new URL(`${specifier.slice(2)}.ts`, projectRoot).href, context);
  }
  return nextResolve(specifier, context);
}
