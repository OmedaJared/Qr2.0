import os
import io
import secrets
import uuid
from functools import wraps
from urllib.parse import urlsplit

import qrcode
from flask import (
    Flask, render_template, request, redirect, url_for,
    session, flash, send_file, send_from_directory, abort, jsonify
)
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.middleware.proxy_fix import ProxyFix

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
INSTANCE_DIR = os.path.join(BASE_DIR, "instance")
os.makedirs(INSTANCE_DIR, exist_ok=True)

app = Flask(__name__)
APP_ENV = os.environ.get("APP_ENV", "development").lower()
SECRET_KEY = os.environ.get("SECRET_KEY")
DATABASE_URL = os.environ.get("DATABASE_URL")

if APP_ENV == "production":
    missing_settings = [
        name for name, value in (
            ("SECRET_KEY", SECRET_KEY),
            ("DATABASE_URL", DATABASE_URL),
        ) if not value
    ]
    if missing_settings:
        raise RuntimeError(
            "Faltan variables de entorno obligatorias para producción: "
            + ", ".join(missing_settings)
        )

if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL.removeprefix("postgres://")
if DATABASE_URL and DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace(
        "postgresql://", "postgresql+psycopg://", 1
    )

app.config["SECRET_KEY"] = SECRET_KEY or secrets.token_hex(32)
app.config["SQLALCHEMY_DATABASE_URI"] = DATABASE_URL or (
    "sqlite:///" + os.path.join(INSTANCE_DIR, "qr_profesores.db")
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = APP_ENV == "production"

db = SQLAlchemy(app)
if APP_ENV == "production":
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)


class Teacher(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(160), nullable=False)
    email = db.Column(db.String(160), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    subjects = db.relationship("Subject", backref="teacher", cascade="all, delete-orphan")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Subject(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    specialty = db.Column(db.String(160), nullable=False)
    group_name = db.Column(db.String(80), nullable=False)
    teacher_id = db.Column(db.Integer, db.ForeignKey("teacher.id"), nullable=False)
    students = db.relationship("Student", backref="subject", cascade="all, delete-orphan")


class Student(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    qr_token = db.Column(db.String(64), unique=True, nullable=False, default=lambda: uuid.uuid4().hex)
    full_name = db.Column(db.String(160), nullable=False)
    student_number = db.Column(db.String(80), nullable=True)
    subject_id = db.Column(db.Integer, db.ForeignKey("subject.id"), nullable=False)
    assignments = db.relationship("Assignment", backref="student", cascade="all, delete-orphan")


class Assignment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(180), nullable=False)
    description = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(40), nullable=False, default="Pendiente")
    grade = db.Column(db.String(30), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    student_id = db.Column(db.Integer, db.ForeignKey("student.id"), nullable=False)


def current_teacher():
    teacher_id = session.get("teacher_id")
    return db.session.get(Teacher, teacher_id) if teacher_id else None


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not current_teacher():
            flash("Inicia sesión para continuar.", "warning")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


@app.context_processor
def inject_teacher():
    return {"current_teacher": current_teacher()}


@app.route("/")
def index():
    if current_teacher():
        return redirect(url_for("dashboard"))
    return render_template("index.html")


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        full_name = request.form.get("full_name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        if not full_name or not email or not password:
            flash("Completa todos los campos.", "danger")
            return render_template("register.html")
        if len(password) < 6:
            flash("La contraseña debe tener al menos 6 caracteres.", "danger")
            return render_template("register.html")
        if Teacher.query.filter_by(email=email).first():
            flash("Ese correo ya está registrado.", "danger")
            return render_template("register.html")

        teacher = Teacher(full_name=full_name, email=email)
        teacher.set_password(password)
        db.session.add(teacher)
        db.session.commit()
        session["teacher_id"] = teacher.id
        flash("Cuenta creada correctamente.", "success")
        return redirect(url_for("dashboard"))

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        teacher = Teacher.query.filter_by(email=email).first()

        if not teacher or not teacher.check_password(password):
            flash("Correo o contraseña incorrectos.", "danger")
            return render_template("login.html")

        session["teacher_id"] = teacher.id
        next_url = request.args.get("next")
        if next_url:
            try:
                target = urlsplit(next_url)
            except ValueError:
                target = None
            if target and not target.scheme and not target.netloc \
                    and target.path.startswith("/") and not target.path.startswith("//") \
                    and "\\" not in next_url \
                    and not any(ord(character) < 32 or ord(character) == 127 for character in next_url):
                return redirect(next_url)
        return redirect(url_for("dashboard"))

    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))


@app.route("/dashboard")
@login_required
def dashboard():
    teacher = current_teacher()
    return render_template("dashboard.html", subjects=teacher.subjects)


@app.route("/subjects/new", methods=["GET", "POST"])
@login_required
def subject_new():
    if request.method == "POST":
        subject = Subject(
            name=request.form.get("name", "").strip(),
            specialty=request.form.get("specialty", "").strip(),
            group_name=request.form.get("group_name", "").strip(),
            teacher_id=current_teacher().id,
        )
        if not all([subject.name, subject.specialty, subject.group_name]):
            flash("Completa todos los campos.", "danger")
            return render_template("subject_form.html", subject=None)
        db.session.add(subject)
        db.session.commit()
        return redirect(url_for("subject_detail", subject_id=subject.id))
    return render_template("subject_form.html", subject=None)


@app.route("/subjects/<int:subject_id>")
@login_required
def subject_detail(subject_id):
    subject = db.session.get(Subject, subject_id)
    if not subject or subject.teacher_id != current_teacher().id:
        abort(404)
    return render_template("subject_detail.html", subject=subject)


@app.route("/subjects/<int:subject_id>/students/new", methods=["GET", "POST"])
@login_required
def student_new(subject_id):
    subject = db.session.get(Subject, subject_id)
    if not subject or subject.teacher_id != current_teacher().id:
        abort(404)

    if request.method == "POST":
        student = Student(
            full_name=request.form.get("full_name", "").strip(),
            student_number=request.form.get("student_number", "").strip() or None,
            subject_id=subject.id,
        )
        if not student.full_name:
            flash("Escribe el nombre del alumno.", "danger")
            return render_template("student_form.html", subject=subject)
        db.session.add(student)
        db.session.commit()
        return redirect(url_for("student_detail", student_id=student.id))

    return render_template("student_form.html", subject=subject)


@app.route("/students/<int:student_id>")
@login_required
def student_detail(student_id):
    student = db.session.get(Student, student_id)
    if not student or student.subject.teacher_id != current_teacher().id:
        abort(404)
    return render_template("student_detail.html", student=student)


@app.route("/students/<int:student_id>/qr.png")
@login_required
def student_qr(student_id):
    student = db.session.get(Student, student_id)
    if not student or student.subject.teacher_id != current_teacher().id:
        abort(404)

    target = url_for("student_public", token=student.qr_token, _external=True)
    qr = qrcode.make(target)
    output = io.BytesIO()
    qr.save(output, format="PNG")
    output.seek(0)
    return send_file(output, mimetype="image/png", download_name=f"qr-{student.id}.png")


@app.route("/students/<int:student_id>/print")
@login_required
def student_print(student_id):
    student = db.session.get(Student, student_id)
    if not student or student.subject.teacher_id != current_teacher().id:
        abort(404)
    return render_template("print_card.html", student=student)


@app.route("/scan")
@login_required
def scanner():
    return render_template("scanner.html")


@app.route("/offline")
def offline():
    return render_template("offline.html")


@app.route("/service-worker.js")
def service_worker():
    response = send_from_directory(
        app.static_folder, "service-worker.js", mimetype="application/javascript"
    )
    response.headers["Service-Worker-Allowed"] = "/"
    return response


@app.route("/api/offline-data", methods=["POST"])
@login_required
def offline_data():
    payload = request.get_json()
    password = payload.get("password") if isinstance(payload, dict) else None
    teacher = current_teacher()

    if not isinstance(password, str) or not teacher.check_password(password):
        return jsonify(error="La contraseña no es correcta."), 401

    subjects = []
    for subject in teacher.subjects:
        subjects.append({
            "id": subject.id,
            "name": subject.name,
            "specialty": subject.specialty,
            "group_name": subject.group_name,
            "students": [{
                "id": student.id,
                "full_name": student.full_name,
                "student_number": student.student_number,
                "qr_token": student.qr_token,
            } for student in subject.students],
        })

    response = jsonify({
        "teacher_name": teacher.full_name,
        "subjects": subjects,
    })
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/s/<token>")
def student_public(token):
    student = Student.query.filter_by(qr_token=token).first_or_404()
    return render_template("scan_result.html", student=student)


@app.route("/students/<int:student_id>/assignments/new", methods=["GET", "POST"])
@login_required
def assignment_new(student_id):
    student = db.session.get(Student, student_id)
    if not student or student.subject.teacher_id != current_teacher().id:
        abort(404)

    if request.method == "POST":
        assignment = Assignment(
            title=request.form.get("title", "").strip(),
            description=request.form.get("description", "").strip(),
            status=request.form.get("status", "Pendiente"),
            grade=request.form.get("grade", "").strip(),
            notes=request.form.get("notes", "").strip(),
            student_id=student.id,
        )
        if not assignment.title:
            flash("Escribe un título.", "danger")
            return render_template("assignment_form.html", student=student)
        db.session.add(assignment)
        db.session.commit()
        return redirect(url_for("student_detail", student_id=student.id))

    return render_template("assignment_form.html", student=student)


@app.route("/assignments/<int:assignment_id>/edit", methods=["GET", "POST"])
@login_required
def assignment_edit(assignment_id):
    assignment = db.session.get(Assignment, assignment_id)
    if not assignment or assignment.student.subject.teacher_id != current_teacher().id:
        abort(404)

    if request.method == "POST":
        assignment.title = request.form.get("title", "").strip()
        assignment.description = request.form.get("description", "").strip()
        assignment.status = request.form.get("status", "Pendiente")
        assignment.grade = request.form.get("grade", "").strip()
        assignment.notes = request.form.get("notes", "").strip()
        db.session.commit()
        return redirect(url_for("student_detail", student_id=assignment.student_id))

    return render_template("assignment_form.html", student=assignment.student, assignment=assignment)


@app.route("/profile", methods=["GET", "POST"])
@login_required
def profile():
    teacher = current_teacher()
    if request.method == "POST":
        teacher.full_name = request.form.get("full_name", "").strip() or teacher.full_name
        db.session.commit()
        flash("Perfil actualizado.", "success")
    return render_template("profile.html", teacher=teacher)


with app.app_context():
    db.create_all()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=APP_ENV != "production")
