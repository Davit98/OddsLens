import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSessionValue, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

function credentialsMatch(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const expectedLogin = process.env.LOGIN;
  const expectedPassword = process.env.PASSWORD;
  if (!expectedLogin || !expectedPassword) {
    return NextResponse.json({ error: "Sign-in is not configured" }, { status: 500 });
  }

  let body: { login?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { login?: unknown; password?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const login = typeof body.login === "string" ? body.login.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const loginOk = credentialsMatch(login, expectedLogin);
  const passwordOk = credentialsMatch(password, expectedPassword);

  if (!loginOk || !passwordOk) {
    return NextResponse.json({ error: "Invalid login or password" }, { status: 401 });
  }

  const session = await createSessionValue();
  if (!session) {
    return NextResponse.json({ error: "Sign-in is not configured" }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
