/**
 * Launchpad — a full-screen, blurred app grid with a search field.
 *
 * Replaces the old dropdown launcher panel: instead of a small popover anchored
 * to the taskbar, the whole desktop frosts over and the apps float on top.
 */
class Launcher {
	state: Stateful<{
		active: boolean;
		apps?: App[];
		appsView?: HTMLDivElement;
		search?: HTMLInputElement;
		empty: boolean;
	}> = $state({
		active: false,
		empty: false,
	});

	element = (<div>Not Initialized</div>);

	/** Set once init() builds the rail; null when widgets are unavailable. */
	widgetHost: any = null;

	/** The gooey search control; null when Gooey.js is unavailable. */
	gooey: any = null;

	clickoffChecker: HTMLDivElement;
	updateClickoffChecker: (show: boolean) => void;

	/**
	 * Feeds Motion.css the per-tile geometry its "butterfly" reveal keys off.
	 *
	 * `--ring` (distance from the grid centre) drives the outward stagger and
	 * `--dx`/`--dy` give each tile its hinge direction, so the grid unfolds from
	 * the middle rather than sweeping in reading order. Hidden tiles are skipped
	 * so a filtered grid re-centres on what's actually left.
	 */
	layoutGrid() {
		const grid = this.state.appsView;
		if (!grid) return;

		const tiles = Array.from(grid.querySelectorAll<HTMLElement>(".app")).filter(
			(t) => t.style.display !== "none",
		);
		if (!tiles.length) return;

		const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
		const rows = Math.ceil(tiles.length / cols);
		const cx = (cols - 1) / 2;
		const cy = (rows - 1) / 2;

		tiles.forEach((tile, i) => {
			const dx = (i % cols) - cx;
			const dy = Math.floor(i / cols) - cy;
			// Normalise against the grid's own extent so a wide grid and a tall
			// one both peak at ring 3 rather than scaling with column count.
			const nx = dx / Math.max(cx, 1);
			const ny = dy / Math.max(cy, 1);
			tile.style.setProperty("--i", String(i));
			tile.style.setProperty(
				"--ring",
				String(Math.round(Math.hypot(nx, ny) * 3)),
			);
			tile.style.setProperty("--dx", nx.toFixed(3));
			tile.style.setProperty("--dy", ny.toFixed(3));
		});
	}

	/** Accepts either a DOM event (plain input) or a value (GooeySearch). */
	handleSearch(source: Event | string) {
		const raw =
			typeof source === "string"
				? source
				: (source.target as HTMLInputElement).value;
		const searchQuery = raw.toLowerCase().trim();
		if (!this.state.appsView) return;
		const apps = this.state.appsView.querySelectorAll(".app");

		let visible = 0;
		apps.forEach((app: HTMLElement) => {
			const appNameElement = app.querySelector(".app-shortcut-name");
			const appName = appNameElement?.textContent?.toLowerCase() || "";
			const match = searchQuery === "" || appName.includes(searchQuery);
			app.style.display = match ? "" : "none";
			if (match) visible++;
		});

		this.state.empty = visible === 0;

		// Re-centre the wave on the surviving tiles, then replay a short version
		// of the reveal so filtering feels like a re-deal rather than a jump cut.
		this.layoutGrid();
		const grid = this.state.appsView;
		if (grid && !anura.settings.get("disable-animation")) {
			grid.classList.remove("lp-refilter");
			void grid.offsetWidth; // force reflow so the animation restarts
			grid.classList.add("lp-refilter");
		}
	}

	toggleVisible() {
		if (this.state.active) {
			this.hide();
			return;
		}
		this.show();
	}

	setActive(active: boolean) {
		if (active) this.show();
		else this.hide();
	}

	show() {
		this.clearSearch();
		// Geometry has to be on the tiles before the reveal starts, and the grid
		// only has a resolved column count once it's laid out.
		this.layoutGrid();
		this.state.active = true;
		requestAnimationFrame(() => {
			this.layoutGrid();
			// Tiles are rebuilt whenever the app list changes, so re-scan on
			// every open; attach() skips anything already bound.
			try {
				AetherMagnetic.scan(this.state.appsView || undefined);
			} catch {
				/* Magnetic.js is optional */
			}
		});
		this.gooey?.expand();
		this.focusSearch();
		// Widgets poll (clock, weather, system stats) — only while on screen.
		try {
			this.widgetHost?.setActive(true);
		} catch (e) {
			console.warn("widget rail failed to start", e);
		}
		(globalThis as any).aetherSound?.play?.("launchpadOpen");
	}

	hide() {
		if (!this.state.active) return;
		const el = this.element as HTMLElement;

		// Motion.css collapses the grid inward off `lp-closing`; it has to go on
		// before `launcher-active` comes off, and come back off once it's done.
		if (el && !anura.settings.get("disable-animation")) {
			el.classList.add("lp-closing");
			setTimeout(() => el.classList.remove("lp-closing"), 340);
		}

		this.state.active = false;
		// Collapsed on the way out so the bubble has somewhere to come from the
		// next time the Launchpad opens.
		this.gooey?.collapse();
		try {
			AetherMagnetic.releaseAll(this.element as HTMLElement);
		} catch {
			/* Magnetic.js is optional */
		}
		this.clearSearch();
		try {
			this.widgetHost?.setActive(false);
		} catch {
			/* a stopped rail is not worth surfacing */
		}
		(globalThis as any).aetherSound?.play?.("launchpadClose");
	}

	focusSearch() {
		// Wait for the fade-in; focusing a `visibility: hidden` input is a no-op.
		setTimeout(() => this.state.search?.focus(), 60);
	}

	clearSearch() {
		if (this.state.search) {
			this.state.search.value = "";
		}
		this.gooey?.reset();
		this.state.empty = false;
		if (!this.state.appsView) return;
		const apps = this.state.appsView.querySelectorAll(".app");
		apps.forEach((app: HTMLElement) => {
			app.style.display = "";
		});
	}

	addShortcut(app: App) {
		if (app.hidden) return;

		this.state.apps = [...(this.state.apps || []), app];
	}

	constructor(
		clickoffChecker: HTMLDivElement,
		updateClickoffChecker: (show: boolean) => void,
	) {
		this.clickoffChecker = clickoffChecker;
		this.updateClickoffChecker = updateClickoffChecker;

		// The Launchpad deliberately does NOT drive the shared click-off layer.
		// That layer sits at z-index 9998 and `#launcher` at 9600, so raising it
		// covered the whole grid: every tile click landed on the catcher, which
		// dismissed the Launchpad without ever launching the app. `#launcher` is
		// itself `position: fixed; inset: 0` and dismisses on a pointerdown that
		// reaches its own backdrop (see render()), so the catcher was redundant
		// as well as harmful. The menu-bar panels still use it — they're small,
		// and genuinely need a catcher over the rest of the screen.

		document.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Escape" && this.state.active) {
				e.preventDefault();
				this.hide();
			}
		});
	}

	async init() {
		this.element = (
			<div
				id="launcher"
				// A single pointer (not wrapped in an array) is the form dreamland
				// filters empty strings for; inside a `class={[...]}` array it
				// would call classList.add(false) on the inactive branch instead
				// of skipping it — no crash, but a literal "false" class.
				class={use(this.state.active, (active) =>
					active ? "launcher-active" : "",
				)}
				on:pointerdown={(e: PointerEvent) => {
					// Clicking the frosted background dismisses. `#launcher` itself
					// is only a thin strip once the two-pane body fills it, so the
					// test covers the structural containers too — most of the
					// "empty space" a user aims at is actually `.appsView`. Tiles,
					// the search field and the widget rail are all interactive and
					// are deliberately absent from this list.
					const target = e.target as HTMLElement;
					if (
						target === e.currentTarget ||
						target.classList.contains("launcher-body") ||
						target.classList.contains("launcher-apps") ||
						target.classList.contains("appsView")
					) {
						this.hide();
					}
				}}
			>
				{this.buildSearch()}

				<div class="launcher-body">
					<div class="launcher-apps">
						<div
							id="appsView"
							class="appsView"
							bind:this={use(this.state.appsView)}
						>
							{use(this.state.apps, (apps) =>
								(apps || []).map((app: App) => (
									<LauncherShortcut
										app={app}
										onclick={() => {
											this.hide();
											app.open();
										}}
									/>
								)),
							)}
						</div>

						{$if(
							use(this.state.empty),
							<div class="launcher-empty">No results</div>,
						)}
					</div>

					{this.buildWidgetRail()}
				</div>
			</div>
		);
	}

	/**
	 * The search field. A GooeySearch when Gooey.js is present — it starts
	 * collapsed so that opening the Launchpad pulls the icon bubble out of the
	 * pill — and the plain field otherwise. Either way `state.search` ends up
	 * pointing at the <input>, so focusSearch/clearSearch don't care which.
	 */
	buildSearch(): HTMLElement {
		const openFirstResult = (e: KeyboardEvent) => {
			if (e.key !== "Enter") return;
			const first = this.state.appsView?.querySelector<HTMLElement>(
				'.app:not([style*="display: none"])',
			);
			first?.click();
		};

		try {
			const Gooey = (globalThis as any).GooeySearch;
			if (Gooey) {
				this.gooey = new Gooey({
					placeholder: "Search",
					onInput: (value: string) => this.handleSearch(value),
					onKeyDown: openFirstResult,
				});
				this.state.search = this.gooey.input;
				return this.gooey.element;
			}
		} catch (e) {
			console.warn("gooey search unavailable", e);
			this.gooey = null;
		}

		return (
			<div class="launcher-search">
				<span class="material-symbols-outlined">search</span>
				<input
					placeholder="Search"
					spellcheck={false}
					autocomplete="off"
					bind:this={use(this.state.search)}
					on:input={this.handleSearch.bind(this)}
					on:keydown={openFirstResult}
				/>
			</div>
		) as HTMLElement;
	}

	/**
	 * The start-menu half of the launcher. Widgets are optional by design: if
	 * Widgets.tsx failed to load, or every widget declined to render, the rail
	 * is simply absent and the app grid takes the full width.
	 */
	buildWidgetRail(): HTMLElement | string {
		try {
			const Host = (globalThis as any).WidgetHost;
			if (!Host) return "";
			this.widgetHost = new Host({
				heading: BRANDING.name,
				onLaunch: (pkg: string) => {
					this.hide();
					anura.apps[pkg]?.open();
				},
			});
			if (!this.widgetHost.widgets.length) {
				this.widgetHost = null;
				return "";
			}
			return this.widgetHost.element;
		} catch (e) {
			console.warn("widget rail unavailable", e);
			this.widgetHost = null;
			return "";
		}
	}
}

const LauncherShortcut: Component<
	{
		app: App;
		onclick: () => void;
	},
	Record<string, never>
> = function () {
	const app = this.app;

	const contextmenu = new anura.ContextMenu(true);
	const action = this.onclick;

	contextmenu.addItem(
		"Open",
		function () {
			action();
		},
		"new_window",
	);

	// MARK: MAKE IT UPDATE
	if (anura.settings.get("applist").includes(app.package)) {
		contextmenu.addItem(
			"Remove from Dock",
			function () {
				anura.settings.set(
					"applist",
					anura.settings
						.get("applist")
						.filter((item: string) => item !== app.package),
				);
				document.dispatchEvent(new Event("anura-force-taskbar-update"));
			},
			"keep_off",
		);
	} else {
		contextmenu.addItem(
			"Keep in Dock",
			function () {
				anura.settings.set("applist", [
					...anura.settings.get("applist"),
					app.package,
				]);
				document.dispatchEvent(new Event("anura-force-taskbar-update"));
			},
			"keep",
		);
	}
	contextmenu.addItem(
		"Delete",
		async () => {
			if (
				anura.apps[app.package].source &&
				anura.apps[app.package].source.includes("/fs")
			) {
				try {
					const sh = new anura.fs.Shell();
					// Tolerates a sub-path deployment, where the source URL is
					// "/<base>/fs/..." rather than "/fs/...".
					const path = (app as ExternalApp).source.replace(/^.*?\/fs\//, "");
					await sh.rm(
						path,
						{
							recursive: true,
						},
						function (err) {
							if (err) throw err;
						},
					);
					delete anura.apps[app.package];
					this.root.remove();
				} catch (e) {
					console.error(e);
					anura.dialog.alert(
						"Could not delete app. Please try again later: " + e,
					);
				}
			} else {
				console.error("App not found");
				anura.dialog.alert(
					"App not found. Either it's a system app or something has gone terribly wrong.",
				);
			}
		},
		"delete",
	);

	return (
		<div
			class="app"
			// Picked up by AetherMagnetic.scan() when the Launchpad opens; the
			// value is the pull strength. Harmless if Magnetic.js is absent.
			data-magnetic="0.3"
			on:click={this.onclick}
			on:contextmenu={(e: PointerEvent) => {
				e.preventDefault();

				const rect = document.body.getBoundingClientRect();
				contextmenu.show(e.pageX + rect.x, e.pageY + rect.y);

				document.onclick = (e) => {
					document.onclick = null;
					contextmenu.hide();
					e.preventDefault();
				};
			}}
		>
			<img class="app-shortcut-image" src={this.app.icon} alt="" />
			<div class="app-shortcut-name">{this.app.name}</div>
		</div>
	);
};
