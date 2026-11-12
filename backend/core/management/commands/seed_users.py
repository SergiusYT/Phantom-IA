"""Crea los roles y usuarios de demostracion.

  python manage.py seed_users --admin-password X --viewer-password Y
"""
import os

from django.contrib.auth.models import Group, User
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Crea los grupos 'operador'/'observador' y los usuarios de demostracion"

    def add_arguments(self, parser):
        parser.add_argument("--admin-password", default=os.environ.get("PHANTOM_ADMIN_PASSWORD", "phantom-admin"))
        parser.add_argument("--viewer-password", default=os.environ.get("PHANTOM_VIEWER_PASSWORD", "phantom-viewer"))

    def handle(self, *args, **opts):
        op, _ = Group.objects.get_or_create(name="operador")
        obs, _ = Group.objects.get_or_create(name="observador")
        for username, pwd, group, staff in (("admin", opts["admin_password"], op, True),
                                            ("observador", opts["viewer_password"], obs, False)):
            u, created = User.objects.get_or_create(username=username)
            u.set_password(pwd)
            u.is_staff = u.is_superuser = staff
            u.save()
            u.groups.set([group])
            self.stdout.write(f"{'creado' if created else 'actualizado'}: {username} ({group.name})")
