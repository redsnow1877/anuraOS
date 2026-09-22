/**
 * Aether — lock screen
 * ---------------------------------------------------------------------------
 * Ctrl+Alt+L, Spotlight, the brand menu, a hot corner, or inactivity.
 *
 * A large clock over the blurred wallpaper. Any key or click unlocks — or,
 * if a passcode is set, reveals the passcode field. The passcode is stored
 * only as a SHA-256 digest, but this is a privacy screen, not a security
 * boundary: everything runs client-side, and Settings says so.
 *
 * Inactivity is measured across the whole system, including inside app
 * windows. Apps are iframes and their input never reaches the shell, so
 * without listening inside each same-origin frame, someone typing in the
 * Text Editor would look idle and get locked out mid-sentence.
 */

class AetherLockScreen {
	static readonly PIN_KEY = "aether.lock.pin";
	static readonly IDLE_KEY = "aether.lock.idleMinutes";

	static locked = false;
	static #el: HTMLElement | null = null;
	static #clock: HTMLElement | null = null;
	static #date: HTMLElement | null = null;
	static #hint: HTMLElement | null = null;
	static #pinWrap: HTMLElement | null = null;
	static #pinInput: HTMLInputElement | null = null;
	static #tick = 0;
	static #lastActivity = Date.now();
	static #watched = new WeakSet<Window>();

	/* ---- passcode ------------------------------------------------------ */

	static async digest(pin: string): Promise<string> {
		const bytes = new TextEncoder().encode("aether-lock:" + pin);
		const hash = await crypto.subtle.digest("SHA-256", bytes);
		return Array.from(new Uint8Array(hash))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}

	static get hasPin(): boolean {
		try {
			return !!anura.settings.get(this.PIN_KEY);
		} catch {
			return false;
		}
	}

	static async setPin(pin: string | null) {
		await anura.settings.set(this.PIN_KEY, pin ? await this.digest(pin) : "");
	}

	/* ---- lock / unlock ------------------------------------------------- */

	static lock() {
		if (this.locked) return;
		this.locked = true;
		try {
			AetherMissionControl?.exit?.();
			AetherSpotlight?.instance?.close();
			launcher?.hide?.();
			quickSettings?.close?.();
			calendar?.close?.();
		} catch {
			/* optional pieces */
		}
		(globalThis as any).AetherShortcuts.suspended = true;
		this.#build();
		this.#render();
		this.#tick = window.setInterval(() => this.#render(), 1000);
		document.body.classList.add("aether-locked");
		requestAnimationFrame(() => {
			this.#el?.classList.add("is-shown");
			// Pull focus out of whatever app had it, so typing can't reach it.
			(document.activeElement as HTMLElement | null)?.blur?.();
			this.#el?.focus();
		});
		(globalThis as any).aetherSound?.play?.("close");
	}

	static async #attemptUnlock() {
		if (!this.hasPin) return this.#unlock();
		if (!this.#pinWrap?.classList.contains("is-shown")) {
			this.#pinWrap?.classList.add("is-shown");
			this.#hint!.textContent = "Enter passcode";
			setTimeout(() => this.#pinInput?.focus(), 30);
			return;
		}
		const value = this.#pinInput?.value || "";
		if (!value) return;
		const ok = (await this.digest(value)) === anura.settings.get(this.PIN_KEY);
		if (ok) return this.#unlock();
		this.#pinInput!.value = "";
		this.#pinWrap?.classList.remove("shake");
		void this.#pinWrap?.offsetWidth;
		this.#pinWrap?.classList.add("shake");
		this.#hint!.textContent = "Incorrect passcode";
		(globalThis as any).aetherSound?.play?.("error");
	}

	static #unlock() {
		if (!this.locked) return;
		this.locked = false;
		clearInterval(this.#tick);
		(globalThis as any).AetherShortcuts.suspended = false;
		const el = this.#el;
		el?.classList.remove("is-shown");
		el?.classList.add("is-leaving");
		document.body.classList.remove("aether-locked");
		(globalThis as any).aetherSound?.play?.("open");
		this.#lastActivity = Date.now();
		setTimeout(() => {
			el?.remove();
			if (this.#el === el) this.#el = null;
		}, 520);
	}

	/* ---- view ---------------------------------------------------------- */

	static #build() {
		const el = document.createElement("div");
		el.id = "aether-lock";
		el.tabIndex = -1;
		el.setAttribute("role", "dialog");
		el.setAttribute("aria-label", "Locked");

		const center = document.createElement("div");
		center.className = "lock-center";
		this.#date = document.createElement("div");
		this.#date.className = "lock-date";
		this.#clock = document.createElement("div");
		this.#clock.className = "lock-clock";
		center.append(this.#date, this.#clock);

		const bottom = document.createElement("div");
		bottom.className = "lock-bottom";
		const avatar = document.createElement("div");
		avatar.className = "lock-avatar";
		avatar.innerHTML = '<span class="material-symbols-outlined">person</span>';
		this.#pinWrap = document.createElement("div");
		this.#pinWrap.className = "lock-pin";
		this.#pinInput = document.createElement("input");
		this.#pinInput.type = "password";
		this.#pinInput.inputMode = "numeric";
		this.#pinInput.autocomplete = "off";
		this.#pinInput.placeholder = "Passcode";
		this.#pinInput.setAttribute("aria-label", "Passcode");
		const go = document.createElement("button");
		go.className = "lock-go";
		go.title = "Unlock";
		go.innerHTML =
			'<span class="material-symbols-outlined">arrow_forward</span>';
		go.addEventListener("click", (e) => {
			e.stopPropagation();
			this.#attemptUnlock();
		});
		this.#pinWrap.append(this.#pinInput, go);
		this.#hint = document.createElement("div");
		this.#hint.className = "lock-hint";
		this.#hint.textContent = this.hasPin
			? "Click or press any key, then enter your passcode"
			: "Click or press any key to unlock";
		bottom.append(avatar, this.#pinWrap, this.#hint);

		el.append(center, bottom);
		el.addEventListener("pointerdown", (e) => {
			if ((e.target as Element).closest(".lock-pin")) return;
			this.#attemptUnlock();
		});
		el.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.target === this.#pinInput) {
				if (e.key === "Enter") this.#attemptUnlock();
				if (e.key === "Escape") {
					this.#pinInput!.value = "";
				}
				return;
			}
			// Modifier-only presses shouldn't count as "any key".
			if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
			e.preventDefault();
			this.#attemptUnlock();
		});
		document.body.appendChild(el);
		this.#el = el;
	}

	static #render() {
		const now = new Date();
		let hour12 = true;
		try {
			hour12 = !anura.settings.get("sir-yes-sir");
		} catch {
			/* default */
		}
		const time = now.toLocaleTimeString(navigator.language, {
			hour: "numeric",
			minute: "2-digit",
			hour12,
		});
		// The AM/PM suffix reads better small; the clock face is just digits.
		const face = time.replace(/\s?[AP]\.?M\.?$/i, "");
		if (this.#clock && this.#clock.textContent !== face)
			this.#clock.textContent = face;
		const date = now.toLocaleDateString(navigator.language, {
			weekday: "long",
			month: "long",
			day: "numeric",
		});
		if (this.#date && this.#date.textContent !== date)
			this.#date.textContent = date;
	}

	/* ---- inactivity ---------------------------------------------------- */

	static get idleMinutes(): number {
		try {
			return Number(anura.settings.get(this.IDLE_KEY)) || 0;
		} catch {
			return 0;
		}
	}

	static #activity = () => {
		AetherLockScreen.#lastActivity = Date.now();
	};

	static #watch(win: Window) {
		if (this.#watched.has(win)) return;
		try {
			for (const type of ["pointerdown", "keydown", "wheel", "pointermove"]) {
				win.addEventListener(type, this.#activity, {
					passive: true,
					capture: true,
				});
			}
			this.#watched.add(win);
		} catch {
			/* cross-origin frame */
		}
	}

	static init() {
		this.#watch(window);
		const watchFrame = (f: HTMLIFrameElement) => {
			const attach = () => {
				try {
					if (f.contentWindow) this.#watch(f.contentWindow);
				} catch {
					/* cross-origin */
				}
			};
			attach();
			f.addEventListener("load", attach);
		};
		document.querySelectorAll("iframe").forEach(watchFrame);
		new MutationObserver((records) => {
			for (const r of records)
				r.addedNodes.forEach((n) => {
					if (n instanceof HTMLIFrameElement) watchFrame(n);
					else if (n instanceof Element)
						n.querySelectorAll("iframe").forEach(watchFrame);
				});
		}).observe(document.body, { childList: true, subtree: true });

		// A coarse check is plenty for minute-granularity timeouts.
		window.setInterval(() => {
			const minutes = this.idleMinutes;
			if (!minutes || this.locked) return;
			if (Date.now() - this.#lastActivity >= minutes * 60_000) this.lock();
		}, 15_000);
	}
}

/* Class declarations are lexical, not properties of globalThis. See Widgets.tsx. */
(globalThis as any).AetherLockScreen = AetherLockScreen;
