import { z } from 'zod';

const tag = z.string().trim().min(1).max(40);

export const createCollectionSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  description: z.string().trim().max(2000).optional(),
  isPublic: z.boolean().optional().default(false),
  tags: z.array(tag).max(30).optional(),
});

export const updateCollectionSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  isPublic: z.boolean().optional(),
  tags: z.array(tag).max(30).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const createFolderSchema = z.object({
  name: z.string().trim().min(1, 'Folder name is required').max(120),
  description: z.string().trim().max(2000).optional(),
  tags: z.array(tag).max(30).optional(),
});

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;
export type CreateFolderInput = z.infer<typeof createFolderSchema>;
