# API Contracts

All endpoints are prefixed with `/api/`. Authentication uses JWT Bearer tokens unless noted as public.

---

## Authentication

### `POST /api/token/`

Obtain a JWT access + refresh token pair.

**Auth:** Public

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "string"
}
```

**Response `200`:**
```json
{
  "access": "<jwt_access_token>",
  "refresh": "<jwt_refresh_token>"
}
```

**Errors:** `401` — invalid credentials

---

### `POST /api/token/refresh/`

Exchange a valid refresh token for a new access token.

**Auth:** Public

**Request body:**
```json
{
  "refresh": "<jwt_refresh_token>"
}
```

**Response `200`:**
```json
{
  "access": "<new_jwt_access_token>"
}
```

**Errors:** `401` — refresh token invalid or expired

---

## Accounts

### `POST /api/accounts/register/`

Create a new user account.

**Auth:** Public

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "string (min 8 chars)"
}
```

**Response `201`:**
```json
{
  "id": "<uuid>",
  "email": "user@example.com"
}
```

**Errors:** `400` — validation error (duplicate email, weak password)

---

### `GET /api/accounts/me/`

Retrieve the authenticated user's profile.

**Auth:** Bearer token required

**Response `200`:**
```json
{
  "id": "<uuid>",
  "email": "user@example.com",
  "first_name": "string",
  "last_name": "string",
  "date_joined": "2026-01-01T00:00:00Z"
}
```

**Errors:** `401` — missing or invalid token

---

### `PATCH /api/accounts/me/`

Update the authenticated user's profile fields.

**Auth:** Bearer token required

**Request body** (all fields optional):
```json
{
  "first_name": "string",
  "last_name": "string",
  "email": "user@example.com"
}
```

**Response `200`:** Updated user object (same shape as `GET /api/accounts/me/`)

**Errors:** `400` — validation error, `401` — unauthorised

---

## Health

### `GET /api/health/`

Service liveness check.

**Auth:** Public

**Response `200`:**
```json
{
  "status": "ok"
}
```

---

## Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | OK — request succeeded |
| `201` | Created — resource created |
| `400` | Bad Request — validation error |
| `401` | Unauthorised — missing or invalid JWT |
| `403` | Forbidden — authenticated but insufficient permissions |
| `404` | Not Found |
| `500` | Internal Server Error |

---

## Request Headers

All authenticated requests must include:

```
Authorization: Bearer <access_token>
Content-Type: application/json
```

---

## Model Notes

- All primary keys are UUIDs (`uuid4`)
- Timestamps are ISO 8601 in UTC
- `CustomUser` extends Django's `AbstractUser` — `email` is the login identifier (no `username` field)
