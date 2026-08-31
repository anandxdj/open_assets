"""AniBuddy vision-facing stage support: the images a model may see, and the
bounded corrections it is allowed to send back.

Aggregator for the package (Rule 7). Import from here, not from the submodules,
so the internal layout can change without touching the router.

Where this sits in the pipeline
------------------------------
The vision *calls themselves* do not live here. They live in the Next route
handlers, beside the one provider-fallback chain (``callLlm``) and the one
credits helper (``resolveKeyAndCredits``) — forking either of those to give
py_backend its own copy is how a fallback chain acquires two behaviours.

What lives here is everything that is pixels or is geometry-adjacent:

* ``VisionService.annotate`` — the numbered-outline sheet the ``semantics`` call
  sees. Image work, so Python.
* ``VisionService.contact_sheet`` — frames the render stage really produced,
  tiled and labelled for the ``critique`` call. Image work, and it needs the
  renderer, so Python.
* ``CritiqueCorrections.apply`` — revalidate a ``CritiqueReport`` against the
  live document and write a child revision. Geometry-adjacent: the bounds are
  checked against real masks, parts and clips, and ``Diagnostics`` is
  server-authored (R5).

R2 and R3, restated because this is the module that could break them
-------------------------------------------------------------------
Nothing here calls an image model, and nothing here accepts geometry from one.
Every artwork pixel in both images is a resampled pixel of the user's own sheet,
and the only field through which a correction could carry a vertex does not
exist — the ``Correction`` schema is a closed set of bounded scalars and ids.
"""

from __future__ import annotations

from app.modules.anibuddy.vision.annotate import SheetAnnotator
from app.modules.anibuddy.vision.contact_sheet import (
    ContactSheet,
    frames_from_png_zip,
    pick_frame_indices,
)
from app.modules.anibuddy.vision.corrections import (
    CritiqueCorrections,
    clamp_or_reject,
)
from app.modules.anibuddy.vision.service import (
    VisionService,
    sheet_shape,
    to_data_url,
)
from app.modules.anibuddy.vision.types import (
    AnnotatedSheet,
    AppliedCorrection,
    ContactSheetResult,
    CorrectionOutcome,
    PartOutline,
    VisionError,
)

__all__ = [
    "AnnotatedSheet",
    "AppliedCorrection",
    "ContactSheet",
    "ContactSheetResult",
    "CorrectionOutcome",
    "CritiqueCorrections",
    "PartOutline",
    "SheetAnnotator",
    "VisionError",
    "VisionService",
    "clamp_or_reject",
    "frames_from_png_zip",
    "pick_frame_indices",
    "sheet_shape",
    "to_data_url",
]
