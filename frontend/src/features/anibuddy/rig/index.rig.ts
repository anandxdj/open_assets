// Aggregator for the AniBuddy rig contract (Rule 7). Import RigDocument v5
// types from here, never from the generated file directly — the generated
// file's name is an implementation detail of the codegen and may move.
//
// Keep this barrel browser-safe: it is imported by the client editor. Node-only
// helpers such as archetype-priors.loader.ts must be imported directly by
// server-side callers so their node:fs dependency cannot enter a client graph.
// The WASM kernel binding, the WebGL renderer and the editor state live beside
// it in sibling directories.
export * from "./rig-document.generated";
export { ArchetypePriorsConstants } from "./archetype-priors.constants";
