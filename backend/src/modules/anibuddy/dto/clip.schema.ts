// Request envelope for the clip persistence routes.
//
// The body is a `Clip` and nothing larger. That is the whole reason this route
// can exist without breaking R5 and §7.8: there is no field on it through which
// a client could reach `diagnostics`, `parts`, `skeleton`, `provenance` or a
// deformer payload, so "the browser may not author geometry or the export gate"
// is enforced by the shape of the request rather than by a filter that has to
// remember every field.
//
// `source` is omitted for the same reason it is not simply optional: a clip
// arriving here was authored by a human in the editor, and `model` / `critique`
// name work the pipeline really did. The server stamps it.

import { AniBuddyRigDocumentDto } from './rig-document.generated';
import type { z } from 'zod';

export const writeAniBuddyClipSchema = AniBuddyRigDocumentDto.clip.omit({ source: true });

export type WriteAniBuddyClipInput = z.infer<typeof writeAniBuddyClipSchema>;
