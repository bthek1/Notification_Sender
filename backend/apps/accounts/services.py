from django.contrib.auth import get_user_model

User = get_user_model()


def create_user(email: str, password: str, **kwargs) -> User:
    user = User(email=email, **kwargs)
    user.set_password(password)
    user.save()
    return user
