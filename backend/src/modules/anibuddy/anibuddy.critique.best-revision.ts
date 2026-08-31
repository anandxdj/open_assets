// Select the BEST revision the loop produced, not the last (F9 §11.6).
//
// This is the whole of non-convergence handling, and it is three tiers rather
// than one because each tier answers a different question:
//
// 1. **Lowest `maxStretch` among revisions with no flipped triangles and no
//    blocking reason.** The winner among revisions that are actually renderable.
//    `maxStretch` is the sigma_max/sigma_min metric carried verbatim in meaning
//    from v3's `lib/deform.ts`, and it is the one number that tracks "does the
//    artwork look smeared".
// 2. **The last revision with a null `blockingReason`.** Nothing was clean, but
//    something was exportable, and the most recent exportable revision has the
//    most corrections in it.
// 3. **Pass 0.** Nothing was exportable. The unreviewed rig is what the user
//    started with, and handing it back is honest.
//
// Taking the LAST revision instead would be the obvious implementation and is
// wrong for a specific reason: a critique pass can make a rig worse. Pass 2 may
// have nudged a pivot that pass 1 had right, and the loop stops on a pass cap
// rather than on convergence — so "last" is "whichever pass we happened to run
// out of budget on", which is not a quality signal at all.
//
// Pure, and deliberately so: it takes revisions and returns one of them, with no
// I/O and no clock. That is what makes the tier ordering testable directly rather
// than through a loop that has to be mocked.

import type {
  AniBuddyBestRevisionSelection,
  AniBuddyLoopRevision,
} from './anibuddy.critique.types';

export type AniBuddyBestRevision = {
  revision: AniBuddyLoopRevision;
  selection: AniBuddyBestRevisionSelection;
};

export const AniBuddyBestRevisionSelector = {
  /**
   * Pick the best revision. Throws only when handed an empty list, which the loop
   * cannot produce — pass 0 always exists.
   *
   * Only RENDERED revisions are candidates. A correction revision's `maxStretch`
   * and `flippedTriangles` are inherited from its parent rather than measured —
   * py_backend's applier carries them forward deliberately, because authoring a
   * 1.0 there would be a clean bill of health for frames nobody has drawn. Letting
   * an unmeasured revision compete in a measurement-based selection would let a
   * correction win on numbers that describe the render before it. Corrections stay
   * in the returned chain so the editor can diff them; they are just not eligible
   * to be called "best".
   */
  select(revisions: readonly AniBuddyLoopRevision[]): AniBuddyBestRevision {
    if (revisions.length === 0) {
      throw new Error('selectBestRevision needs at least the pass-0 revision.');
    }

    const measured = revisions.filter((candidate) => candidate.origin === 'render');
    if (measured.length === 0) {
      throw new Error('selectBestRevision needs at least one rendered revision.');
    }

    const clean = measured.filter(
      (candidate) =>
        candidate.diagnostics.flippedTriangles === 0 &&
        candidate.diagnostics.blockingReason === null,
    );

    if (clean.length > 0) {
      // Ties go to the EARLIER revision: fewer corrections applied for the same
      // measured quality is the simpler rig, and a correction that changed nothing
      // measurable should not win on recency.
      let best = clean[0]!;
      for (const candidate of clean.slice(1)) {
        if (candidate.diagnostics.maxStretch < best.diagnostics.maxStretch) best = candidate;
      }
      return { revision: best, selection: 'lowest-stretch-clean' };
    }

    for (let index = measured.length - 1; index >= 0; index -= 1) {
      if (measured[index]!.diagnostics.blockingReason === null) {
        return { revision: measured[index]!, selection: 'last-unblocked' };
      }
    }

    const passZero = measured.find((candidate) => candidate.passIndex === 0) ?? measured[0]!;
    return { revision: passZero, selection: 'pass-zero' };
  },

  /** One sentence naming why this revision won, for the progress line. */
  describe(best: AniBuddyBestRevision, stopReason: string): string {
    const pass = best.revision.passIndex;
    switch (best.selection) {
      case 'lowest-stretch-clean':
        return (
          `The critique loop stopped (${stopReason}) and pass ${pass} was kept: it had the ` +
          `least distortion (peak stretch ${best.revision.diagnostics.maxStretch.toFixed(2)}) ` +
          'among the passes that rendered cleanly.'
        );
      case 'last-unblocked':
        return (
          `The critique loop stopped (${stopReason}) without a clean pass. Pass ${pass} was kept ` +
          'because it is the most recent one that can still be exported; check the flagged parts.'
        );
      case 'pass-zero':
        return (
          `The critique loop stopped (${stopReason}) and no pass produced an exportable rig, ` +
          'so the original unreviewed rig was kept. The lowest-confidence parts need a look.'
        );
    }
  },
};
