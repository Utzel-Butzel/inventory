import { handlers } from "@/auth";
import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_PREFERENCE_COOKIE, requestedRememberMe } from "@/lib/auth-session";

async function handle(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isSignIn = request.method === "POST" && pathname.includes("/signin/");
  const rememberMe = isSignIn ? await requestedRememberMe(request) : false;
  const response = await handlers[request.method === "POST" ? "POST" : "GET"](request);

  if (isSignIn || pathname.includes("/callback/") || pathname.endsWith("/signout")) {
    const result = new NextResponse(response.body, response);
    // Carry the choice across an external provider's redirect, then discard it.
    result.cookies.set(LOGIN_PREFERENCE_COOKIE, String(rememberMe), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth",
      maxAge: isSignIn ? 10 * 60 : 0,
    });
    return result;
  }
  return response;
}

export const GET = handle;
export const POST = handle;
