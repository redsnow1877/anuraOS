/**
 * The shell chrome: a menu bar pinned to the top of the screen and a floating,
 * magnifying dock at the bottom. Both live inside a single `display: contents`
 * root so the rest of the OS can keep treating `taskbar.element` as one node.
 */
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
		bat_icon: string;
		net_icon: string;
	} = $state({
		pinnedApps: [],
		activeApps: [],
		showBar: false,
		solidMenubar: false,
		activeApp: BRANDING.name,
		time: "",
		date: "",
		bat_icon: "battery_0_bar",
		net_icon: navigator.onLine ? "wifi" : "wifi_off",
	});

	maximizedWins: WMWindow[] = [];
	dragged = null;
	insidedrag = false;

	element = (<div>Not Initialized</div>);

	/** How far, in px, the cursor's influence on dock magnification reaches. */
	static MAGNIFY_SIGMA = 78;
	/** Peak scale of the icon directly under the cursor. */
	static MAGNIFY_PEAK = 0.55;

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
						<div
							class={[
								"lightbar",
								app.windows?.length === 0 ? "lightbar-hidden" : "",
							]}
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
		setInterval(() => {
			const date = Date.now();
			this.state.date = this.dateformat.format(date);
			if (this.timeformat.resolvedOptions().hour12 === false) {
				this.state.time = this.timeformat.format(date);
			} else {
				this.state.time = this.timeformat.format(date);
			}
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

		// Battery Status API is deprecated, so Microsoft refuses to create type definitions. :(

		// @ts-ignore
		if (navigator.getBattery) {
			// @ts-ignore
			navigator.getBattery().then((battery) => {
				battery.onchargingchange = () => {
					if (battery.charging) {
						this.state.bat_icon = "battery_charging_full";
						return;
					} else {
						const bat_bars = Math.round(battery.level * 7) - 1;
						this.state.bat_icon = `battery_${bat_bars}_bar`;
						return;
					}
				};

				battery.onlevelchange = () => {
					if (battery.charging) {
						this.state.bat_icon = "battery_charging_full";
						return;
					} else {
						const bat_bars = Math.round(battery.level * 7) - 1;
						if (bat_bars === -1) {
							this.state.bat_icon = `battery_alert`;
							return;
						}
						this.state.bat_icon = `battery_${bat_bars}_bar`;
						return;
					}
				};

				// This literally just checks if the battery is charging and fully charged
				// which is a *close enough* approximation of whether it's a laptop or not.
				if (battery.charging && battery.chargingTime === 0) {
					this.state.bat_icon = "";
					return;
				}

				if (battery.charging) {
					this.state.bat_icon = "battery_charging_full";
					return;
				}
				const bat_bars = Math.round(battery.level * 7) - 1;
				if (bat_bars === -1) {
					this.state.bat_icon = `battery_alert`;
					return;
				}
				this.state.bat_icon = `battery_${bat_bars}_bar`;
			});
		}
	}

	/**
	 * Dock magnification. Each icon's scale falls off as a gaussian of its
	 * horizontal distance from the cursor, which is what gives the dock its
	 * signature "wave" instead of a stepped hover.
	 */
	#magnify(clientX: number | null) {
		const dock = document.getElementById("dock");
		if (!dock) return;
		if (anura.settings.get("disable-animation")) return;

		const items = dock.querySelectorAll<HTMLElement>(
			".dock-item, #launcher-button",
		);
		const sigma = Taskbar.MAGNIFY_SIGMA;

		items.forEach((item) => {
			if (clientX === null) {
				item.style.setProperty("--mag", "1");
				return;
			}
			const rect = item.getBoundingClientRect();
			const center = rect.left + rect.width / 2;
			const d = (clientX - center) / sigma;
			const mag = 1 + Taskbar.MAGNIFY_PEAK * Math.exp(-d * d);
			item.style.setProperty("--mag", mag.toFixed(3));
		});
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
		this.brandMenu.addItem("Restart", () => location.reload(), "restart_alt");
	}

	async init() {
		this.#initBrandMenu();

		this.element = (
			<div id="shell-root">
				<header
					id="menubar"
					class={[
						use(this.state.solidMenubar, (solid) => (solid ? "solid" : "")),
					]}
				>
					<div
						class="menubar-item"
						id="menubar-brand"
						title={BRANDING.name}
						on:click={(e: MouseEvent) => {
							launcher.hide();
							quickSettings.close();
							calendar.close();
							const el = e.currentTarget as HTMLElement;
							const rect = el.getBoundingClientRect();
							this.brandMenu.show(rect.left, rect.bottom + 4);
							document.onclick = () => {
								document.onclick = null;
								this.brandMenu.hide();
							};
						}}
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								d="M12 1.5 22 20.5H2L12 1.5Z"
								fill="currentColor"
								fill-opacity="0.95"
							/>
							<path
								d="M12 8.5 17 18H7l5-9.5Z"
								fill="#000"
								fill-opacity="0.45"
							/>
						</svg>
					</div>

					<div class="menubar-item" id="menubar-appname">
						{use(this.state.activeApp)}
					</div>

					<div id="menubar-spacer"></div>

					<div id="menubar-right">
						<span class="systray"></span>

						<div
							class="menubar-item"
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
							<span class="material-symbols-outlined">
								{use(this.state.bat_icon)}
							</span>
						</div>

						<div
							class="menubar-item"
							title="Notifications"
							on:click={() => {
								launcher.hide();
								calendar.close();
								quickSettings.toggle();
							}}
						>
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
						</div>

						<div
							class="menubar-item"
							id="menubar-clock"
							on:click={() => {
								launcher.hide();
								quickSettings.close();
								calendar.toggle();
							}}
						>
							<span>{use(this.state.date)}</span>
							<span>{use(this.state.time)}</span>
						</div>
					</div>
				</header>

				<footer
					id="dock"
					on:pointermove={(e: PointerEvent) => this.#magnify(e.clientX)}
					on:pointerleave={() => this.#magnify(null)}
					on:dragover={(e: DragEvent) => {
						e.preventDefault();
					}}
					on:drop={(e: DragEvent) => {
						this.insidedrag = true;
						e.preventDefault();
					}}
				>
					<div id="launcher-button-container">
						<div
							id="launcher-button"
							title="Launchpad"
							on:click={() => {
								quickSettings.close();
								calendar.close();
								launcher.toggleVisible();
							}}
						>
							<i></i>
							<i></i>
							<i></i>
							<i></i>
							<i></i>
							<i></i>
							<i></i>
							<i></i>
							<i></i>
						</div>
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
	 * whether the menu bar is translucent or opaque rather than rounding the
	 * old bottom taskbar.
	 */
	updateRadius() {
		this.state.solidMenubar =
			this.maximizedWins.length > 0 || snappedWindows.length > 0;
	}
}
