// The `animate` stage: a vision call, and the clip it becomes.
//
// Where this stage belongs, and why it is not a py_backend endpoint
// ----------------------------------------------------------------
// `animate` was the last stage still routed to the JSON stub, and the obvious move
// — give it a `/anibuddy/animate` multipart endpoint like its three siblings —
// would have been wrong. The other three resample pixels or build geometry, which
// is what py_backend is for. This one turns the built rig's real part and joint ids
// plus one sentence of user intent into bounded keyframes (F9 §8.4), and that is a
// model call. Routing it through Python would mean an endpoint whose only job is to
// forward a request it cannot answer, and py_backend cannot answer it because the
// single provider-fallback chain is not there and must not be copied there.
//
// So `animate` gets its own transport KIND rather than a py path:
// `motion-vision`, served by `next-vision` in `AniBuddyConstants.serviceByTransport`.
// The routing table stays the single source of truth — the worker still asks it
// which surface a stage runs against and never names a route itself — and the test
// that every routed stage has an implemented transport still bites, now over five
// transports across two services instead of four across one.
//
// What Node authors, and what it does not
// ---------------------------------------
// Node writes the child revision here, which it does not do for any other stage.
// That is not a weakening of "the server authors diagnostics": this stage MEASURES
// NOTHING. It adds a clip, and `diagnostics` — including `blockingReason` — is
// carried across verbatim from the parent, exactly as a clip write does (§7.8). The
// numbers on a rig are still whatever the Python validator last measured, and the
// next render is what changes them.

import { AniBuddyConstants } from './anibuddy.constants';
import { AniBuddyVisionClient } from './anibuddy.vision.client';
import { UsageService } from '../usage/usage.service';
import { AniBuddyRigDocumentDto } from './dto/rig-document.generated';
import type {
  Clip,
  MotionProposal,
  RigDocument,
  StageRecord,
} from './dto/rig-document.generated';
import type { AniBuddyAnimateOptions } from './dto/project.schema';
import type { AniBuddyStageResponse, AniBuddyStageSheet } from './anibuddy.py.client';

export interface AniBuddyAnimateInput {
  document: RigDocument;
  sheet: AniBuddyStageSheet;
  options: AniBuddyAnimateOptions | null;
  /** Id the child revision must be stamped with (R9). */
  revisionId: string;
  revisionIndex: number;
  passIndex: number;
  inputHash: string;
  usageEventId: string | null;
  startedAt: Date;
}

export const AniBuddyAnimateService = {
  /**
   * Internal method — a clip id that satisfies the schema's own pattern.
   *
   * The user's `clipId` wins when they gave one, because they are naming a clip they
   * intend to re-render. Otherwise the proposal's name is slugified, and a name with
   * nothing usable in it falls back to the constant rather than to an empty string:
   * `Clip.id` is `^[A-Za-z0-9_-]{1,32}$` and an unslugifiable name is a schema
   * failure at the very end of a paid vision call.
   */
  _clipId(options: AniBuddyAnimateOptions | null, proposal: MotionProposal): string {
    if (options?.clipId) return options.clipId;
    const slug = proposal.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
    return slug || AniBuddyConstants.animate.defaultClipId;
  },

  /**
   * Internal method — the proposal as a `Clip`.
   *
   * A projection, not a copy: `MotionProposal` and `Clip` share the generated
   * `Keyframe` type, so no channel is reinterpreted on the way across, and the two
   * fields the proposal cannot carry are supplied by the server. `request` is the
   * user's own sentence, kept so the editor can show what was asked for, and
   * `source` is stamped `model` for the same reason a clip write is stamped
   * `edited` — those values name work that really happened, and a caller does not
   * get to claim them.
   */
  _toClip(proposal: MotionProposal, options: AniBuddyAnimateOptions | null): Clip {
    return {
      id: this._clipId(options, proposal),
      name: proposal.name,
      request: (options?.request ?? '').slice(0, AniBuddyConstants.animate.maxRequestLength),
      loop: proposal.loop,
      fps: proposal.fps,
      frameCount: proposal.frameCount,
      keyframes: proposal.keyframes,
      source: AniBuddyConstants.animate.clipSource,
    };
  },

  /**
   * Internal method — the sheet as the one shape a provider can be shown an image in.
   *
   * `image_url` parts take a URL or a data URL and nothing else. The gateway owns
   * the StorageAdapter, so it is the only process that can turn a storage key into
   * bytes; encoding them here is what lets the vision route stay a pure model call
   * with no storage credentials of its own.
   */
  _dataUrl(sheet: AniBuddyStageSheet): string {
    return `data:${sheet.contentType};base64,${sheet.buffer.toString('base64')}`;
  },

  /**
   * Internal method — the `StageRecord` this execution appends to provenance.
   *
   * Authored here because no other process ran this stage. `modelId` is the model
   * that actually SERVED the call rather than the one that was requested (R13), and
   * `creditsSpent` is 0 because the charge happened at enqueue: recording it twice
   * would double it in any report that sums the audit trail.
   */
  _stageRecord(input: AniBuddyAnimateInput, servedModel: string, message: string): StageRecord {
    return {
      stage: 'animate',
      status: 'succeeded',
      startedAt: input.startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      inputHash: input.inputHash,
      passIndex: input.passIndex,
      modelId: servedModel,
      usageEventId: input.usageEventId,
      creditsSpent: 0,
      message: message.slice(0, 2000),
    };
  },

  /**
   * Internal method — the child revision carrying the new clip.
   *
   * `diagnostics`, `parts`, `skeleton`, deformer payloads and the generation seam
   * are carried across verbatim. A clip is the only thing that changes, so
   * `blockingReason` stays exactly the sentence the Python validator authored and
   * nothing here can clear an export gate this stage did not measure (§7.8).
   */
  _childRevision(
    parent: RigDocument,
    clip: Clip,
    record: StageRecord,
    input: AniBuddyAnimateInput,
  ): RigDocument {
    const existing = parent.clips.findIndex((candidate) => candidate.id === clip.id);
    if (existing < 0 && parent.clips.length >= AniBuddyConstants.clip.maxClips) {
      throw new Error(
        `This project already holds the maximum of ${AniBuddyConstants.clip.maxClips} clips, ` +
          `so the proposed clip '${clip.id}' cannot be added. Delete one and re-run animate.`,
      );
    }

    const clips =
      existing >= 0
        ? parent.clips.map((candidate, index) => (index === existing ? clip : candidate))
        : [...parent.clips, clip];

    return {
      ...parent,
      id: input.revisionId,
      updatedAt: new Date().toISOString(),
      revision: {
        index: input.revisionIndex,
        parentRevisionId: parent.id,
        reason: `${AniBuddyConstants.animate.revisionReason}:${clip.id}`,
        // A proposal the user has not looked at yet is not accepted (§7.2). The
        // editor flips this when they keep it.
        accepted: false,
      },
      clips,
      provenance: {
        ...parent.provenance,
        stages: [...parent.provenance.stages, record],
      },
    };
  },

  /**
   * Internal method — return the stage's credits when the call produced nothing.
   *
   * Not a new billing policy: it is §11.6's rule, applied to the one other stage whose
   * work is a vision call. Credits for work that really happened are kept; credits for
   * a provider that never answered, or an answer that failed revalidation twice, are
   * owed back — and `anibuddy-animate` is the most expensive op in the table, so
   * stranding one is the most expensive way to get this wrong.
   *
   * The route reports refundability rather than this method inferring it from a status,
   * because the two come apart: a revalidation rejection and a refused correction are
   * both 422s and only one of them is owed back.
   *
   * Best-effort, matching every other refund path: a failed refund is logged, never
   * thrown, because throwing here would replace a named stage failure with a credits
   * error and lose the reason the stage failed.
   */
  async _refundIfOwed(usageEventId: string | null, refundable: boolean): Promise<void> {
    if (!usageEventId || !refundable) return;
    try {
      // Call to usage service. Idempotent, so a retried job cannot double-refund.
      await UsageService.refund(usageEventId);
    } catch (error) {
      console.error('[anibuddy.animate] refund failed', { usageEventId, error });
    }
  },

  /**
   * Run the stage: propose a motion, then write the clip onto a child revision.
   *
   * Returns the same `AniBuddyStageResponse` the py transports return, so
   * `processStageJob` persists, hashes and reports it identically. A stage that
   * needed its own persistence path would be a second place for the revision rules
   * to be implemented.
   */
  async run(input: AniBuddyAnimateInput): Promise<AniBuddyStageResponse> {
    const request = input.options?.request?.trim() ?? '';
    if (!request) {
      throw new Error(
        'The animate stage needs a description of the motion to propose. Enqueue it with ' +
          "`animate: { request: '...' }`.",
      );
    }
    if (input.document.parts.length === 0) {
      throw new Error('This rig has no parts to animate. Run the decompose and rig stages first.');
    }
    if (!input.document.asset.remoteVisionConsented) {
      throw new Error(
        'This sheet has not been cleared for remote vision, so a motion cannot be proposed. ' +
          'Animate it by hand in the timeline instead.',
      );
    }

    // Call to the single provider chain, via the Next vision route.
    const proposed = await AniBuddyVisionClient.motion({
      document: input.document,
      request,
      imageDataUrl: this._dataUrl(input.sheet),
    });
    if (!proposed.ok) {
      await this._refundIfOwed(input.usageEventId, proposed.refundable);
      throw new Error(proposed.error);
    }

    const parsed = AniBuddyRigDocumentDto.motionProposal.safeParse(proposed.proposal);
    if (!parsed.success) {
      // The route revalidated this already; parsing it again here is the boundary
      // check on a payload that crossed a process, and a failure means the two
      // sides disagree about the schema rather than that the model misbehaved.
      throw new Error(`The motion proposal did not match the schema: ${parsed.error.message}`);
    }

    const clip = this._toClip(parsed.data, input.options ?? null);
    const warnings = [...parsed.data.warnings, ...proposed.warnings];
    const message =
      `animate proposed '${clip.name}': ${clip.keyframes.length} keyframe(s) over ` +
      `${clip.frameCount} frame(s) at ${clip.fps}fps` +
      (warnings.length > 0 ? ` — ${warnings.join('; ')}` : '');

    const record = this._stageRecord(input, proposed.servedModel, message);
    const document = this._childRevision(input.document, clip, record, input);

    return {
      document,
      // No artifact: a clip lives inside the document, and recording one would put
      // an object in `artifactRefs` that no storage key points at.
      artifact: null,
      message,
      transport: 'motion-vision',
      servedModel: proposed.servedModel,
    };
  },
};
