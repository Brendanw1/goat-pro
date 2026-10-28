import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Auth middleware — disabled during development.
// Uncomment when Turso is connected:
// export { auth as middleware } from "@/lib/auth";

export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [],
};
