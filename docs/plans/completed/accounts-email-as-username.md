# Plan: Use Email as Username in Accounts App

**Status:** Complete  
**Date:** 2026-03-14  
**Completed:** 2026-03-14  

---

## Goal

Replace `username` with `email` as the primary login identifier across the `accounts` app.  
JWT authentication must continue to work without change to the token endpoints or response shapes.

---

## Background

`CustomUser` currently extends `AbstractUser`, which keeps Django's default `username` field and sets `USERNAME_FIELD = 'username'`.  
Email is stored separately and is *not* the login credential.  
This plan removes `username` entirely and promotes `email` to `USERNAME_FIELD`.

---

## Changes Required

### 1. `apps/accounts/models.py`

- Add a custom `UserManager` that creates users by email (no `username`).
- Remove inherited `username` field by setting `username = None`.
- Set `USERNAME_FIELD = "email"`.
- Set `REQUIRED_FIELDS = []` (email is already `USERNAME_FIELD`, so nothing extra).
- Add `email = models.EmailField(unique=True)` to enforce uniqueness at the DB level.

```python
import uuid

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models


class CustomUserManager(BaseUserManager):
    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("Email must be set")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        if not extra_fields["is_staff"]:
            raise ValueError("Superuser must have is_staff=True")
        if not extra_fields["is_superuser"]:
            raise ValueError("Superuser must have is_superuser=True")
        return self._create_user(email, password, **extra_fields)


class CustomUser(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Remove inherited username
    username = None
    email = models.EmailField(unique=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = CustomUserManager()

    def __str__(self):
        return self.email
```

---

### 2. `apps/accounts/services.py`

Remove the `username` parameter — `create_user` now only needs `email` and `password`.

```python
from django.contrib.auth import get_user_model

User = get_user_model()


def create_user(email: str, password: str, **kwargs) -> User:
    user = User(email=email, **kwargs)
    user.set_password(password)
    user.save()
    return user
```

---

### 3. `apps/accounts/serializers.py`

Remove `username` from both serializers.

```python
from django.contrib.auth import get_user_model
from rest_framework import serializers

User = get_user_model()


class UserRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ("id", "email", "password")

    def create(self, validated_data):
        from .services import create_user
        return create_user(**validated_data)


class UserDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "email", "first_name", "last_name", "date_joined")
        read_only_fields = ("id", "date_joined")
```

---

### 4. `apps/accounts/forms.py`

Remove `username` from both admin forms.

```python
from django.contrib.auth.forms import UserChangeForm, UserCreationForm

from .models import CustomUser


class CustomUserCreationForm(UserCreationForm):
    class Meta:
        model = CustomUser
        fields = ("email",)


class CustomUserChangeForm(UserChangeForm):
    class Meta:
        model = CustomUser
        fields = ("email",)
```

---

### 5. `apps/accounts/admin.py`

Register `CustomUser` with the custom forms so the Django admin works correctly.

```python
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .forms import CustomUserChangeForm, CustomUserCreationForm
from .models import CustomUser


@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    add_form = CustomUserCreationForm
    form = CustomUserChangeForm
    model = CustomUser

    list_display = ("email", "is_staff", "is_active")
    list_filter = ("is_staff", "is_active")
    ordering = ("email",)
    search_fields = ("email",)
```

---

### 6. Migration

After applying all model changes, generate and apply the migration:

```bash
just manage makemigrations accounts
just manage migrate
```

The migration must:
- Drop the `username` column.
- Add `unique=True` constraint to `email`.

> **Note:** If the database already contains data, back it up first. The migration is destructive for `username` values.

---

### 7. JWT — No Token Endpoint Changes Needed

`simplejwt`'s `TokenObtainPairView` reads `USERNAME_FIELD` from the user model automatically.  
Once `USERNAME_FIELD = "email"`, the `/api/token/` endpoint will accept `email` + `password` instead of `username` + `password` — no changes to `core/urls.py` or `SIMPLE_JWT` settings are required.

Token response shape remains identical:

```json
{
  "access": "<jwt>",
  "refresh": "<jwt>"
}
```

---

### 8. `apps/accounts/tests.py`

Replace all `username`-based test cases. Key areas to cover:

- **Model:** create user by email only, `str()` returns email, create superuser, duplicate email rejected.
- **Manager:** `create_user` without username, `create_superuser` sets flags.
- **Forms:** `CustomUserCreationForm` valid with email only; invalid on missing email, password mismatch.
- **Registration API:** `POST /api/accounts/register/` succeeds with `email` + `password`; fails on duplicate email, short password.
- **JWT obtain:** `POST /api/token/` with `email` + `password` returns tokens; fails with wrong password.
- **JWT refresh:** `POST /api/token/refresh/` with a valid refresh token returns a new access token.
- **Authenticated endpoint:** `GET /api/accounts/me/` with `Authorization: Bearer <token>` returns user data; `401` without token.

```python
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.accounts.forms import CustomUserChangeForm, CustomUserCreationForm

User = get_user_model()


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestCustomUserModel:
    def test_create_user_by_email(self):
        user = User.objects.create_user(email="alice@example.com", password="secret123")
        assert user.pk is not None
        assert user.email == "alice@example.com"
        assert user.is_active
        assert not user.is_staff
        assert not user.is_superuser

    def test_no_username_field(self):
        user = User.objects.create_user(email="b@example.com", password="pass1234")
        assert not hasattr(user, "username") or user.username is None

    def test_str_returns_email(self):
        user = User(email="c@example.com")
        assert str(user) == "c@example.com"

    def test_create_superuser(self):
        admin = User.objects.create_superuser(email="admin@example.com", password="adminpass")
        assert admin.is_staff
        assert admin.is_superuser

    def test_duplicate_email_raises(self):
        User.objects.create_user(email="dup@example.com", password="pass1234")
        with pytest.raises(Exception):
            User.objects.create_user(email="dup@example.com", password="other1234")

    def test_create_user_missing_email_raises(self):
        with pytest.raises(ValueError):
            User.objects.create_user(email="", password="pass1234")


# ---------------------------------------------------------------------------
# Forms
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestCustomUserCreationForm:
    def test_valid_form(self):
        form = CustomUserCreationForm(
            data={
                "email": "carol@example.com",
                "password1": "strongpass999",
                "password2": "strongpass999",
            }
        )
        assert form.is_valid(), form.errors

    def test_password_mismatch_invalid(self):
        form = CustomUserCreationForm(
            data={
                "email": "dave@example.com",
                "password1": "strongpass999",
                "password2": "differentpass",
            }
        )
        assert not form.is_valid()
        assert "password2" in form.errors

    def test_missing_email_invalid(self):
        form = CustomUserCreationForm(
            data={
                "email": "",
                "password1": "strongpass999",
                "password2": "strongpass999",
            }
        )
        assert not form.is_valid()
        assert "email" in form.errors


@pytest.mark.django_db
class TestCustomUserChangeForm:
    def test_valid_change(self):
        user = User.objects.create_user(email="eve@example.com", password="pass1234")
        form = CustomUserChangeForm(
            instance=user,
            data={"email": "eve_new@example.com"},
        )
        assert form.is_valid(), form.errors


# ---------------------------------------------------------------------------
# Registration API
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestRegisterView:
    def test_register_success(self):
        client = APIClient()
        payload = {"email": "new@example.com", "password": "strongpass1"}
        response = client.post("/api/accounts/register/", payload)
        assert response.status_code == 201
        assert response.data["email"] == "new@example.com"
        assert "password" not in response.data

    def test_register_duplicate_email(self):
        User.objects.create_user(email="taken@example.com", password="pass1234")
        client = APIClient()
        response = client.post(
            "/api/accounts/register/",
            {"email": "taken@example.com", "password": "strongpass1"},
        )
        assert response.status_code == 400

    def test_register_short_password(self):
        client = APIClient()
        response = client.post(
            "/api/accounts/register/",
            {"email": "short@example.com", "password": "abc"},
        )
        assert response.status_code == 400


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestJWT:
    def setup_method(self):
        self.user = User.objects.create_user(
            email="jwt@example.com", password="testpass99"
        )
        self.client = APIClient()

    def test_obtain_token_with_email(self):
        response = self.client.post(
            "/api/token/",
            {"email": "jwt@example.com", "password": "testpass99"},
        )
        assert response.status_code == 200
        assert "access" in response.data
        assert "refresh" in response.data

    def test_obtain_token_wrong_password(self):
        response = self.client.post(
            "/api/token/",
            {"email": "jwt@example.com", "password": "wrongpass"},
        )
        assert response.status_code == 401

    def test_refresh_token(self):
        obtain = self.client.post(
            "/api/token/",
            {"email": "jwt@example.com", "password": "testpass99"},
        )
        refresh = obtain.data["refresh"]
        response = self.client.post("/api/token/refresh/", {"refresh": refresh})
        assert response.status_code == 200
        assert "access" in response.data


# ---------------------------------------------------------------------------
# Authenticated endpoint
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestUserDetailView:
    def setup_method(self):
        self.user = User.objects.create_user(
            email="me@example.com", password="testpass99"
        )
        self.client = APIClient()

    def _get_access_token(self):
        response = self.client.post(
            "/api/token/",
            {"email": "me@example.com", "password": "testpass99"},
        )
        return response.data["access"]

    def test_me_authenticated(self):
        token = self._get_access_token()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/me/")
        assert response.status_code == 200
        assert response.data["email"] == "me@example.com"
        assert "username" not in response.data

    def test_me_unauthenticated(self):
        response = self.client.get("/api/accounts/me/")
        assert response.status_code == 401
```

---

## Implementation Order

1. ✅ Update `models.py` (add manager, remove username, set `USERNAME_FIELD`).
2. ✅ Update `services.py`.
3. ✅ Update `serializers.py`.
4. ✅ Update `forms.py`.
5. ✅ Update `admin.py` (includes `fieldsets` and `add_fieldsets` for email-only admin).
6. ✅ Generate and apply migration (`0002_alter_customuser_managers_remove_customuser_username_and_more.py`).
7. ✅ Replace `tests.py` with the new test suite.
8. Run `pytest` and confirm all tests pass.

---

## Rollback

If rollback is needed before deployment:
- Revert all source file changes via `git checkout`.
- Revert the migration: `just manage migrate accounts <previous-migration-number>`.
- Delete the generated migration file.

---

## Acceptance Criteria

- [x] `User.objects.create_user(email=..., password=...)` works without `username`.
- [x] `User.objects.create_superuser(email=..., password=...)` works.
- [x] `POST /api/token/` accepts `email` + `password` and returns JWT tokens.
- [x] `POST /api/accounts/register/` accepts `email` + `password` (no `username`).
- [x] `GET /api/accounts/me/` returns user data without `username` field.
- [x] All new pytest tests pass.
- [x] No `username` column exists in the `accounts_customuser` table.
