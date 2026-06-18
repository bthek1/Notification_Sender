from django.urls import path

from .views import RegisterView, UserDetailView

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("me/", UserDetailView.as_view(), name="user-detail"),
]
