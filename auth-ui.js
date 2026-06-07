/* =========================================================
 * auth-ui.js — sign-in modal.
 *
 * Uses the existing modal.js shell, so the look & behavior (ESC/backdrop
 * close, focus management) matches drill / recognition / timer.
 *
 * Exports:
 *   openSignIn()          → show the email + Google sign-in modal
 * ========================================================= */

import * as modal from "./modal.js";
import * as auth from "./auth.js";

export function openSignIn() {
  if (!auth.isCloudEnabled()) {
    modal.open({
      title: "Sign in",
      body: notConfiguredBody(),
    });
    return;
  }

  const body = document.createElement("div");
  body.className = "auth-body";

  // Intro copy
  const intro = document.createElement("p");
  intro.className = "auth-intro";
  intro.textContent = "Sign in to sync your drill stats and timer solves across devices. Your local data stays on this device too.";
  body.appendChild(intro);

  // ----- Email magic link -----
  const emailSection = document.createElement("div");
  emailSection.className = "auth-section";

  const emailLabel = document.createElement("label");
  emailLabel.className = "auth-label";
  emailLabel.htmlFor = "auth-email";
  emailLabel.textContent = "Email";
  emailSection.appendChild(emailLabel);

  const emailInput = document.createElement("input");
  emailInput.id = "auth-email";
  emailInput.type = "email";
  emailInput.className = "auth-input";
  emailInput.placeholder = "you@example.com";
  emailInput.autocomplete = "email";
  emailSection.appendChild(emailInput);

  const emailBtn = document.createElement("button");
  emailBtn.type = "button";
  emailBtn.className = "btn auth-btn-primary";
  emailBtn.textContent = "Email me a sign-in link";
  emailSection.appendChild(emailBtn);

  const emailStatus = document.createElement("div");
  emailStatus.className = "auth-status";
  emailSection.appendChild(emailStatus);

  emailBtn.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    if (!email || !email.includes("@")) {
      emailStatus.textContent = "Enter a valid email address.";
      emailStatus.className = "auth-status auth-status-error";
      return;
    }
    emailBtn.disabled = true;
    emailBtn.textContent = "Sending…";
    emailStatus.textContent = "";
    emailStatus.className = "auth-status";
    const res = await auth.signInWithMagicLink(email);
    emailBtn.disabled = false;
    emailBtn.textContent = "Email me a sign-in link";
    if (res.ok) {
      emailStatus.textContent = `Check ${email} for a sign-in link. You can close this dialog — clicking the link will log you in.`;
      emailStatus.className = "auth-status auth-status-ok";
    } else {
      emailStatus.textContent = res.error || "Could not send link. Try again in a moment.";
      emailStatus.className = "auth-status auth-status-error";
    }
  });

  emailInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") emailBtn.click();
  });

  body.appendChild(emailSection);

  // ----- Divider -----
  const divider = document.createElement("div");
  divider.className = "auth-divider";
  divider.innerHTML = "<span>or</span>";
  body.appendChild(divider);

  // ----- Google -----
  const googleBtn = document.createElement("button");
  googleBtn.type = "button";
  googleBtn.className = "btn auth-btn-google";
  googleBtn.innerHTML = googleLogoSvg() + "<span>Continue with Google</span>";
  googleBtn.addEventListener("click", async () => {
    googleBtn.disabled = true;
    const res = await auth.signInWithGoogle();
    if (!res.ok) {
      googleBtn.disabled = false;
      emailStatus.textContent = res.error || "Google sign-in failed.";
      emailStatus.className = "auth-status auth-status-error";
    }
    // On success the page will redirect, so we don't re-enable the button.
  });
  body.appendChild(googleBtn);

  modal.open({ title: "Sign in", body });
  setTimeout(() => emailInput.focus(), 0);
}

function notConfiguredBody() {
  const body = document.createElement("div");
  body.className = "auth-body";
  body.innerHTML = `
    <p class="auth-intro">Cloud sync isn't configured yet.</p>
    <p class="auth-status">
      Open <code>supabase-config.js</code> and paste your Supabase project URL and anon key.
      Step-by-step instructions are in <code>SETUP.md</code>.
    </p>
  `;
  return body;
}

/* Google "G" logo as inline SVG so it works offline. */
function googleLogoSvg() {
  return `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
    <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
  </svg>`;
}
