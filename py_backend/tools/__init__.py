"""Developer scripts. Not imported by the service at runtime.

Everything here is allowed to touch the filesystem, which is precisely why it
lives outside ``app/modules/anibuddy/kernel/`` -- that package is pure math and
stays that way.
"""
