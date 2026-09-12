import os
import re

from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

VALID_AGE_GROUPS = {"18-24", "25-34", "35-44", "45-54", "55+"}
VALID_PLATFORMS = {"discord", "instagram", "linkedin", "x", "reddit"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

app = Flask(__name__)
app.secret_key = os.environ["FLASK_SECRET_KEY"]  # required for signed session cookies
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("FLASK_ENV") == "production",
)

# ---- Supabase clients -------------------------------------------------
# Admin client: service-role key, bypasses RLS. It is used only for server-side
# account lifecycle work and the pre-account waitlist insert.
_admin_client: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def get_admin_client() -> Client:
    return _admin_client


def get_user_client() -> Client | None:
    """
    Per-request client scoped to the logged-in user. Uses the anon key plus
    the user's own access token, so Postgres RLS policies (auth.uid() = ...)
    do the access-control work instead of Flask's route logic.
    Returns None if nobody is logged in.
    """
    access_token = session.get("access_token")
    if not access_token:
        return None

    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    client.postgrest.auth(access_token)
    return client


def current_user():
    return session.get("user")


# ---- Pages --------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html", user=current_user())


@app.route("/profile")
def profile_page():
    if current_user() is None:
        return redirect(url_for("index", _anchor="login"))
    return render_template("profile.html", user=current_user())


# ---- Auth -----------------------------------------------------------------
@app.route("/signup", methods=["POST"])
def signup():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    name = (data.get("name") or "").strip()
    age_group = (data.get("age_group") or "").strip()
    interests = data.get("interests") or []

    if not EMAIL_RE.match(email) or len(password) < 8:
        return jsonify(error="Enter a valid email and an 8+ character password."), 400
    if not name or age_group not in VALID_AGE_GROUPS:
        return jsonify(error="Name and a valid age group are required."), 400
    if not isinstance(interests, list):
        return jsonify(error="Interests should be a list of strings."), 400

    interests = [str(tag).strip().lower() for tag in interests if str(tag).strip()]

    anon_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    try:
        result = anon_client.auth.sign_up({"email": email, "password": password})
    except Exception as exc:
        return jsonify(error=str(exc)), 400

    try:
        _save_profile(result.user.id, name, age_group, interests)
    except Exception:
        app.logger.exception("Profile creation failed after signup")
        return jsonify(error="Your account was created, but we could not save your profile. Please try again."), 500

    if result.session is None:
        # Email confirmation is required before a session is issued.
        return jsonify(status="check_email"), 201

    _store_session(result)
    return jsonify(status="ok", user_id=result.user.id), 201


@app.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    anon_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    try:
        result = anon_client.auth.sign_in_with_password({"email": email, "password": password})
    except Exception:
        return jsonify(error="Incorrect email or password."), 401

    _store_session(result)
    return jsonify(status="ok", user_id=result.user.id)


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify(status="ok")


@app.route("/api/account", methods=["DELETE"])
def delete_account():
    user = current_user()
    if user is None or not session.get("access_token"):
        return jsonify(error="Not logged in."), 401

    try:
        get_admin_client().auth.admin.delete_user(user["id"])
    except Exception:
        app.logger.exception("Account deletion failed")
        return jsonify(error="We could not delete your account. Please try again."), 500

    session.clear()
    return jsonify(status="ok")


def _store_session(auth_result):
    session["access_token"] = auth_result.session.access_token
    session["refresh_token"] = auth_result.session.refresh_token
    session["user"] = {"id": auth_result.user.id, "email": auth_result.user.email}


def _save_profile(user_id, name, age_group, interests):
    admin_client = get_admin_client()
    admin_client.table("profiles").upsert(
        {"id": user_id, "name": name, "age_group": age_group, "bio": None}
    ).execute()

    admin_client.table("interests").delete().eq("profile_id", user_id).execute()
    if interests:
        admin_client.table("interests").insert(
            [{"profile_id": user_id, "tag": tag, "category": "hobby"} for tag in interests]
        ).execute()


# ---- Waitlist (no account required) ---------------------------------------
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
            get_admin_client()
            .table("waitlist_signups")
            .insert({"name": name, "email": email, "age_group": age_group, "interests": interests})
            .execute()
        )
    except Exception as exc:
        message = str(exc)
        if "duplicate key" in message.lower():
            return jsonify(error="That email is already on the waitlist."), 409
        app.logger.exception("Waitlist insert failed")
        return jsonify(error="Something went wrong on our end. Try again shortly."), 500

    return jsonify(status="ok", id=result.data[0]["id"]), 201


# ---- Example authenticated route: profile ---------------------------------
# Demonstrates the user-scoped client — RLS decides what this can see/write,
# not this function. A user can never fetch someone else's profile here,
# even if the route had a bug, because the DB itself refuses the query.
@app.route("/api/profile", methods=["GET"])
def get_profile():
    client = get_user_client()
    if client is None:
        return jsonify(error="Not logged in."), 401

    user = current_user()
    profile = client.table("profiles").select("*").eq("id", user["id"]).single().execute()
    interests = (
        client.table("interests")
        .select("id, tag, category, created_at")
        .eq("profile_id", user["id"])
        .order("created_at")
        .execute()
    )
    linked_accounts = (
        client.table("linked_accounts")
        .select("id, provider, provider_user_id, created_at")
        .eq("profile_id", user["id"])
        .order("created_at")
        .execute()
    )
    return jsonify({
        "email": user["email"],
        "profile": profile.data,
        "interests": interests.data,
        "linked_accounts": linked_accounts.data,
    })


@app.route("/api/linked-accounts", methods=["POST"])
def add_linked_account():
    client = get_user_client()
    if client is None:
        return jsonify(error="Not logged in."), 401

    data = request.get_json(silent=True) or {}
    provider = (data.get("provider") or "").strip().lower()
    handle = (data.get("handle") or "").strip()
    if provider not in VALID_PLATFORMS or not handle or len(handle) > 120:
        return jsonify(error="Choose a platform and enter a valid handle."), 400

    try:
        result = client.table("linked_accounts").upsert(
            {
                "profile_id": current_user()["id"],
                "provider": provider,
                "provider_user_id": handle,
            },
            on_conflict="profile_id,provider",
        ).execute()
    except Exception:
        app.logger.exception("Linked account save failed")
        return jsonify(error="We could not save that platform connection."), 500

    return jsonify(account=result.data[0]), 201


@app.route("/api/linked-accounts/<int:account_id>", methods=["DELETE"])
def remove_linked_account(account_id):
    client = get_user_client()
    if client is None:
        return jsonify(error="Not logged in."), 401

    client.table("linked_accounts").delete().eq("id", account_id).eq(
        "profile_id", current_user()["id"]
    ).execute()
    return jsonify(status="ok")


@app.route("/api/matches", methods=["GET"])
def get_matches():
    client = get_user_client()
    if client is None:
        return jsonify(error="Not logged in."), 401

    user_id = current_user()["id"]
    profiles = (
        client.table("profiles")
        .select("id, name, age_group, bio")
        .neq("id", user_id)
        .execute()
    )
    interests = client.table("interests").select("profile_id, tag").execute()
    return jsonify({"profiles": profiles.data, "interests": interests.data})


@app.route("/api/profile", methods=["POST"])
def create_or_update_profile():
    client = get_user_client()
    if client is None:
        return jsonify(error="Not logged in."), 401

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    age_group = (data.get("age_group") or "").strip()
    bio = data.get("bio")

    if not name or age_group not in VALID_AGE_GROUPS:
        return jsonify(error="Name and a valid age group are required."), 400

    user = current_user()
    result = (
        client.table("profiles")
        .upsert({"id": user["id"], "name": name, "age_group": age_group, "bio": bio})
        .execute()
    )
    return jsonify(status="ok", profile=result.data[0])


if __name__ == "__main__":
    app.run(debug=True)