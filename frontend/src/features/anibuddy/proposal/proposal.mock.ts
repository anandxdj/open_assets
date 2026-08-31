// Deterministic fixtures for `isMockMode()` (OPENROUTER_MOCK=1).
//
// Same contract the studio routes already use: auth and credits run for real, no
// provider is called, and the response is schema-shaped so the client pipeline
// downstream does real work on it. What that buys specifically for the critique
// loop is that the loop can be exercised end to end — three passes, the pass cap,
// the credit ceiling, the best-revision selection — without burning credits on a
// vision model to find out whether the pass counter is off by one.
//
// The fixtures are built from the caller's OWN ids rather than hardcoded, so a
// mock response passes the same revalidation a real one does. A fixture that
// bypassed revalidation would make mock mode a test of nothing.

import type {
  CritiqueReport,
  DeformerKind,
  MotionProposal,
  PartRole,
  SemanticsProposal,
} from "../rig/index.rig";
import { ProposalConstants } from "./proposal.constants";
import type {
  CritiqueCallInput,
  MotionCallInput,
  PartLegendEntry,
} from "./proposal.types";

/** Role and deformer a mock assigns by position, so the fixture is not all torsos. */
const MOCK_ROLE_CYCLE: readonly PartRole[] = ["torso", "head", "armUpper", "legUpper"];
const MOCK_DEFORMER_CYCLE: readonly DeformerKind[] = ["mesh", "mesh", "rigid", "lattice"];

export const ProposalMocks = Object.freeze({
  /**
   * A semantics proposal that parents everything to the first part.
   *
   * A single-root star rather than a plausible skeleton on purpose: it is the
   * simplest shape that satisfies every structural rule the revalidator checks,
   * so a mock-mode failure is a real failure rather than a fixture bug.
   */
  semantics(legend: PartLegendEntry[], archetype: string): SemanticsProposal {
    const rootId = legend[0]?.partId;
    return {
      archetype: (archetype as SemanticsProposal["archetype"]) ?? "humanoid",
      parts: legend.map((entry, index) => ({
        partId: entry.partId,
        role: MOCK_ROLE_CYCLE[index % MOCK_ROLE_CYCLE.length],
        parentPartId: index === 0 ? null : rootId ?? null,
        attachSlot: null,
        pivotHint: { x: 0.5, y: index === 0 ? 0.1 : 0.5 },
        zIndex: index,
        deformerHint: MOCK_DEFORMER_CYCLE[index % MOCK_DEFORMER_CYCLE.length],
        confidence: 0.8,
      })),
      joints: [],
      warnings: ["Mock mode: these semantics are a fixture, not an analysis."],
    };
  },

  /** A two-key breathing clip on the rig's own root joint, or its first part. */
  motion(input: MotionCallInput): MotionProposal {
    const root = input.joints.find((joint) => joint.parent === null) ?? input.joints[0];
    const keyframes: MotionProposal["keyframes"] = root
      ? [
          { t: 0, ease: "ease", joints: { [root.id]: { ty: 0 } }, parts: {} },
          { t: 0.5, ease: "ease", joints: { [root.id]: { ty: -0.03 } }, parts: {} },
          { t: 1, ease: "ease", joints: { [root.id]: { ty: 0 } }, parts: {} },
        ]
      : [
          // No skeleton at all is legal — `prop` and `environment` rigs live
          // entirely in PartPose channels (F9 §10.4, §10.5).
          { t: 0, ease: "ease", joints: {}, parts: { [input.partIds[0]]: { ty: 0 } } },
          {
            t: 0.5,
            ease: "ease",
            joints: {},
            parts: { [input.partIds[0]]: { ty: -0.03 } },
          },
          { t: 1, ease: "ease", joints: {}, parts: { [input.partIds[0]]: { ty: 0 } } },
        ];

    return {
      name: "Gentle breathing",
      loop: true,
      fps: input.defaultFps,
      frameCount: input.defaultFrameCount,
      keyframes,
      warnings: ["Mock mode: this clip is a fixture, not an analysis."],
    };
  },

  /**
   * A critique that revises the first pass and accepts the second.
   *
   * Converging rather than always revising, because a mock that never accepts
   * only ever exercises the pass-cap path and leaves the accept path — the
   * common one in production — untested.
   */
  critique(input: CritiqueCallInput): CritiqueReport {
    if (input.passIndex >= 2 || input.partIds.length === 0) {
      return {
        verdict: "accept",
        passIndex: input.passIndex,
        observations: ["Mock mode: the motion reads correctly."],
        corrections: [],
      };
    }
    return {
      verdict: "revise",
      passIndex: input.passIndex,
      observations: [
        `Mock mode: reviewing ${input.columns}x${input.rows} frames at peak stretch ` +
          `${input.maxStretch.toFixed(2)}.`,
      ],
      corrections: [
        {
          kind: "pivot-nudge",
          targetId: input.partIds[0],
          reason: "Mock mode: the first part rotates about its centre instead of its hips.",
          vec2: { x: 0, y: -ProposalConstants.maxPivotNudge / 2 },
          scalar: null,
          intValue: null,
          deformerKind: null,
          stringValue: null,
        },
      ],
    };
  },
});
