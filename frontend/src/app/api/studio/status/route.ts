// Tells Studio and AniBuddy whether this server is in demo (mock) mode. The server decides: the
// browser never guesses from a public env var. Read at request time, so it follows the running
// server's environment, not the one the app was built with.
import { NextResponse } from 'next/server'
import { getAiStatus } from '../_lib/aiStatus'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(getAiStatus(), { headers: { 'Cache-Control': 'no-store' } })
}
