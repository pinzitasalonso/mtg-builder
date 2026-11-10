// Stands in for "next/headers" in tests (see vitest.config.ts). The app's
// session is a cookie; this is the jar it's read from and written to.

export const cookieJar = new Map<string, string>();

export async function cookies() {
  return {
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => void cookieJar.set(name, value),
    delete: (name: string) => void cookieJar.delete(name),
  };
}

export async function headers() {
  return new Headers();
}
