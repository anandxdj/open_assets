// Request/response envelopes for the AniBuddy gateway routes.
// RigDocument wire types live in the generated sibling; do not re-declare them.

import { z } from 'zod';
import { AniBuddyConstants } from '../anibuddy.constants';
import { ANIBUDDY_LIMITS, AniBuddyRigDocumentDto } from './rig-document.generated';

const assetInputSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
    name: z.string().min(1).max(200),
    storageKey: z.string().min(1).max(512),
    /** Optional CDN / signed URL so Python can fetch the sheet for real stages. */
    sourceUrl: z.string().url().optional(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
    mimeType: z.enum(['image/png', 'image/webp', 'image/jpeg']),
    rightsConfirmed: z.boolean(),
    remoteVisionConsented: z.boolean().default(false),
  })
  .strict();

export const createAniBuddyProjectSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    archetype: AniBuddyRigDocumentDto.archetype.default('humanoid'),
    asset: assetInputSchema,
    /** When true (default), enqueue the decompose stub immediately after create. */
    enqueueDecompose: z.boolean().default(true),
  })
  .strict();

const partIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);

/**
 * What a `rig` enqueue may say about the deformers.
 *
 * A user looking at the artwork outranks the archetype prior's table (F9 §9), so
 * a per-part override is a first-class request rather than a debug switch. It is
 * the only thing this route accepts about the rig: vertices, weights and control
 * points are server-authored (R5), and there is no field here through which one
 * could arrive.
 */
const rigOptionsSchema = z
  .object({
    deformerOverrides: z
      .record(partIdSchema, AniBuddyRigDocumentDto.deformerKind)
      .refine((value) => Object.keys(value).length <= ANIBUDDY_LIMITS.MAX_PARTS, {
        message: `A document holds at most ${ANIBUDDY_LIMITS.MAX_PARTS} parts, so no more than that many deformer overrides can resolve.`,
      })
      .optional(),
  })
  .strict();

/**
 * What a `render` enqueue may say about the output.
 *
 * `format` and `background` are checked against the same tables py_backend
 * refuses on, so an unknown value costs nothing: the request fails before credits
 * are consumed rather than as a 422 the user has already paid for.
 *
 * Every sizing and sampling field is optional, and absent means "take it from the
 * clip" — which is where F9 §7.7 puts `fps` and `frameCount`. An override is a
 * request to sample the same motion differently, not a contradiction of the
 * document.
 */
const renderOptionsSchema = z
  .object({
    /** Null (or absent) renders a single still at rest, which is the rig thumbnail. */
    clipId: partIdSchema.optional(),
    format: z.enum(AniBuddyConstants.render.formats).optional(),
    fps: z.number().int().min(1).max(ANIBUDDY_LIMITS.MAX_FPS).optional(),
    frameCount: z.number().int().min(1).max(ANIBUDDY_LIMITS.MAX_FRAMES).optional(),
    /** Both must be given for either to apply; otherwise `maxEdge` fits the aspect. */
    width: z.number().int().min(1).max(ANIBUDDY_LIMITS.MAX_SOURCE_EDGE).optional(),
    height: z.number().int().min(1).max(ANIBUDDY_LIMITS.MAX_SOURCE_EDGE).optional(),
    maxEdge: z.number().int().min(1).max(ANIBUDDY_LIMITS.MAX_SOURCE_EDGE).optional(),
    background: z.enum(AniBuddyConstants.render.backgrounds).optional(),
    loop: z.boolean().optional(),
  })
  .strict();

/**
 * What an `animate` enqueue may say about the motion.
 *
 * `request` is the whole input: the stage's work is a vision call over the rig's
 * real ids plus this sentence, and the keyframes come back bounded by the schema.
 * There is no field here through which a keyframe could be sent — a client that
 * wants to author one uses the clip routes, which stamp `source: 'edited'` rather
 * than claiming a model wrote it.
 */
const animateOptionsSchema = z
  .object({
    request: z.string().trim().min(1).max(AniBuddyConstants.animate.maxRequestLength),
    /**
     * Which clip the proposal lands on. Absent names it from the proposal itself,
     * so a first animate does not need the user to invent an id; naming an existing
     * clip REPLACES it, which is how a re-animate of the same motion works.
     */
    clipId: partIdSchema.optional(),
  })
  .strict();

export const enqueueAniBuddyStageSchema = z
  .object({
    stage: z.enum(AniBuddyConstants.queuedStages),
    units: z.number().int().min(1).max(20).optional(),
    rig: rigOptionsSchema.optional(),
    render: renderOptionsSchema.optional(),
    animate: animateOptionsSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Refused here rather than inside the worker, because the worker has already
    // consumed the credits by the time it can look: `anibuddy-animate` is the most
    // expensive op in the table (6 credits per clip), and an enqueue with nothing to
    // animate can only ever end in a refund.
    if (value.stage === 'animate' && !value.animate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['animate'],
        message:
          'The animate stage needs a motion to propose. Send `animate.request` describing it.',
      });
    }
  });

/**
 * The critique loop's own enqueue.
 *
 * Separate from the stage enqueue because the loop is not a stage: it bills per
 * pass rather than once up front, so this route must NOT pre-authorize anything —
 * the ceiling is checked before each pass and the refund table is per failure class
 * (F9 §11.6). A `units` field here would be a charge nobody could attribute.
 */
export const enqueueAniBuddyCritiqueSchema = z
  .object({
    /**
     * Which clip to review. Absent takes the document's first clip; explicit null
     * is "the rig at rest", which is a legitimate thing to critique — a bad pivot is
     * visible in one still.
     */
    clipId: partIdSchema.nullable().optional(),
    /** Credits already spent on this project's loop, when resuming one. */
    creditsAlreadySpent: z
      .number()
      .int()
      .min(0)
      .max(ANIBUDDY_LIMITS.CRITIQUE_CREDIT_CEILING)
      .optional(),
    /** First pass to run. 1 unless resuming; pass 0 is the unreviewed rig. */
    startPassIndex: z
      .number()
      .int()
      .min(1)
      .max(ANIBUDDY_LIMITS.MAX_CRITIQUE_PASSES)
      .optional(),
  })
  .strict();

/**
 * The internal annotate request Next posts to this gateway.
 *
 * The sheet arrives as base64 rather than as a storage key: Next was handed the
 * bytes by the browser and forwards exactly those, so the image the model is shown
 * is the image the user is looking at. Reading the key instead would silently
 * annotate a different revision's pixels when the two disagree.
 */
export const annotateAniBuddySheetSchema = z
  .object({
    document: AniBuddyRigDocumentDto.rigDocument,
    sheetBase64: z.string().min(1),
    maxEdge: z.number().int().min(64).max(4096).optional(),
  })
  .strict();

export type CreateAniBuddyProjectInput = z.infer<typeof createAniBuddyProjectSchema>;
export type EnqueueAniBuddyStageInput = z.infer<typeof enqueueAniBuddyStageSchema>;
export type EnqueueAniBuddyCritiqueInput = z.infer<typeof enqueueAniBuddyCritiqueSchema>;
export type AnnotateAniBuddySheetInput = z.infer<typeof annotateAniBuddySheetSchema>;
export type AniBuddyRigOptions = z.infer<typeof rigOptionsSchema>;
export type AniBuddyRenderOptions = z.infer<typeof renderOptionsSchema>;
export type AniBuddyAnimateOptions = z.infer<typeof animateOptionsSchema>;
export type AniBuddyAssetInput = z.infer<typeof assetInputSchema>;
