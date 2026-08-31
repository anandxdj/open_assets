// The only place AniBuddy client code reads the environment.
//
// Rule 2: no call site touches process.env. Next inlines NEXT_PUBLIC_* at build
// time, and only through a literal member access -- destructuring or dynamic
// indexing produces `undefined` in the browser bundle -- so the reads below are
// written out longhand on purpose and must stay that way.
//
// The editor ships dark: the route renders the coming-soon page until the flag
// is explicitly enabled. That is what lets the vertical slice land on main
// without being publicly reachable (F9 §15).

/** Values that count as "on". Anything else, including absent, is off. */
const TRUTHY = new Set(["1", "true", "on", "yes"]);

function flag(value: string | undefined): boolean {
  return value === undefined ? false : TRUTHY.has(value.trim().toLowerCase());
}

export const AniBuddyClientConfig = Object.freeze({
  /**
   * Gate on the rig/timeline editor route.
   *
   * Off by default. `frontend/src/app/(anibuddy)/layout.tsx` keeps serving
   * ComingSoonPage while this is false, so enabling the editor is a deploy-time
   * environment change rather than a code change.
   */
  editorEnabled: flag(process.env.NEXT_PUBLIC_ANIBUDDY_EDITOR_ENABLED),
});

export type AniBuddyClientConfigShape = typeof AniBuddyClientConfig;
