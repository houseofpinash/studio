import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, createSessionToken } from "@/lib/session";

export async function POST(req: NextRequest) {
  const secret = process.env.APP_PASSWORD;
  if (!secret) {
    return NextResponse.json(
      { error: "Server is missing APP_PASSWORD." },
      { status: 500 }
    );
  }

  const { password } = await req.json().catch(() => ({ password: "" }));

  if (typeof password !== "string" || password !== secret) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const token = await createSessionToken(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
