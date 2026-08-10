"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, ImageUp, LoaderCircle, RotateCcw, SlidersHorizontal } from "lucide-react";
import { apiClient } from "@/lib/api-client";

type Background = "transparent" | "white" | "dark";
interface Recipe {
  cleanup: number;
  speckRemoval: number;
  contrast: number;
  background: Background;
  scale: 1 | 2 | 3;
}

const defaults: Recipe = { cleanup: 4, speckRemoval: 1, contrast: 1, background: "transparent", scale: 1 };

export function ExcaliburWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [recipe, setRecipe] = useState<Recipe>(defaults);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceUrl = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);

  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); }, [sourceUrl]);
  useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl); }, [resultUrl]);

  async function submit() {
    if (!file) return;
    setError(null);
    const form = new FormData();
    form.append("image", file);
    form.append("cleanup", String(recipe.cleanup));
    form.append("speckRemoval", String(recipe.speckRemoval));
    form.append("contrast", String(recipe.contrast));
    form.append("background", recipe.background);
    form.append("scale", String(recipe.scale));
    try {
      setBusy(true);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(await apiClient.postFormBlob("/api/enhance/excalibur", form)));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not start enhancement.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setRecipe(defaults);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setError(null);
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-8 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b-2 border-zinc-950 pb-7 dark:border-zinc-100">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Excalibur Enhance / deterministic</p>
          <h1 className="mt-3 text-4xl font-black tracking-[-0.05em] sm:text-5xl">Polish the lines. Keep the intent.</h1>
        </div>
        <p className="max-w-sm font-mono text-xs leading-5 text-zinc-500">Your original is untouched. Exported output includes a canonical, versioned recipe.</p>
      </div>

      <div className="grid gap-6 py-8 lg:grid-cols-[16rem_minmax(0,1fr)_17rem]">
        <aside className="border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.12em]"><SlidersHorizontal size={15} /> Controls</div>
          <label className="mt-7 block font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">Stroke clarity {recipe.cleanup}/10
            <input className="mt-3 w-full accent-zinc-950 dark:accent-zinc-100" type="range" min="0" max="10" value={recipe.cleanup} onChange={(event) => setRecipe({ ...recipe, cleanup: Number(event.target.value) })} />
          </label>
          <p className="mt-2 text-xs leading-5 text-zinc-500">Sharpens existing text and thin lines without redrawing them.</p>
          <label className="mt-6 block font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">Speck removal {recipe.speckRemoval}/10
            <input className="mt-3 w-full accent-zinc-950 dark:accent-zinc-100" type="range" min="0" max="10" value={recipe.speckRemoval} onChange={(event) => setRecipe({ ...recipe, speckRemoval: Number(event.target.value) })} />
          </label>
          <label className="mt-6 block font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">Contrast {recipe.contrast.toFixed(1)}×
            <input className="mt-3 w-full accent-zinc-950 dark:accent-zinc-100" type="range" min="0.5" max="2" step="0.1" value={recipe.contrast} onChange={(event) => setRecipe({ ...recipe, contrast: Number(event.target.value) })} />
          </label>
          <fieldset className="mt-6"><legend className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">Background</legend>
            <div className="mt-3 grid grid-cols-3 gap-1">{(["transparent", "white", "dark"] as const).map((background) => <button type="button" key={background} onClick={() => setRecipe({ ...recipe, background })} className={`border px-1 py-2 font-mono text-[9px] uppercase ${recipe.background === background ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950" : "border-zinc-300 text-zinc-500 dark:border-zinc-700"}`}>{background === "transparent" ? "alpha" : background}</button>)}</div>
          </fieldset>
          <fieldset className="mt-6"><legend className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">Output</legend>
            <div className="mt-3 grid grid-cols-3 gap-1">{([1, 2, 3] as const).map((scale) => <button type="button" key={scale} onClick={() => setRecipe({ ...recipe, scale })} className={`border px-2 py-2 font-mono text-[10px] ${recipe.scale === scale ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950" : "border-zinc-300 text-zinc-500 dark:border-zinc-700"}`}>{scale}× PNG</button>)}</div>
          </fieldset>
          <button type="button" onClick={reset} className="mt-8 inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-100"><RotateCcw size={13} /> Reset</button>
        </aside>

        <section className="min-h-[28rem] border border-zinc-300 bg-[linear-gradient(45deg,#f4f4f5_25%,transparent_25%,transparent_75%,#f4f4f5_75%),linear-gradient(45deg,#f4f4f5_25%,transparent_25%,transparent_75%,#f4f4f5_75%)] bg-[length:22px_22px] bg-[position:0_0,11px_11px] p-4 dark:border-zinc-700 dark:bg-[linear-gradient(45deg,#27272a_25%,transparent_25%,transparent_75%,#27272a_75%),linear-gradient(45deg,#27272a_25%,transparent_25%,transparent_75%,#27272a_75%)]">
          {!sourceUrl ? <label className="flex h-full min-h-[24rem] cursor-pointer flex-col items-center justify-center border-2 border-dashed border-zinc-400 bg-white/80 p-8 text-center dark:bg-zinc-900/80"><ImageUp size={32} /><span className="mt-4 font-mono text-sm font-bold uppercase tracking-[0.12em]">Choose source artwork</span><span className="mt-2 text-xs text-zinc-500">SVG, PNG, JPEG, or WebP · 20 MB max</span><input className="sr-only" type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" onChange={(event) => { setFile(event.target.files?.[0] ?? null); reset(); }} /></label> : <div className="grid h-full gap-4 md:grid-cols-2"><figure className="flex min-h-[24rem] flex-col bg-white/90 p-3 dark:bg-zinc-900/90"><figcaption className="mb-3 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">Original</figcaption><img src={sourceUrl} alt="Original uploaded artwork" className="min-h-0 flex-1 object-contain" /></figure><figure className="flex min-h-[24rem] flex-col bg-white/90 p-3 dark:bg-zinc-900/90"><figcaption className="mb-3 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">Enhanced output</figcaption>{resultUrl ? <><img src={resultUrl} alt="Enhanced artwork" className="min-h-0 flex-1 object-contain" /><a href={resultUrl} download="enhanced.png" className="mt-3 inline-flex items-center justify-center gap-2 border border-zinc-950 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] hover:bg-zinc-950 hover:text-white dark:border-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-950"><Download size={14} /> Download PNG</a></> : <div className="flex flex-1 items-center justify-center text-center font-mono text-xs uppercase tracking-[0.12em] text-zinc-500">{busy ? <span className="inline-flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" /> Processing…</span> : "Run enhancement to compare"}</div>}</figure></div>}
        </section>

        <aside className="border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Recipe preview</p>
          <pre className="mt-4 overflow-x-auto border-l-2 border-amber-400 pl-3 font-mono text-[10px] leading-5 text-zinc-600 dark:text-zinc-300">{JSON.stringify(recipe, null, 2)}</pre>
          {error && <p className="mt-5 border border-red-400 bg-red-50 p-3 text-xs leading-5 text-red-800 dark:bg-red-950/30 dark:text-red-200">{error}</p>}
          <button type="button" disabled={!file || busy} onClick={submit} className="mt-7 flex w-full items-center justify-center gap-2 border border-zinc-950 bg-zinc-950 px-4 py-3 font-mono text-xs font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-white hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-950 dark:hover:text-zinc-100">{busy && <LoaderCircle size={15} className="animate-spin" />}{busy ? "Processing" : "Enhance image"}</button>
        </aside>
      </div>
    </main>
  );
}
