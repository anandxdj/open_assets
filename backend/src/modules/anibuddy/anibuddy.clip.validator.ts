// What the gateway checks about a clip on top of the generated zod DTO.
//
// The zod schema already bounds every channel, the keyframe count and the
// sampling rate. What it cannot know is the *document* a clip is being written
// onto, which is where the two failures that matter live: an id that no longer
// resolves, and a keyframe order the sampler cannot read.
//
// Kept out of `anibuddy.service.ts` deliberately. That module imports the BullMQ
// queues, and importing it opens a Redis handle — so the rules that are worth
// testing directly must not live behind one.

import { ApiError } from '../../common/utils/ApiError';
import { AniBuddyConstants } from './anibuddy.constants';
import { AniBuddyRigDocumentDto } from './dto/rig-document.generated';
import type { Clip, RigDocument } from './dto/rig-document.generated';
import type { WriteAniBuddyClipInput } from './dto/clip.schema';

export const AniBuddyClipValidator = {
  /**
   * Hard ceiling on `RevisionLink.index`, read off the generated schema.
   *
   * Derived rather than typed out: it is a bound the JSON Schema already states,
   * and re-declaring one is a review rejection (R10).
   */
  maxRevisionIndex: AniBuddyRigDocumentDto.revisionLink.shape.index.maxValue ?? 0,

  /**
   * Every joint and part id this clip names that the document does not contain.
   *
   * This is the "stale clip" case: the editor holds a clip authored against an
   * earlier revision, a later stage renamed or dropped a part, and the keyframes
   * now name ids that no longer resolve. Storing them would keep motion on
   * channels that do nothing — a clip that looks authored and animates wrongly,
   * which is exactly what R7 refuses rather than repairs.
   */
  unresolvedIds(document: RigDocument, clip: WriteAniBuddyClipInput): string[] {
    const jointIds = new Set(document.skeleton.joints.map((joint) => joint.id));
    const partIds = new Set(document.parts.map((part) => part.id));
    const unresolved = new Set<string>();

    for (const keyframe of clip.keyframes) {
      for (const jointId of Object.keys(keyframe.joints)) {
        if (!jointIds.has(jointId)) unresolved.add(`joint:${jointId}`);
      }
      for (const [partId, pose] of Object.entries(keyframe.parts)) {
        if (!partIds.has(partId)) unresolved.add(`part:${partId}`);
        // `swapTo` names the part whose pixels are drawn instead. A swap to a
        // part that does not exist draws nothing, and draws nothing silently.
        if (pose.swapTo !== undefined && !partIds.has(pose.swapTo)) {
          unresolved.add(`part:${pose.swapTo}`);
        }
      }
    }
    return [...unresolved];
  },

  /**
   * Reject a keyframe list the sampler cannot read.
   *
   * Strictly increasing `t` is not a style preference: interpolation runs between
   * the two *bracketing* keys (F9 §7.7), and two keys at one instant have no
   * bracketing order, so which of them wins would depend on array position.
   *
   * A first key later than `t = 0` is allowed here, unlike in a `MotionProposal`
   * (§8.4). A model returning a clip that starts mid-motion has misunderstood the
   * request; a human keying deliberately from frame 4 has not, and every channel
   * blends against its rest value before the first key either way.
   */
  assertKeyframeOrder(clip: WriteAniBuddyClipInput): void {
    let previous: number | null = null;
    for (const [index, keyframe] of clip.keyframes.entries()) {
      if (previous !== null && keyframe.t <= previous) {
        throw ApiError.badRequest(
          `Keyframe ${index} is at t=${keyframe.t}, which is not after the previous key at ` +
            `t=${previous}. A clip's keyframes must be strictly increasing in t.`,
        );
      }
      previous = keyframe.t;
    }
  },

  /** Both checks, in the order whose failure is most useful to read first. */
  assertWritable(document: RigDocument, clip: WriteAniBuddyClipInput): void {
    this.assertKeyframeOrder(clip);
    const unresolved = this.unresolvedIds(document, clip);
    if (unresolved.length > 0) {
      throw ApiError.badRequest(
        `This clip references ids the current rig document does not contain: ` +
          `${unresolved.join(', ')}. Reload the project and re-author the affected channels.`,
      );
    }
  },

  /** The clip as it will be stored: the client's channels, the server's provenance. */
  stamp(clip: WriteAniBuddyClipInput): Clip {
    return { ...clip, source: AniBuddyConstants.clip.source };
  },
};
