#!/usr/bin/env python3
import base64
import json
import os
import re
import smtplib
import subprocess
import sys
import time
from email.message import EmailMessage
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
SIGN_DIR = ROOT / "semnaturi"
SIGN_DIR.mkdir(exist_ok=True)

with open(PUBLIC / "config.json", encoding="utf-8") as f:
    CONFIG = json.load(f)
_secrets = ROOT / "config.json"
if _secrets.exists():
    with open(_secrets, encoding="utf-8") as f:
        extra = json.load(f)
    for key, value in extra.items():
        if value not in (None, ""):
            CONFIG[key] = value

PIN_GAZDA = os.environ.get("PIN_GAZDA", str(CONFIG.get("pinGazda", "2468")))
PORT = int(os.environ.get("PORT", CONFIG.get("port", 3000)))
EMAIL_TO = (os.environ.get("EMAIL_TO") or CONFIG.get("emailTo") or "iuga.darius@icloud.com").strip()
SAFE_NAME = re.compile(r"[^a-zA-Z0-9._-]+")


def json_bytes(obj, status=200):
    return status, "application/json; charset=utf-8", json.dumps(obj, ensure_ascii=False).encode(
        "utf-8"
    )


def safe_filename(name):
    name = Path(name).name
    if not name.endswith(".pdf") or ".." in name:
        return None
    return name


def smtp_password():
    env = os.environ.get("SMTP_PASSWORD", "").strip()
    if env:
        return env
    cfg = str(CONFIG.get("smtpPassword") or "").strip()
    if cfg:
        return cfg
    secret = ROOT / "smtp-password.txt"
    if secret.exists():
        return secret.read_text(encoding="utf-8").strip()
    return ""


def _as_escape(text):
    return (
        str(text)
        .replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
    )


def send_via_mail_app(to, subject, body, pdf_path):
    script = """
set theFile to POSIX file "%s"
tell application "Mail"
    set theMessage to make new outgoing message with properties {subject:"%s", content:"%s", visible:false}
    tell theMessage
        make new to recipient at end of to recipients with properties {address:"%s"}
        make new attachment with properties {file name:theFile} at after the last paragraph
        send
    end tell
end tell
""" % (
        _as_escape(str(pdf_path.resolve())),
        _as_escape(subject),
        _as_escape(body + "\n"),
        _as_escape(to),
    )
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
        timeout=40,
    )
    if result.returncode != 0:
        err = (result.stderr or result.stdout or "Mail.app a refuzat trimiterea").strip()
        raise RuntimeError(err)


def send_via_smtp(to, subject, body, pdf_path, pdf_bytes):
    password = smtp_password()
    if not password:
        raise RuntimeError("Lipsește parola SMTP (smtp-password.txt sau SMTP_PASSWORD).")
    host = CONFIG.get("smtpHost") or "smtp.mail.me.com"
    port = int(CONFIG.get("smtpPort") or 587)
    user = CONFIG.get("smtpUser") or to
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = user
    msg["To"] = to
    msg.set_content(body)
    msg.add_attachment(
        pdf_bytes,
        maintype="application",
        subtype="pdf",
        filename=pdf_path.name,
    )
    with smtplib.SMTP(host, port, timeout=25) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.ehlo()
        smtp.login(user, password)
        smtp.send_message(msg)


def send_agreement_email(apt_name, guest_name, pdf_path, pdf_bytes):
    subject = "Acord regulament — %s — %s" % (apt_name, guest_name)
    body = (
        "Un oaspete a semnat regulamentul.\n\n"
        "Apartament: %s\n"
        "Nume: %s\n"
        "Fișier: %s\n"
    ) % (apt_name, guest_name, pdf_path.name)
    last_error = None
    password = smtp_password()
    if password:
        try:
            send_via_smtp(EMAIL_TO, subject, body, pdf_path, pdf_bytes)
            return True, None
        except Exception as err:
            last_error = str(err)
            print("SMTP email failed:", err, flush=True)
    if sys.platform == "darwin":
        try:
            send_via_mail_app(EMAIL_TO, subject, body, pdf_path)
            return True, None
        except Exception as err:
            last_error = str(err)
            print("Mail.app email failed:", err, flush=True)
    return False, last_error or "Nu am putut trimite emailul."


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def _body(self):
        n = int(self.headers.get("Content-Length", "0") or 0)
        return self.rfile.read(n)

    def _send(self, status, content_type, body, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _pin_ok(self):
        pin = self.headers.get("X-Pin") or ""
        qs = parse_qs(urlparse(self.path).query)
        if not pin:
            pin = (qs.get("pin") or [""])[0]
        return pin == PIN_GAZDA

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/config":
            status, ctype, body = json_bytes(
                {
                    "hostName": CONFIG["hostName"],
                    "apartments": CONFIG["apartments"],
                    "rules": CONFIG["rules"],
                }
            )
            return self._send(status, ctype, body)
        if path == "/api/acorduri":
            if not self._pin_ok():
                status, ctype, body = json_bytes({"error": "PIN greșit."}, 401)
                return self._send(status, ctype, body)
            files = []
            for p in sorted(SIGN_DIR.glob("*.pdf"), key=lambda x: x.stat().st_mtime, reverse=True):
                st = p.stat()
                files.append(
                    {
                        "fileName": p.name,
                        "size": st.st_size,
                        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(st.st_mtime)),
                    }
                )
            status, ctype, body = json_bytes({"files": files})
            return self._send(status, ctype, body)
        if path.startswith("/api/descarca/"):
            name = safe_filename(unquote(path.split("/api/descarca/", 1)[1]))
            if not name:
                return self._send(404, "text/plain; charset=utf-8", "Fișier inexistent.".encode("utf-8"))
            fp = SIGN_DIR / name
            if not fp.exists():
                return self._send(404, "text/plain; charset=utf-8", "Fișier inexistent.".encode("utf-8"))
            data = fp.read_bytes()
            return self._send(
                200,
                "application/pdf",
                data,
                {"Content-Disposition": 'attachment; filename="%s"' % name},
            )
        if path == "/admin":
            html = (PUBLIC / "admin.html").read_bytes()
            return self._send(200, "text/html; charset=utf-8", html)
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/api/semneaza":
            return self._send(404, "application/json", b'{"error":"Not found"}')
        try:
            payload = json.loads(self._body().decode("utf-8"))
        except Exception:
            status, ctype, body = json_bytes({"error": "Date invalide."}, 400)
            return self._send(status, ctype, body)

        apartment_id = payload.get("apartmentId")
        guest = payload.get("guest") or {}
        pdf_b64 = payload.get("pdf") or ""
        apt = next((a for a in CONFIG["apartments"] if a["id"] == apartment_id), None)
        full_name = str(guest.get("fullName") or "").strip()
        if not apt:
            status, ctype, body = json_bytes({"error": "Alegeți un apartament."}, 400)
            return self._send(status, ctype, body)
        if len(full_name) < 3:
            status, ctype, body = json_bytes({"error": "Introduceți numele complet."}, 400)
            return self._send(status, ctype, body)
        cnp = re.sub(r"\s+", "", str(guest.get("cnp") or ""))
        serie_ci = re.sub(r"\s+", "", str(guest.get("serieCi") or "")).upper()
        if not re.fullmatch(r"\d{13}", cnp):
            status, ctype, body = json_bytes({"error": "CNP-ul trebuie să aibă exact 13 cifre."}, 400)
            return self._send(status, ctype, body)
        if not re.fullmatch(r"[A-Z]{2}\d{6}", serie_ci):
            status, ctype, body = json_bytes(
                {"error": "Seria CI trebuie să aibă 2 litere și 6 cifre."}, 400
            )
            return self._send(status, ctype, body)
        if not str(pdf_b64).startswith("data:application/pdf;base64,"):
            status, ctype, body = json_bytes({"error": "PDF-ul lipsește."}, 400)
            return self._send(status, ctype, body)

        raw = base64.b64decode(pdf_b64.split(",", 1)[1])
        if not raw.startswith(b"%PDF"):
            status, ctype, body = json_bytes({"error": "PDF invalid."}, 400)
            return self._send(status, ctype, body)

        slug = SAFE_NAME.sub("-", full_name)[:40] or "oaspete"
        stamp = time.strftime("%Y-%m-%dT%H-%M-%S")
        file_name = "%s_%s_%s.pdf" % (stamp, apt["id"], slug)
        pdf_path = SIGN_DIR / file_name
        pdf_path.write_bytes(raw)
        emailed, email_error = send_agreement_email(apt["name"], full_name, pdf_path, raw)
        status, ctype, body = json_bytes(
            {
                "ok": True,
                "fileName": file_name,
                "downloadUrl": "api/descarca/" + file_name,
                "emailSent": emailed,
                "emailTo": EMAIL_TO,
                "emailError": email_error,
            }
        )
        return self._send(status, ctype, body)


if __name__ == "__main__":
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("%s — http://localhost:%s" % (CONFIG["hostName"], PORT), flush=True)
    print("Arhiva gazdei — http://localhost:%s/admin" % PORT, flush=True)
    print("PIN gazdă: %s" % PIN_GAZDA, flush=True)
    print("Email acorduri: %s" % EMAIL_TO, flush=True)
    httpd.serve_forever()
