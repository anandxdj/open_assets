"""Structured-output schema for asset naming.

Gemini-flavoured JSON Schema (uppercase type names). Both providers speak the
native Gemini `generateContent` wire format, so this is sent verbatim to each —
no per-provider translation.
"""

RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "collection_name": {"type": "STRING"},
        "collection_tags": {"type": "ARRAY", "items": {"type": "STRING"}},
        "folders": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING"},
                    "tags": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": ["name"],
            },
        },
        "assets": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "systematic": {"type": "STRING"},
                    "name": {"type": "STRING"},
                    "folder": {"type": "STRING"},
                    "tags": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "description": {"type": "STRING"},
                    "dominant_colors": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": ["systematic", "name"],
            },
        },
    },
    "required": ["collection_name", "collection_tags", "folders", "assets"],
}
