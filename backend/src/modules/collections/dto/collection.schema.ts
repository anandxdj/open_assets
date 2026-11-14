import { z } from 'zod';
import { checkTags } from '../tags';

/**
 * Collection tags as an owner submits them: normalised to lowercase hyphenated
 * words, at most 5, each at most 24 characters (see ../tags.ts). The parsed value
 * is the normalised list, so the service stores exactly what the API accepted.
 */
export const tagsSchema = z
  .array(z.string().max(100, 'Each tag can be at most 24 characters'))
  .max(20, 'Use at most 5 tags')
  .transform((raw, ctx) => {
    const checked = checkTags(raw);
    if (!checked.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: checked.message });
      return z.NEVER;
    }
    return checked.tags;
  });

const folderTag = z.string().trim().min(1).max(40);

export const createCollectionSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  description: z.string().trim().max(2000).optional(),
  isPublic: z.boolean().optional().default(false),
  tags: tagsSchema.optional(),
});

export const updateCollectionSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  isPublic: z.boolean().optional(),
  tags: tagsSchema.optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const createFolderSchema = z.object({
  name: z.string().trim().min(1, 'Folder name is required').max(120),
  description: z.string().trim().max(2000).optional(),
  tags: z.array(folderTag).max(30).optional(),
});

/** Move one of the owner's collections into their team (`true`) or back out (`false`). */
export const shareCollectionSchema = z.object({ shared: z.boolean() });

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;
export type CreateFolderInput = z.infer<typeof createFolderSchema>;
