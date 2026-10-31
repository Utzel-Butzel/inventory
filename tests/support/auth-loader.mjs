import { resolve as resolveTypescript } from './typescript-paths-loader.mjs';
export function resolve(specifier, context, nextResolve) {
  if (['next/server', 'next/headers', 'next/navigation'].includes(specifier)) {
    return nextResolve(`${specifier}.js`, context);
  }
  return resolveTypescript(specifier, context, nextResolve);
}
