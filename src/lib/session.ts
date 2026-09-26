export const SESSION_COOKIE = "oddslens_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function getSecret(): string | null {
  const login = process.env.LOGIN;
  const password = process.env.PASSWORD;
  if (!login || !password) return null;
  return `${login}\0${password}`;
}

function bytesToBase64Url(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmac(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bytesToBase64Url(signature);
}

function signaturesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function createSessionValue(): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;
  const exp = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = `v1.${exp}`;
  const signature = await hmac(payload, secret);
  return `${payload}.${signature}`;
}

export async function verifySessionValue(value: string | undefined | null): Promise<boolean> {
  const secret = getSecret();
  if (!secret || !value) return false;
  const [version, expRaw, signature] = value.split(".");
  if (version !== "v1" || !expRaw || !signature) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmac(`v1.${expRaw}`, secret);
  return signaturesMatch(signature, expected);
}

export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) {
    return "/";
  }
  return value;
}
