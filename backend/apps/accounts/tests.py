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

