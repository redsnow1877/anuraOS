/**
 * The shell chrome: one floating capsule along the bottom of the screen.
 *
 *   [ cube ] | pinned apps | running apps |  AI  | tray: status, clock
 *
 * There's no menu bar. The cube opens the Launchpad (right-click it for the
 * system menu), the tray at the right end holds what the menu bar used to:
 * network and Control Center, notifications, battery, the clock. The island
 * floats on its own at the top of the screen (Island.ts).
 *
 * It all lives inside a single `display: contents` root so the rest of the OS
 * can keep treating `taskbar.element` as one node.
 */
/**
 * The launch bounce. It goes on the `.dock-item`, never the icon itself,
 * which carries its own hover lift.
 */
function bounceDockItem(from: HTMLElement | null): void {
	const item = from?.closest?.(".dock-item") as HTMLElement | null;
	if (!item) return;
	if (anura?.settings?.get("disable-animation")) return;
	item.classList.remove("dock-bounce");
	void item.offsetWidth;
	item.classList.add("dock-bounce");
	item.addEventListener(
		"animationend",
		() => item.classList.remove("dock-bounce"),
		{ once: true },
	);
}

class Taskbar {
	timeformat = new Intl.DateTimeFormat(navigator.language, {
		hour: "numeric",
		minute: "numeric",
		hour12: !anura.settings.get("sir-yes-sir"),
	});

	dateformat = new Intl.DateTimeFormat(navigator.language, {
		weekday: "short",
		month: "short",
		day: "numeric",
	});

	state: {
		pinnedApps: App[];
		activeApps: App[];
		showBar: boolean;
		solidMenubar: boolean;
		activeApp: string;
		time: string;
		date: string;
		net_icon: string;
	} = $state({
		pinnedApps: [],
		activeApps: [],
		showBar: false,
		solidMenubar: false,
		activeApp: BRANDING.name,
		time: "",
		date: "",
		net_icon: navigator.onLine ? "wifi" : "wifi_off",
	});

	maximizedWins: WMWindow[] = [];
	dragged = null;
	insidedrag = false;

	element = (<div>Not Initialized</div>);

	shortcut(app: App) {
		if (!app) return;
		return ((this as any).tmp = (
			<li class="dock-item" data-title={app?.name || "App"}>
				<input
					type="image"
					draggable={anura.platform.type === "desktop"}
					src={app?.icon || ""}
					title={app?.name || "App"}
					on:dragend={(e: DragEvent) => {
						if (!this.insidedrag) {
							for (const i of app.windows) {
								i.close();
							}
							anura.settings.set(
								"applist",
								anura.settings
									.get("applist")
									.filter((p: string) => p !== app.package),
							);
							this.updateTaskbar();
						} else {
							const dropX = e.clientX;
							const icons = document.querySelectorAll(".dock-item .dock-icon");

							let closestIndex = anura.settings.get("applist").length - 1;

							const rects: DOMRect[] = [];

							icons.forEach((icn) => {
								const rect = icn.getBoundingClientRect();
								rects.push(rect);
							});

							rects.forEach((rect, index) => {
								if (
									dropX > rect.left &&
									dropX < (rects[index + 1]?.left || 0)
								) {
									closestIndex = index;
								}
							});

							if (anura.settings.get("applist").includes(app.package)) {
								anura.settings.set("applist", [
									...anura.settings
										.get("applist")
										.filter((p: string) => p !== app.package),
								]);
							}

							const order = [...anura.settings.get("applist")];
							order.splice(closestIndex, 0, app.package);
							anura.settings.set("applist", order);

							this.updateTaskbar();
						}
						this.dragged = null;
						this.insidedrag = false;
						document
							.querySelectorAll(".dock-item .dock-icon")
							.forEach((i) => ((i as HTMLElement).style.borderRight = "none"));
					}}
					on:dragstart={() => {
						// @ts-ignore
						this.dragged = $el;
					}}
					on:drag={(e: DragEvent) => {
						// draw a line to show where the icon will be placed
						const icons = document.querySelectorAll(".dock-item .dock-icon");
						const dropX = e.clientX;
						const rects: DOMRect[] = [];
						icons.forEach((icn) => {
							const rect = icn.getBoundingClientRect();
							rects.push(rect);
						});
						let closestIndex = anura.settings.get("applist").length - 1;
						rects.forEach((rect, index) => {
							if (dropX > rect.left && dropX < (rects[index + 1]?.left || 0)) {
								closestIndex = index;
							}
						});
						for (let i = 0; i < icons.length; i++) {
							(icons[i] as HTMLElement).style.borderRight = "none";
						}
						if (icons[closestIndex])
							(icons[closestIndex] as HTMLElement).style.borderRight =
								"2px solid var(--theme-fg)";
					}}
					class="dock-icon showDialog"
					on:click={(e: MouseEvent) => {
						if (app.windows.length === 1) {
							app.windows[0]!.unminimize();
							app.windows[0]!.focus();
						} else {
							this.showcontext(app, e);
						}
					}}
					on:contextmenu={(e: MouseEvent) => {
						this.showcontext(app, e);
					}}
				/>
				{
					((this as any).lightbar = (
						// A plain template string (not an array of pointers) resolves
						// via setAttribute, so an empty conditional segment is just
						// absent from the string rather than a literal "false" class.
						<div
							class={`lightbar${app.windows?.length === 0 ? " lightbar-hidden" : ""}`}
						></div>
					))
				}
			</li>
		));
	}

	#contextMenu = new ContextMenu(true); // This is going to be before anura is initialized, so we can't use anura.ContextMenu
	showcontext(app: App, e: MouseEvent) {
		// If `app` has open windows, or if dock item was right clicked
		if (app.windows.length > 0 || e.button === 2) {
			this.#contextMenu.removeAllItems();
			this.#contextMenu.addItem(
				"New Window",
				() => {
					const potentialFuture = app.open();
					if (
						typeof potentialFuture !== "undefined" &&
						//@ts-ignore - In App.tsx, open() returns a void, but in nearly every other case it returns a Promise<WMWindow> | undefined
						// Typescript doesn't like this, so we have to ignore it.
						typeof potentialFuture.then === "function"
					) {
						// @ts-ignore - Same as above
						potentialFuture.then((win) => {
							if (typeof win === "undefined") return;
							this.updateRadius();
						});
					}
				},
				"new_window",
			);

			let winEnumerator = 1;
			for (const win of app.windows) {
				const displayTitle = win.state.title || "Window " + winEnumerator;
				this.#contextMenu.addItem(
					displayTitle,
					() => {
						win.focus();
						win.unminimize();
					},
					"ad",
				); // somehow fits
				winEnumerator++;
			}
			const pinned = anura.settings.get("applist").includes(app.package);
			this.#contextMenu.addItem(
				pinned ? "Remove from Dock" : "Keep in Dock",
				() => {
					if (pinned) {
						anura.settings.set(
							"applist",
							anura.settings
								.get("applist")
								.filter((p: string) => p !== app.package),
						);
					} else {
						anura.settings.set("applist", [
							...anura.settings.get("applist"),
							app.package,
						]);
					}
					this.updateTaskbar();
				},
				pinned ? "keep_off" : "keep",
			);

			this.#contextMenu.addItem(
				"Quit",
				() => {
					for (const win of app.windows) {
						win.close();
					}
				},
				"cancel",
			);

			const c = this.#contextMenu.show(e.x, 0);
			// The menu opens upward out of the dock, so pin it to the bottom
			// instead of letting ContextMenu place it from the top.
			c.style.top = "";
			c.style.bottom = "calc(var(--dock-reserve) + 6px)";
		} else {
			AetherMotion.noteLaunch(
				(e.target as HTMLElement | null)
					?.closest?.(".dock-item")
					?.querySelector(".dock-icon"),
			);
			bounceDockItem(e.target as HTMLElement | null);
			try {
				aetherSound.play("open");
			} catch {
				/* best-effort */
			}
			const potentialFuture = app.open();
			if (
				typeof potentialFuture !== "undefined" &&
				//@ts-ignore - In App.tsx, open() returns a void, but in nearly every other case it returns a Promise<WMWindow> | undefined
				// Typescript doesn't like this, so we have to ignore it.
				typeof potentialFuture.then === "function"
			) {
				// @ts-ignore - Same as above
				potentialFuture.then((win) => {
					if (typeof win === "undefined") return;
					this.updateRadius();
				});
			}
		}
	}

	constructor() {
		// The clock only shows minutes, but ticks every second so a change of
		// minute (or of the 24-hour setting) lands promptly. Assigning only on
		// an actual change keeps the other 59 ticks from re-rendering the menu
		// bar text — each assignment was a style recalc and layout.
		setInterval(() => {
			if (document.hidden) return;
			const now = Date.now();
			const date = this.dateformat.format(now);
			const time = this.timeformat.format(now);
			if (this.state.date !== date) this.state.date = date;
			if (this.state.time !== time) this.state.time = time;
		}, 1000);

		addEventListener("online", () => {
			this.state.net_icon = "wifi";
		});

		addEventListener("offline", () => {
			this.state.net_icon = "wifi_off";
		});

		document.addEventListener("anura-force-taskbar-update", () => {
			this.updateTaskbar();
		});

		// AliceWM tells us which window owns the menu bar title.
		document.addEventListener("anura-window-focus", ((e: CustomEvent) => {
			this.state.activeApp = e.detail?.name || BRANDING.name;
		}) as EventListener);

		document.addEventListener("anura-window-blur", () => {
			this.state.activeApp = BRANDING.name;
		});

		// Battery: AetherBattery (Battery.ts) owns its own menu bar item.
	}

	brandMenu = new ContextMenu(true);

	#initBrandMenu() {
		this.brandMenu.removeAllItems();
		this.brandMenu.addItem(
			`About ${BRANDING.name}`,
			() => anura.apps["anura.about"]?.open(),
			"info",
		);
		this.brandMenu.addItem(
			"System Settings…",
			() => anura.apps["anura.settings"]?.open(),
			"settings",
		);
		this.brandMenu.addItem(
			"Wallpaper & Style…",
			() => anura.apps["anura.wallpaper"]?.open(),
			"brush",
		);
		this.brandMenu.addItem(
			"Activity Monitor",
			() => anura.apps["anura.taskmgr"]?.open(),
			"monitoring",
		);
		this.brandMenu.addItem(
			"Lock Screen",
			() => (globalThis as any).AetherLockScreen?.lock(),
			"lock",
		);
		this.brandMenu.addItem("Restart", () => location.reload(), "restart_alt");
	}

	/** The system menu, opened upward out of the cube. */
	#showBrandMenu(e: MouseEvent) {
		e.preventDefault();
		launcher.hide();
		quickSettings.close();
		calendar.close();
		const el =
			(e.currentTarget as HTMLElement) ||
			document.getElementById("launcher-button");
		const rect = el.getBoundingClientRect();
		const menu = this.brandMenu.show(rect.left, 0);
		menu.style.top = "";
		menu.style.bottom = "calc(var(--dock-reserve) + 6px)";
		document.onclick = () => {
			document.onclick = null;
			this.brandMenu.hide();
		};
	}

	async init() {
		this.#initBrandMenu();

		const mark = document.createElement("span");
		mark.className = "launch-mark";
		mark.innerHTML = BRANDING.mark({ mono: true, size: 22 });

		const aiOrb = document.createElement("span");
		aiOrb.className = "ai-orb";

		this.element = (
			<div id="shell-root">
				<footer
					id="dock"
					class={use(this.state.solidMenubar, (solid) =>
						solid ? "solid" : "",
					)}
					on:dragover={(e: DragEvent) => {
						e.preventDefault();
					}}
					on:drop={(e: DragEvent) => {
						this.insidedrag = true;
						e.preventDefault();
					}}
				>
					<div id="launcher-button-container">
						<button
							id="launcher-button"
							title={`Launchpad (right-click for the ${BRANDING.name} menu)`}
							on:click={() => {
								quickSettings.close();
								calendar.close();
								launcher.toggleVisible();
							}}
							on:contextmenu={(e: MouseEvent) => this.#showBrandMenu(e)}
						>
							{mark}
						</button>
					</div>

					<div class="dock-separator"></div>

					<nav id="taskbar-bar">
						<ul>
							{use(this.state.pinnedApps, (apps: App[]) =>
								apps.map(this.shortcut.bind(this)),
							)}
						</ul>

						{$if(use(this.state.showBar), <div class="dock-separator"></div>)}

						<ul>
							{use(this.state.activeApps, (apps: App[]) =>
								apps.map(this.shortcut.bind(this)),
							)}
						</ul>
					</nav>

					<button
						id="dock-ai"
						title={`Ask ${BRANDING.name} AI`}
						on:click={(e: MouseEvent) =>
							(globalThis as any).DimensionAI?.summon(e.currentTarget)
						}
					>
						{aiOrb}
					</button>

					<div class="dock-separator"></div>

					<div id="dock-tray">
						<span class="systray"></span>

						<button
							class="tray-item dnd-indicator"
							title="Do Not Disturb is on. Click to turn it off"
							on:click={() => (globalThis as any).AetherDND?.set(false)}
						>
							<span class="material-symbols-outlined">bedtime</span>
						</button>

						<button
							class="tray-item"
							id="tray-cc"
							title="Control Center"
							on:click={() => {
								launcher.hide();
								calendar.close();
								quickSettings.toggle();
							}}
						>
							<span class="material-symbols-outlined">
								{use(this.state.net_icon)}
							</span>
						</button>

						<button
							class="tray-item"
							id="tray-notifications"
							title="Notifications"
							on:click={() => {
								launcher.hide();
								calendar.close();
								quickSettings.toggle();
							}}
						>
							<span class="material-symbols-outlined">notifications</span>
							<span
								class={[
									"notification-badge",
									use(anura.notifications.state.notifications.length, (i) =>
										i > 0 ? "shown" : "hidden",
									),
								]}
							>
								{use(anura.notifications.state.notifications.length)}
							</span>
						</button>

						<button
							class="tray-item"
							id="tray-clock"
							title="Calendar"
							on:click={() => {
								launcher.hide();
								quickSettings.close();
								calendar.toggle();
							}}
						>
							<span class="tray-time">{use(this.state.time)}</span>
							<span class="tray-date">{use(this.state.date)}</span>
						</button>
					</div>
				</footer>
			</div>
		);
	}

	updateTaskbar() {
		const pinned = anura.settings
			.get("applist")
			.map((id: string) => anura.apps[id]);
		const activewindows: App[] = Object.values(anura.apps).filter(
			(a: App) => a.windows && a.windows.length > 0,
		) as App[];

		this.state.pinnedApps = pinned;
		this.state.activeApps = activewindows.filter(
			(app: App) => !pinned.includes(app),
		);

		this.state.showBar =
			this.state.pinnedApps.length > 0 && this.state.activeApps.length > 0;
	}

	/**
	 * Kept under its old name so existing callers keep working: it now decides
	 * whether the dock is translucent or opaque (it goes solid over a maximized
	 * or snapped window, so it reads against busy content).
	 */
	updateRadius() {
		this.state.solidMenubar =
			this.maximizedWins.length > 0 || snappedWindows.length > 0;
	}
}
