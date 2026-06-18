# JWT Auth Flow

This document explains how authentication works end-to-end across the frontend and backend.

---

## Token Types

The application uses two JWT tokens issued by `djangorestframework-simplejwt`:

| Token | Purpose | Lifetime |
|-------|---------|---------|
| **Access token** | Authorises API requests | Short-lived (default: 5 minutes) |
| **Refresh token** | Exchanges for a new access token | Long-lived (default: 1 day) |

---

## Login Flow

```
User submits login form
  │
  ▼
useLogin() mutation (src/hooks/useAuth.ts)
  │
  ▼
POST /api/token/  { email, password }
  │
  ▼  (credentials valid)
{ access, refresh }
  │
  ├─► localStorage.setItem('access_token', access)
  ├─► localStorage.setItem('refresh_token', refresh)
  └─► queryClient.invalidateQueries(queryKeys.auth.me)
        │
        ▼
      GET /api/accounts/me/  (with new access token)
        │
        ▼
      User profile cached in Query store
        │
        ▼
      Protected routes render
```

---

## Authenticated Request Flow

Every outgoing request goes through the Axios interceptor in `src/api/client.ts`:

```
API call (useQuery / useMutation)
  │
  ▼
Axios request interceptor
  ├─ reads access_token from localStorage
  └─ sets Authorization: Bearer <access_token> header
        │
        ▼
      Backend validates token signature and expiry
        │
        ├─ Valid → 200 + data
        └─ Expired / invalid → 401
```

---

## Silent Token Refresh (401 Retry)

When the backend returns `401`, the Axios response interceptor attempts a silent refresh before surfacing the error to the component:

```
401 response received
  │
  ├─ _retry flag already set? → reject (don't loop)
  │
  ▼
Read refresh_token from localStorage
  │
  ├─ No refresh token → clear storage, reject
  │
  ▼
POST /api/token/refresh/  { refresh }
  │
  ├─ Success →
  │     store new access_token
  │     retry original request with new token
  │     return response to caller (transparent to component)
  │
  └─ Failure →
        clear access_token and refresh_token from localStorage
        reject (component sees auth error, redirects to /login)
```

This retry happens **once per request** (`_retry` flag prevents infinite loops on persistent 401s).

---

## Logout Flow

```
useLogout() called
  │
  ├─ localStorage.removeItem('access_token')
  ├─ localStorage.removeItem('refresh_token')
  └─ queryClient.clear()  ← wipes all cached server state
        │
        ▼
      useMe() query becomes disabled (no token in storage)
        │
        ▼
      Protected route redirects to /login
```

There is no server-side token revocation — blacklisting refresh tokens would require a token blacklist store (e.g. Redis) and is not implemented. On logout, tokens are simply discarded client-side.

---

## Protected Routes

Routes that require authentication check for a token before rendering:

```ts
// src/routes/index.tsx (example pattern)
const { data: user } = useMe()

if (!user) {
  return <Navigate to="/login" />
}
```

`useMe()` is disabled when no `access_token` is in localStorage, so it never fires unauthenticated requests.

---

## Token Storage

Tokens are stored in `localStorage`. This is a deliberate trade-off:

- **Pro:** Survives page refresh without a round-trip to the server
- **Con:** Accessible to JavaScript (XSS risk)

Mitigation: the application must enforce a strong Content Security Policy in production to prevent XSS. If a higher security posture is required, tokens can be moved to `httpOnly` cookies (requires backend cookie handling changes).

---

## Backend Configuration (`SIMPLE_JWT`)

JWT settings are in `core/settings/base.py`. Defaults from `djangorestframework-simplejwt` apply unless overridden. Key settings to consider for production:

```python
from datetime import timedelta

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=5),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=1),
    "ROTATE_REFRESH_TOKENS": False,   # set True to issue new refresh on each refresh call
    "BLACKLIST_AFTER_ROTATION": False, # requires simplejwt blacklist app
}
```
