import os
import subprocess
import sys
import unittest
from pathlib import Path

os.environ["APP_ENV"] = "development"
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ.pop("SECRET_KEY", None)

from app import Student, Subject, Teacher, app, db


class ApplicationTests(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.client = app.test_client()
        with app.app_context():
            db.drop_all()
            db.create_all()
            teacher = Teacher(full_name="Profesora de prueba", email="profe@example.test")
            teacher.set_password("clave-segura")
            db.session.add(teacher)
            db.session.flush()
            subject = Subject(
                name="Matemáticas",
                specialty="Ciencias",
                group_name="1A",
                teacher_id=teacher.id,
            )
            db.session.add(subject)
            db.session.flush()
            student = Student(
                full_name="Alumno de prueba",
                student_number="1234",
                subject_id=subject.id,
            )
            db.session.add(student)
            db.session.commit()
            self.student_token = student.qr_token

    def tearDown(self):
        with app.app_context():
            db.session.remove()
            db.engine.dispose()

    def test_offline_data_requires_login_and_correct_password(self):
        response = self.client.post(
            "/api/offline-data", json={"password": "clave-segura"}
        )
        self.assertEqual(response.status_code, 302)

        response = self.client.post(
            "/login?next=https://example.invalid/",
            data={"email": "profe@example.test", "password": "clave-segura"},
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.location, "/dashboard")
        self.client.get("/logout")
        response = self.client.post(
            "/login?next=http://[invalid/",
            data={"email": "profe@example.test", "password": "clave-segura"},
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.location, "/dashboard")

        response = self.client.post(
            "/api/offline-data", json={"password": "incorrecta"}
        )
        self.assertEqual(response.status_code, 401)

        response = self.client.post(
            "/api/offline-data", json={"password": "clave-segura"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        payload = response.get_json()
        self.assertEqual(payload["subjects"][0]["students"][0]["qr_token"], self.student_token)
        self.assertNotIn("password", response.get_data(as_text=True))

    def test_pwa_shell_is_available(self):
        self.assertEqual(self.client.get("/offline").status_code, 200)
        self.assertEqual(self.client.get("/scan").status_code, 302)
        for path in ("/service-worker.js", "/static/manifest.webmanifest"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            response.close()

    def test_production_requires_secret_and_persistent_database(self):
        environment = os.environ.copy()
        environment["APP_ENV"] = "production"
        environment.pop("SECRET_KEY", None)
        environment.pop("DATABASE_URL", None)
        result = subprocess.run(
            [sys.executable, "-c", "import app"],
            cwd=Path(__file__).resolve().parents[1],
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SECRET_KEY, DATABASE_URL", result.stderr)


if __name__ == "__main__":
    unittest.main()
