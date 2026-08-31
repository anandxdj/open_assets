"""Thin loader over schemas/anibuddy/archetype-priors.v1.json.

Priors are DATA — role tables and topology expectations — not architecture.
The semantics / rig stages will call ``ArchetypePriors``; nothing here builds
a skeleton.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Final, Mapping

# Mirrors ArchetypePriorsConstants in the TS loaders (Rule 9).
_FILE_NAME: Final[str] = "archetype-priors.v1.json"
_RELATIVE_PATH: Final[str] = "schemas/anibuddy/archetype-priors.v1.json"
_VERSION: Final[int] = 1
_FALLBACK_DEFORMER: Final[str] = "rigid"

_ARCHETYPE_IDS: Final[tuple[str, ...]] = (
    "humanoid",
    "creature",
    "mechanical",
    "prop",
    "environment",
    "ui",
)

# Named attachment points offered by host parts (Slot.name).
SLOT: Final[Mapping[str, str]] = {
    "NECK": "neck",
    "SHOULDER_L": "shoulder_l",
    "SHOULDER_R": "shoulder_r",
    "HIP_L": "hip_l",
    "HIP_R": "hip_r",
    "CAPE": "cape",
    "FACE": "face",
    "HAIR": "hair",
    "EAR_L": "ear_l",
    "EAR_R": "ear_r",
    "GRIP": "grip",
    "WRIST": "wrist",
    "ANKLE": "ankle",
    "TAIL_BASE": "tail_base",
    "WING_L": "wing_l",
    "WING_R": "wing_r",
    "LEG_FL": "leg_fl",
    "LEG_FR": "leg_fr",
    "LEG_RL": "leg_rl",
    "LEG_RR": "leg_rr",
    "HORN": "horn",
    "SNOUT": "snout",
    "PAW": "paw",
    "TENTACLE": "tentacle",
    "AXLE_FL": "axle_fl",
    "AXLE_FR": "axle_fr",
    "AXLE_RL": "axle_rl",
    "AXLE_RR": "axle_rr",
    "TURRET_MOUNT": "turret_mount",
    "BARREL": "barrel",
    "HATCH": "hatch",
    "ROTOR": "rotor",
    "THRUSTER": "thruster",
    "ANTENNA": "antenna",
    "TRACK_L": "track_l",
    "TRACK_R": "track_r",
    "PISTON": "piston",
    "MUZZLE": "muzzle",
    "EFFECT": "effect",
    "MARK": "mark",
    "TEXT": "text",
    "UNDERLAY": "underlay",
    "BADGE": "badge",
}


def _resolve_priors_path(start: Path) -> Path:
    """Walk parents until schemas/anibuddy/<file> appears."""
    dir_path = start.resolve()
    if dir_path.is_file():
        dir_path = dir_path.parent
    for _ in range(12):
        candidate = dir_path / _RELATIVE_PATH
        if candidate.is_file():
            return candidate
        parent = dir_path.parent
        if parent == dir_path:
            break
        dir_path = parent
    raise FileNotFoundError(
        f"AniBuddy archetype priors not found (expected {_RELATIVE_PATH} "
        f"under a parent of {start})"
    )


@lru_cache(maxsize=1)
def _load_raw() -> dict[str, Any]:
    path = _resolve_priors_path(Path(__file__))
    with path.open(encoding="utf-8") as handle:
        raw: dict[str, Any] = json.load(handle)
    if raw.get("version") != _VERSION:
        raise ValueError(
            f"Archetype priors version mismatch: got {raw.get('version')}, "
            f"expected {_VERSION}"
        )
    archetypes = raw.get("archetypes") or {}
    for archetype_id in _ARCHETYPE_IDS:
        if archetype_id not in archetypes:
            raise ValueError(f'Archetype priors missing entry for "{archetype_id}"')
    fallback = raw.get("fallbackDeformer")
    if fallback not in ("rigid", "mesh", "lattice", "spline"):
        raise ValueError(f"Invalid fallbackDeformer: {fallback}")
    return raw


class ArchetypePriors:
    """Read-only accessors over the canonical archetype prior tables.

    Prefer these over scattering role/deformer string literals at call sites.
    """

    FILE_NAME: Final[str] = _FILE_NAME
    RELATIVE_PATH: Final[str] = _RELATIVE_PATH
    VERSION: Final[int] = _VERSION
    FALLBACK_DEFORMER: Final[str] = _FALLBACK_DEFORMER
    SLOT: Final[Mapping[str, str]] = SLOT

    @classmethod
    def resolve_path(cls) -> Path:
        """Absolute path of the JSON that was loaded."""
        return _resolve_priors_path(Path(__file__))

    @classmethod
    def get_document(cls) -> Mapping[str, Any]:
        """Full document (all six archetypes)."""
        return _load_raw()

    @classmethod
    def get(cls, archetype: str) -> Mapping[str, Any]:
        """Prior table for one archetype. Raises on unknown id."""
        prior = cls.get_document()["archetypes"].get(archetype)
        if prior is None:
            raise KeyError(f"Unknown archetype: {archetype}")
        return prior

    @classmethod
    def part_roles(cls, archetype: str) -> list[str]:
        """Closed part-role vocabulary for an archetype."""
        return list(cls.get(archetype)["partRoles"])

    @classmethod
    def joint_roles(cls, archetype: str) -> list[str]:
        """Closed joint-role vocabulary for an archetype."""
        return list(cls.get(archetype)["jointRoles"])

    @classmethod
    def default_deformer(cls, archetype: str, role: str) -> str:
        """Default deformer for a part role; falls back to rigid."""
        mapped = cls.get(archetype)["defaultDeformerByPartRole"].get(role)
        if mapped is None:
            return str(cls.get_document()["fallbackDeformer"])
        return str(mapped)

    @classmethod
    def attach_slots(cls, archetype: str) -> list[Mapping[str, Any]]:
        """Attach-slot conventions for the cutout tree."""
        return list(cls.get(archetype)["attachSlots"])

    @classmethod
    def ik_chain_length(cls, archetype: str, joint_role: str) -> int | None:
        """IK chain length prior for a joint role, or None when FK-only."""
        value = cls.get(archetype)["ikDefaultsByJointRole"].get(joint_role)
        return None if value is None else int(value)

    @classmethod
    def is_part_role_allowed(cls, archetype: str, role: str) -> bool:
        return role in cls.get(archetype)["partRoles"]

    @classmethod
    def is_joint_role_allowed(cls, archetype: str, role: str) -> bool:
        return role in cls.get(archetype)["jointRoles"]

    @classmethod
    def list_ids(cls) -> tuple[str, ...]:
        """All six archetype ids, in schema order."""
        return _ARCHETYPE_IDS
