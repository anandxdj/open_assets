// Aggregator for the AniBuddy rig contract (Rule 7). Import RigDocument v5
// types from here, never from the generated file directly — the generated
// file's name is an implementation detail of the codegen and may move.
//
// This directory holds only the shared contract plus archetype prior loaders.
// The WASM kernel binding, the WebGL renderer and the editor state live beside
// it in sibling directories.
export * from "./rig-document.generated";
export { ArchetypePriorsConstants } from "./archetype-priors.constants";
export {
  ArchetypePriors,
  type ArchetypePrior,
  type ArchetypePriorsDocument,
  type AttachSlotConvention,
  type TopologyPattern,
  type TopologyStyle,
} from "./archetype-priors.loader";
