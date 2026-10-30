import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SECTION_TITLE, WRAP } from "@/components/marketing/site";

const TOOLS = [
  { name: "Extract", href: "/upload", desc: "Detect, name and cut every asset on a sheet.", live: true },
  { name: "Enhance", href: "/enhance", desc: "Clean strokes, remove specks, export at up to 3×.", live: true },
  { name: "Studio", href: "/studio", desc: "Generate sprites, tiles, props and parallax backgrounds.", live: false },
  { name: "AniBuddy", href: "/anibuddy", desc: "Rig a character you drew and animate it.", live: false },
];

/* Focus rings on the inverted band use the page colour so they stay visible. */
const FOCUS = "focus-visible:outline-page";

/** Inverted "you are here" band: the tool list plus the extension and API. */
export function ToolsSection() {
  return (
    <section id="tools" aria-labelledby="tools-title" className="scroll-mt-16 bg-ink text-page">
      <div className={`${WRAP} flex flex-col gap-8 py-16 md:py-[88px]`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-3.5">
            <span className="oa-eyebrow">One workspace</span>
            <h2 id="tools-title" className={SECTION_TITLE}>
              Extraction first.
              <br />
              More tools around it.
            </h2>
          </div>
          <p className="max-w-[400px] text-xs leading-[18px] opacity-75">
            Every tool shares one library, so an extracted sprite goes straight to cleanup, a collection or animation.
          </p>
        </div>

        <ul className="flex flex-col border-t-2 border-page">
          {TOOLS.map((tool, i) => (
            <li key={tool.name}>
              <Link
                href={tool.href}
                className={`group grid grid-cols-[32px_minmax(0,1fr)_auto_20px] items-center gap-x-4 gap-y-1.5 border-b-[1.5px] border-page py-[22px] md:grid-cols-[64px_minmax(0,1fr)_minmax(0,1.4fr)_90px_28px] ${FOCUS}`}
              >
                <span aria-hidden className="oa-value opacity-60">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="oa-h3 group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4">
                  {tool.name}
                </span>
                <span className="col-start-2 col-end-5 row-start-2 text-xs leading-[18px] opacity-75 md:col-auto md:row-auto">
                  {tool.desc}
                </span>
                <span className="col-start-3 row-start-1 md:col-auto md:row-auto">
                  {tool.live ? (
                    <Badge tone="accent">Live</Badge>
                  ) : (
                    <Badge className="text-inherit">Soon</Badge>
                  )}
                </span>
                <ArrowRight
                  aria-hidden
                  className="col-start-4 row-start-1 size-5 md:col-auto md:row-auto"
                />
              </Link>
            </li>
          ))}
        </ul>

        <div className="grid gap-6 md:grid-cols-2">
          <div id="extension" className="flex scroll-mt-20 flex-col gap-3.5 border-2 border-page p-5 md:p-7">
            <span className="oa-label text-inherit opacity-70">Chrome extension</span>
            <h3 className="oa-h3">Right-click any image on the web</h3>
            <p className="text-xs leading-[18px] opacity-75">
              Choose Extract with OpenAssets and it opens in the editor. Queue ChatGPT generations from the side panel
              too.
            </p>
            <p className="flex flex-wrap items-center gap-1.5 text-[11px] leading-4">
              <kbd className="oa-kbd">Alt</kbd>
              <kbd className="oa-kbd">Shift</kbd>
              <kbd className="oa-kbd">E</kbd>
              <span className="opacity-75">extracts the last selected image</span>
            </p>
          </div>
          <div id="api" className="flex min-w-0 scroll-mt-20 flex-col gap-3.5 border-2 border-page p-5 md:p-7">
            <span className="oa-label text-inherit opacity-70">REST API</span>
            <h3 className="oa-h3">Same pipeline, from code</h3>
            <pre
              tabIndex={0}
              aria-label="Example request"
              className={`oa-value overflow-x-auto border-[1.5px] border-page px-4 py-3.5 leading-[18px] ${FOCUS}`}
            >
              {`curl -X POST "$OPENASSETS_API/api/upload" \\
  -H "Authorization: Bearer $OPENASSETS_TOKEN" \\
  -F image=@rpg_pack_v1.png`}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
