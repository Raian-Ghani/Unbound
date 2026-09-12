import os
import re

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwYm9xcG5ndXByeXFxeGJoY3BxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTIxNDk1OCwiZXhwIjoyMTA0NzkwOTU4fQ.xVlFu5kVNCE3czn2eL7Khrci-Lapn3QAJqCg5iG2ukw"#os.environ["SUPABASE_SERVICE_KEY"]  # server-side key, never expose to the browser

print(SUPABASE_URL)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

VALID_AGE_GROUPS = {"18-24", "25-34", "35-44", "45-54", "55+"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/join", methods=["POST"])
def join():
    data = request.get_json(silent=True) or {}

    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    age_group = (data.get("age_group") or "").strip()
    interests = data.get("interests") or []

    if not name or not email or not age_group:
        return jsonify(error="Name, email, and age group are all required."), 400
    if not EMAIL_RE.match(email):
        return jsonify(error="That doesn't look like a valid email."), 400
    if age_group not in VALID_AGE_GROUPS:
        return jsonify(error="Pick a valid age group."), 400
    if not isinstance(interests, list):
        return jsonify(error="Interests should be a list of strings."), 400

    interests = [str(t).strip().lower() for t in interests if str(t).strip()]

    try:
        result = (
            supabase.table("waitlist_signups")
            .insert(
                {
                    "name": name,
                    "email": email,
                    "age_group": age_group,
                    "interests": interests,
                }
            )
            .execute()
        )
    except Exception as exc:  # supabase-py raises on unique-constraint violations etc.
        message = str(exc)
        if "duplicate key" in message.lower():
            return jsonify(error="That email is already on the waitlist."), 409
        app.logger.exception("Waitlist insert failed")
        return jsonify(error="Something went wrong on our end. Try again shortly."), 500

    return jsonify(status="ok", id=result.data[0]["id"]), 201


if __name__ == "__main__":
    app.run(debug=True)
