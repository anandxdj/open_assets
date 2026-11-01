/**
 * One-off, safe to run again: rewrites the `tags` of existing collections into
 * the stored form (lowercase, hyphenated, at most 24 characters, no duplicates),
 * so the community tag filter finds collections tagged before the rules existed.
 * Collections without tags and ones already in the right form are not touched.
 *
 *   pnpm --dir backend collections:normalize-tags            # apply
 *   pnpm --dir backend collections:normalize-tags --dry-run  # only report
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/common/config/db';
import { CollectionModel } from '../src/modules/collections/collection.model';
import { normalizeLegacyTags } from '../src/modules/collections/tags';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  await connectDB();
  try {
    const ops: Parameters<typeof CollectionModel.bulkWrite>[0] = [];
    let scanned = 0;
    for await (const doc of CollectionModel.find({ 'tags.0': { $exists: true } }).select('tags').lean().cursor()) {
      scanned += 1;
      const next = normalizeLegacyTags(doc.tags);
      if (next.length === doc.tags.length && next.every((t, i) => t === doc.tags[i])) continue;
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { tags: next } } } });
    }
    if (ops.length > 0 && !dryRun) await CollectionModel.bulkWrite(ops, { timestamps: false });
    console.log(`${scanned} tagged collections checked, ${ops.length} ${dryRun ? 'would be ' : ''}rewritten.`);
  } finally {
    await mongoose.disconnect();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
