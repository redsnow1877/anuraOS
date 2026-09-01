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

	clickoffChecker: HTMLDivElement;
	updateClickoffChecker: (show: boolean) => void;

	handleSearch(event: Event) {
		const searchQuery = (event.target as HTMLInputElement).value
			.toLowerCase()
			.trim();
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
	}

	toggleVisible() {
		this.state.active = !this.state.active;
		this.clearSearch();
		if (this.state.active) this.focusSearch();
	}

	setActive(active: boolean) {
		this.state.active = active;
		if (active) this.focusSearch();
	}

	hide() {
		this.state.active = false;
		this.clearSearch();
	}

	focusSearch() {
		// Wait for the fade-in; focusing a `visibility: hidden` input is a no-op.
		setTimeout(() => this.state.search?.focus(), 60);
	}

	clearSearch() {
		if (this.state.search) {
			this.state.search.value = "";
		}
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
		clickoffChecker.addEventListener("click", () => {
			this.state.active = false;
		});

		this.clickoffChecker = clickoffChecker;
		this.updateClickoffChecker = updateClickoffChecker;

		useChange(use(this.state.active), updateClickoffChecker);

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
				class={[
					use(this.state.active, (active) => (active ? "launcher-active" : "")),
				]}
				on:pointerdown={(e: PointerEvent) => {
					// Clicking the frosted background (not a tile) dismisses.
					if (e.target === e.currentTarget) this.hide();
				}}
			>
				<div class="launcher-search">
					<span class="material-symbols-outlined">search</span>
					<input
						placeholder="Search"
						spellcheck={false}
						autocomplete="off"
						bind:this={use(this.state.search)}
						on:input={this.handleSearch.bind(this)}
						on:keydown={(e: KeyboardEvent) => {
							if (e.key !== "Enter") return;
							const first = this.state.appsView?.querySelector<HTMLElement>(
								'.app:not([style*="display: none"])',
							);
							first?.click();
						}}
					/>
				</div>

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
		);
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
					const path = (app as ExternalApp).source.replace(/^\/fs\//, "");
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
