"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../components/icons";
import { getCurrentSession, onAuthStateChange, setPassword, signOut } from "../../lib/auth-service";
import { getMyProfile } from "../../lib/employee-service";

type Status = "loading" | "ready" | "error" | "saving";

export default function WelcomePage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [fullName, setFullName] = useState<string | null>(null);
  const [password, setPasswordValue] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function checkSession() {
      const session = await getCurrentSession();
      if (!active || !session) return;
      const profile = await getMyProfile().catch(() => null);
      if (!active) return;
      setFullName(profile?.fullName ?? null);
      setStatus("ready");
    }

    checkSession();
    const unsubscribe = onAuthStateChange(() => checkSession());
    const timeout = setTimeout(() => {
      if (active) setStatus((s) => (s === "loading" ? "error" : s));
    }, 4000);

    return () => {
      active = false;
      unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setStatus("saving");
    try {
      await setPassword(password);
      const profile = await getMyProfile();
      const isAdminRole = profile?.role === "manager" || profile?.role === "hr_admin";
      router.replace(isAdminRole ? "/admin" : "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't set your password.");
      setStatus("ready");
    }
  }

  if (status === "loading") {
    return (
      <main className="shell centered">
        <img src="/icon.png" alt="" className="brand-mark large" />
        <Icon name="spinner" size={22} className="spin muted-icon" />
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="shell centered">
        <Icon name="warning" size={40} className="warn-icon" />
        <h1>Invite link invalid</h1>
        <p className="muted center">This invite link is invalid or has expired. Ask HR to resend your invite from Balkania Admin.</p>
        <button className="secondary-button" onClick={() => signOut()}>Sign out</button>
      </main>
    );
  }

  return (
    <main className="shell centered login">
      <img src="/icon.png" alt="" className="brand-mark large" />
      <h1>Welcome{fullName ? `, ${fullName.split(" ")[0]}` : ""}</h1>
      <p className="muted center">Set a password to finish setting up your account.</p>

      <form className="login-form" onSubmit={handleSubmit}>
        <label>
          <span>Create a password</span>
          <div className="input-with-icon">
            <Icon name="lock" size={17} />
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPasswordValue(e.target.value)}
              placeholder="••••••••"
              disabled={status === "saving"}
            />
          </div>
        </label>
        <label>
          <span>Confirm password</span>
          <div className="input-with-icon">
            <Icon name="lock" size={17} />
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              disabled={status === "saving"}
            />
          </div>
        </label>
        {error && <p className="form-error"><Icon name="warning" size={15} />{error}</p>}
        <button className="primary-button" type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Setting password…" : "Set password & continue"}
        </button>
      </form>
    </main>
  );
}
