import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { COPY, SECTION_GAP, SECTION_TITLE, SECTION_Y, WRAP } from "@/components/marketing/site";

const TOOLS = [
  { name: "Extract", href: "/upload", desc: "Detect, name and cut every asset on a sheet." },
  { name: "Enhance", href: "/enhance", desc: "Clean strokes, remove specks, export at up to 3×." },
  { name: "Studio", href: "/studio", desc: "Generate sprites, tiles, props and parallax backgrounds." },
  { name: "AniBuddy", href: "/anibuddy", desc: "Rig a character you drew and animate it." },
];

/* Focus rings on the band use the band's paper colour so they stay visible in both themes. */
const FOCUS = "focus-visible:outline-band-fg";

/**
 * Fixed dark band (the same in light and dark): the tool list plus the
 * extension and API. Hard shadows inside it are paper-coloured, so the
 * primary button and lifted rows keep their offset on the dark ground.
 */
export function ToolsSection() {
  return (
    <section
      id="tools"
      aria-labelledby="tools-title"
      className="scroll-mt-16 bg-band text-band-fg [--oa-shadow-ink:var(--oa-band-fg)]"
    >
      <div className={`${WRAP} flex flex-col ${SECTION_GAP} ${SECTION_Y}`}>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="flex flex-col gap-4">
            <span className="oa-eyebrow">One workspace</span>
            <h2 id="tools-title" className={SECTION_TITLE}>
              Extraction first.
              <br />
              More tools around it.
            </h2>
          </div>
          <p className={`max-w-[400px] ${COPY} opacity-75`}>
            Every tool shares one library, so an extracted sprite goes straight to cleanup, a collection or animation.
          </p>
        </div>

        <ul className="flex flex-col border-t border-band-fg/20">
          {TOOLS.map((tool, i) => (
            <li key={tool.name}>
              <Link
                href={tool.href}
                className={`oa-lift group grid grid-cols-[32px_minmax(0,1fr)_20px] items-center gap-x-4 gap-y-2 border-b border-band-fg/20 py-7 md:grid-cols-[64px_minmax(0,1fr)_minmax(0,1.4fr)_28px] ${FOCUS}`}
              >
                <span aria-hidden className="oa-value opacity-60">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="oa-h3 group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4">
                  {tool.name}
                </span>
                <span className={`col-start-2 col-end-4 row-start-2 ${COPY} opacity-75 md:col-auto md:row-auto`}>
                  {tool.desc}
                </span>
                <ArrowRight aria-hidden className="col-start-3 row-start-1 size-5 md:col-auto md:row-auto" />
              </Link>
            </li>
          ))}
        </ul>

        <div className="grid gap-5 md:grid-cols-2 md:gap-6">
          <div id="extension" className="flex scroll-mt-20 flex-col gap-4 border border-band-fg/25 p-6 md:p-8">
            <span className="oa-label text-inherit opacity-70">Chrome extension</span>
            <h3 className="oa-h3">Right-click any image on the web</h3>
            <p className={`${COPY} opacity-75`}>
              Choose Extract with OpenAssets and it opens in the editor. Queue ChatGPT generations from the side panel
              too.
            </p>
            <p className="flex flex-wrap items-center gap-1.5 text-xs leading-[18px]">
              <kbd className="oa-kbd">Alt</kbd>
              <kbd className="oa-kbd">Shift</kbd>
              <kbd className="oa-kbd">E</kbd>
              <span className="opacity-75">extracts the last selected image</span>
            </p>
          </div>
          <div id="api" className="flex min-w-0 scroll-mt-20 flex-col gap-4 border border-band-fg/25 p-6 md:p-8">
            <span className="oa-label text-inherit opacity-70">REST API</span>
            <h3 className="oa-h3">Same pipeline, from code</h3>
            <pre
              tabIndex={0}
              aria-label="Example request"
              className={`oa-value overflow-x-auto border border-band-fg/25 px-4 py-3.5 leading-[18px] ${FOCUS}`}
            >
              {`curl -X POST "$OPENASSETS_API/api/v1/jobs" \\
  -H "Authorization: Bearer $OPENASSETS_KEY" \\
  -F image=@rpg_pack_v1.png`}
            </pre>
            <Link
              href="/docs/api"
              className={`inline-flex w-fit items-center gap-1.5 text-[13px] underline decoration-[1.5px] underline-offset-4 ${FOCUS}`}
            >
              API keys and reference
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
