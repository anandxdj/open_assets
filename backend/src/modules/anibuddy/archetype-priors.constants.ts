// Central names for the archetype-priors contract (Rule 9).
// Call sites must import from here — never re-type the filename or slot
// strings inline.

export const ArchetypePriorsConstants = Object.freeze({
  /** Filename under schemas/anibuddy/. */
  FILE_NAME: 'archetype-priors.v1.json',
  /** Relative path from the repo root. */
  RELATIVE_PATH: 'schemas/anibuddy/archetype-priors.v1.json',
  /** Document version of the priors JSON. */
  VERSION: 1,
  /** Safe downgrade when a role has no table entry. */
  FALLBACK_DEFORMER: 'rigid' as const,

  /** Named attachment points offered by host parts (Slot.name). */
  SLOT: Object.freeze({
    NECK: 'neck',
    SHOULDER_L: 'shoulder_l',
    SHOULDER_R: 'shoulder_r',
    HIP_L: 'hip_l',
    HIP_R: 'hip_r',
    CAPE: 'cape',
    FACE: 'face',
    HAIR: 'hair',
    EAR_L: 'ear_l',
    EAR_R: 'ear_r',
    GRIP: 'grip',
    WRIST: 'wrist',
    ANKLE: 'ankle',
    TAIL_BASE: 'tail_base',
    WING_L: 'wing_l',
    WING_R: 'wing_r',
    LEG_FL: 'leg_fl',
    LEG_FR: 'leg_fr',
    LEG_RL: 'leg_rl',
    LEG_RR: 'leg_rr',
    HORN: 'horn',
    SNOUT: 'snout',
    PAW: 'paw',
    TENTACLE: 'tentacle',
    AXLE_FL: 'axle_fl',
    AXLE_FR: 'axle_fr',
    AXLE_RL: 'axle_rl',
    AXLE_RR: 'axle_rr',
    TURRET_MOUNT: 'turret_mount',
    BARREL: 'barrel',
    HATCH: 'hatch',
    ROTOR: 'rotor',
    THRUSTER: 'thruster',
    ANTENNA: 'antenna',
    TRACK_L: 'track_l',
    TRACK_R: 'track_r',
    PISTON: 'piston',
    MUZZLE: 'muzzle',
    EFFECT: 'effect',
    MARK: 'mark',
    TEXT: 'text',
    UNDERLAY: 'underlay',
    BADGE: 'badge',
  }),
});
