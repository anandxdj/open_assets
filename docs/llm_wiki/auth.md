# Auth Module

**STATUS: COMPLETE. DO NOT MODIFY.**

Location: `backend/src/modules/auth/`

## Endpoints

| Method | Path | Auth Required | Description |
|---|---|---|---|
| POST | /api/auth/register | No | Email + password registration |
| POST | /api/auth/login | No | Returns access token + sets refresh cookie |
| POST | /api/auth/refresh-token | No (cookie) | Returns new access token |
| POST | /api/auth/logout | Yes | Invalidates refresh token |
| GET | /api/auth/verify-email/:token | No | Email verification |
| POST | /api/auth/resend-verification | No | Resend verification email |
| POST | /api/auth/forgot-password | No | Sends reset email |
| PUT | /api/auth/reset-password/:token | No | Resets password |
| GET | /api/auth/me | Yes | Returns current user |
| GET | /api/auth/google | No | Redirects to Google OAuth |
| GET | /api/auth/google/callback | No | OAuth callback, issues tokens |

## MongoDB Schema (`auth.model.ts`)

```typescript
{
  email: string (unique, required)
  name: string (required)
  password: string (bcrypt, optional for OAuth users)
  sub: string (Google OAuth subject ID, optional)
  picture: string (profile image URL, optional)
  role: 'user' | 'admin' (default: 'user')
  isVerified: boolean (default: false)
  tokens: {
    refresh: string[]    // active refresh tokens
    reset: string        // hashed reset token
    resetExpiry: Date
    verification: string // hashed verification token
    verificationExpiry: Date
  }
  lastLogin: Date
}
```

Pre-save hook: auto-hashes password with bcryptjs (salt 12) when `password` field is modified.

## JWT

- **Access token**: 15 min, Bearer header (`Authorization: Bearer <token>`)
- **Refresh token**: 7 days, httpOnly cookie (`refreshToken`)
- Secrets from `ACCESS_TOKEN_SECRET` and `REFRESH_TOKEN_SECRET` env vars

## Middleware

`authenticate(optional?: boolean)` — validates JWT from Bearer header or cookie. Attaches `req.user` on success.
`authorize(...roles)` — checks `req.user.role` against allowed roles.

Usage:
```typescript
router.get('/protected', authenticate(), authorize('admin'), handler)
router.get('/optional-auth', authenticate(true), handler)
```

## Email Service (`common/config/email.ts`)

Uses **Resend** SDK. Two templates:
- `sendVerificationEmail(to, name, token)` — styled HTML email with verification link
- `sendResetPasswordEmail(to, name, token)` — password reset link, 15-min expiry

Falls back to `console.log` when `RESEND_API_KEY` is not set (dev mode).

## Files

```
src/modules/auth/
  auth.model.ts       Mongoose schema + methods
  auth.service.ts     Business logic (308 lines)
  auth.controller.ts  HTTP handlers (146 lines)
  auth.middleware.ts  authenticate() + authorize()
  auth.route.ts       Router with all 11 routes
  dto/
    register.schema.ts   Zod: name(2-50), email, password(8+, uppercase+digit), role
    login.schema.ts      Zod: email, password
    forgot-password.schema.ts
    reset-password.schema.ts
```

## Google OAuth Flow

1. `GET /api/auth/google` → redirect to Google consent page
2. `GET /api/auth/google/callback` → exchange code → upsert user → issue tokens
3. Frontend receives tokens via redirect query params or postMessage (see `app.ts` bridge route)
