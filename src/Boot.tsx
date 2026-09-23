const channel = new BroadcastChannel("tab");

// send message to all tabs, after a new tab
channel.postMessage("newtab");
let activetab = true;
let splashToRemove: HTMLElement | null = null;

/*
 * Boot phases are marked with the User Timing API, so they show up as named
 * markers in DevTools' Performance panel and in
 * performance.getEntriesByType("mark") — zero cost when nobody is looking.
 */
function bootMark(phase: string) {
	try {
		performance.mark("aether:" + phase);
	} catch {
		/* User Timing is best-effort */
	}
}

/*
 * The splash used to leave on two fixed timers: boot waited 500ms (1500ms on
 * first run) before even starting to build the desktop, then hid the splash
 * 350ms after that whether or not the desktop was ready. Now it leaves when
 * the desktop (or OOBE) is actually on screen, with a minimum visible time so
 * a fast boot still reads as a deliberate transition rather than a flash.
 */
let splashShownAt = 0;
let splashDismissed = false;
function dismissSplash(minVisibleMs = 350) {
	if (splashDismissed) return;
	splashDismissed = true;
	const wait = Math.max(0, splashShownAt + minVisibleMs - performance.now());
	setTimeout(() => {
		splashToRemove?.classList.add("hide");
		// The splash lifts away and the desktop drops in from behind it, the
		// same bloom as an unlock. Only when there is a desktop: on first run
		// the splash gives way to setup instead.
		if (document.getElementById("dock"))
			(globalThis as any).AetherMotion?.revealDesktop();
		bootMark("splash-hidden");
		setTimeout(() => {
			bootsplash.remove();
			bootsplashMobile.remove();
			gangstaBootsplash.remove();
			TNBootSplash.remove();
		}, 550);
	}, wait);
}
channel.addEventListener("message", (msg) => {
	if (msg.data === "newtab" && activetab) {
		// if there's a previously registered tab that can read the message, tell the other tab to kill itself
		channel.postMessage("blackmanthunderstorm");
	}

	if (msg.data === "blackmanthunderstorm") {
		activetab = false;
		//@ts-ignore
		for (const elm of [...document.children]) {
			elm.remove();
		}
		document.open();
		document.write(
			`
            <html>
            <head>
            <style>
            body {
                font-family: "Roboto", RobotoDraft, "Droid Sans", Arial, Helvetica, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
                text-align: center;
                background: black;
                color: white;
                overflow: none;
                margin: 0;
            }
            #wrapper {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
            }
            </style>
            </head>
            <body>
            <div id="wrapper">
            <h1>{BRANDING.name} is already running in another tab</h1>
            <p>Please close the other tab and reload.</p>
            </div>
            </body>
            </html>
            `,
		);
		document.close();
	}
});

const clickoffCheckerState = $state({
	active: false,
});

const clickoffChecker = (
	<div
		class={[
			use(clickoffCheckerState.active, (active) =>
				active
					? css`
							position: absolute;
							width: 100%;
							height: 100%;
							display: block;
							z-index: 9998;
						`
					: css`
							display: none;
						`,
			),
		]}
	/>
);

const updateClickoffChecker = (show: boolean) => {
	clickoffCheckerState.active = show;
};

let taskbar: Taskbar;
let launcher: Launcher;
let oobeview: OobeView;
let quickSettings: QuickSettings;
let calendar: Calendar;
const alttab = new AltTabView();

let anura: Anura;
// global

window.addEventListener("load", async () => {
	bootMark("boot-start");
	const swShared: any = {
		test: true,
	};

	(window as any).swShared = swShared;

	const comlinksrc = "/libs/comlink/comlink.min.mjs";
	const comlink = await import(comlinksrc);

	let conf, milestone, instancemilestone;
	let bootStrapFs = Filer.fs;

	if (await (window as any).idbKeyval.get("bootFromOPFS")) {
		bootStrapFs = (await LocalFS.newRootOPFS()) as any;
	}
	try {
		// Independent requests — fetch them together.
		[conf, milestone] = await Promise.all([
			fetch("/config.json").then((r) => r.json()),
			fetch("/MILESTONE").then((r) => r.text()),
		]);

		// The cached copy only matters for a later offline boot, so this one
		// doesn't need to hold up the current boot.
		bootStrapFs.promises
			.writeFile("/config_cached.json", JSON.stringify(conf))
			.catch((e: unknown) => console.warn("config cache write failed", e));
	} catch (e) {
		conf = JSON.parse(
			new TextDecoder().decode(
				await bootStrapFs.promises.readFile("/config_cached.json"),
			),
		);
	}

	bootMark("config");
	anura = await Anura.new(conf);
	bootMark("anura-ready");
	if (bootStrapFs instanceof LocalFS) {
		anura.settings.cache["bootFromOPFS"] = true;
	} else {
		anura.settings.cache["bootFromOPFS"] = false;
		LocalFS.newOPFS("/opfs"); // mount opfs on boot
	}

	if (anura.platform.type === "mobile" || anura.platform.type === "tablet") {
		splashToRemove = bootsplashMobile;
		document.body.appendChild(bootsplashMobile);
	} else {
		if (anura.settings.get("i-am-a-true-gangsta")) {
			splashToRemove = gangstaBootsplash;
			document.body.appendChild(gangstaBootsplash);
		} else if (anura.config.tnbranding === true) {
			splashToRemove = TNBootSplash;
			document.body.appendChild(TNBootSplash);
			setupTNBootsplash();
		} else {
			splashToRemove = bootsplash;
			document.body.appendChild(bootsplash);
		}
	}

	splashShownAt = performance.now();
	bootMark("splash-shown");

	swShared.anura = anura;
	swShared.sh = new anura.fs.Shell();
	async function initComlink() {
		// On a first visit the page isn't controlled until the worker claims
		// it; the "controllerchange" listener below calls this again then.
		// Without the guard, the eager call threw an unhandled TypeError on
		// every first boot.
		const controller = navigator.serviceWorker.controller;
		if (!controller) return;
		const { port1, port2 } = new MessageChannel();

		const msg = {
			anura_target: "anura.comlink.init",
			value: port2,
		};

		comlink.expose(swShared, port1);

		controller.postMessage(msg, [port2]);
		if (swShared.anura)
			controller.postMessage({
				anura_target: "anura.nohost.set",
			});
	}

	navigator.serviceWorker.addEventListener("controllerchange", initComlink);

	await navigator.serviceWorker.register("/anura-sw.js");
	initComlink();
	bootMark("sw-registered");

	navigator.serviceWorker.addEventListener("message", (event) => {
		if (event.data.anura_target === "anura.sw.reinit") initComlink(); // this could accidentally be run twice but realistically there aren't any consequences for doing so
	});

	// Create "Process" that controls the service worker

	const swProcess = new SWProcess();
	// We do not want the service worker process to be garbage collected
	// so we will store it in the Window object as well.
	anura.sw = swProcess;
	anura.processes.register(swProcess);

	if (milestone) {
		function isValidUUID(uuid: string) {
			const regex =
				/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
			return regex.test(uuid);
		}
		if (isValidUUID(milestone.split("\n")[0]!)) {
			const stored = anura.settings.get("milestone");
			if (!stored) await anura.settings.set("milestone", milestone);
			else if (stored !== milestone) {
				await anura.settings.set("milestone", milestone);
				if (anura.settings.get("use-sw-cache")) {
					const tracker = document.getElementById("systemstatus")!;
					const tracker_br = document.getElementById("systemstatus-br")!;
					tracker.style.display = "unset";
					tracker_br.style.display = "unset";
					tracker.innerText = `${BRANDING.name} is updating your system\u2026`;
					try {
						await new anura.fs.Shell().promises.rm("/anura_files", {
							recursive: true,
						});
					} catch {
						console.debug("cache already invalidated");
					}
					await preloadFiles(tracker);
				}
				console.debug("invalidated cache");
				window.location.reload();
			}
		} else {
			// Domain is either expired or some non conformant milestone is being delivered (bad extension?)
			// Either way, ignore and dont try and perform an update
			console.log("Anura update poisoning detected...");
		}
	}

	// Register requirements for anurad
	anura.registerLib(new AnuradHelpersLib());

	// Register anurad, claiming PID 1
	const anurad = new Anurad(1);

	anura.anurad = anurad;
	anura.processes.register(anurad);
	AnuradHelpers.setReady("anura.anurad");

	Object.entries(anura)
		.filter(([_, v]) => v !== undefined)
		.map(([k]) => "anura." + k)
		.forEach(AnuradHelpers.setReady);

	/**
	 * These directories are used to load user apps and libs from
	 * the filesystem, along with folder shortcuts and other things.
	 */
	let directories = anura.settings.get("directories");

	const defaultDirectories = {
		apps: "/usr/apps",
		libs: "/usr/lib",
		init: "/usr/init",
		bin: "/usr/bin",
		opt: "/opt",
	};

	const sh = new anura.fs.Shell();

	/**
	 * This is a migration for the new directory structure
	 * introduced in AnuraOS 2.0.0. This is to ensure that
	 * users who have been using AnuraOS for a while can
	 * have a consistent experience with new installations.
	 */
	const map = {
		apps: ["/userApps", "/usr/apps"],
		libs: ["/userLibs", "/usr/lib"],
		init: ["/userInit", "/usr/init"],
	};

	if (directories) {
		const needsMigration = Object.entries(map).filter(
			([key, [old, _new]]) => directories[key] === old,
		);

		if (needsMigration.length > 0) {
			anura.notifications.add({
				title: `${BRANDING.name} Update`,
				description: `${BRANDING.name} has been updated to a new version. Users are recommended to change the installation directory of their apps and libraries to /usr/ to ensure consistency with new installations.`,
				timeout: "never",
				buttons: [
					{
						text: "Migrate Now",
						callback: async () => {
							const migrate = async (oldPath: string, newPath: string) => {
								const parent = newPath.split("/").slice(0, -1);
								await sh.promises.mkdirp(parent.join("/"));
								await anura.fs.promises.rename(oldPath, newPath);
							};

							await Promise.all(
								needsMigration.map(async ([key, [old, newPath]]) => {
									directories[key] = newPath;
									await migrate(old!, newPath!);
								}),
							);

							await anura.settings.set("directories", directories);
						},
					},
				],
			});
		}
	} else {
		await anura.settings.set("directories", (directories = defaultDirectories));
	}

	/**
	 * These directories are required for Anura to function
	 * properly, and are automatically created if they
	 * don't exist.
	 *
	 * This is a setting so that it can be changed by applications
	 * that heavily modify the system. This will also be respected by
	 * the file manager and other system utilities to prevent the user
	 * from removing the shortcuts.
	 */
	let requiredDirectories = anura.settings.get("requiredDirectories");

	if (!requiredDirectories || !requiredDirectories.includes("bin")) {
		await anura.settings.set(
			"requiredDirectories",
			(requiredDirectories = ["apps", "libs", "init", "bin", "opt"]),
		);
	}

	requiredDirectories.forEach(async (k: string) => {
		if (!directories[k]) {
			directories[k] = defaultDirectories[k as keyof typeof defaultDirectories];
			await anura.settings.set("directories", directories);
		}
		try {
			await sh.promises.mkdirp(directories[k]);
		} catch (e) {
			if (e.code !== "EEXIST") {
				console.error(e, " for ", directories[k]);
			}
		}
	});

	if ((await fetch("/fs/?probe")).status !== 404) {
		try {
			const files = await anura.fs.promises.readdir(directories["init"]);
			if (files) {
				for (const file of files) {
					// Init scripts have 2 modes:
					// 1. Normal init scripts, ran after all apps and libs are loaded
					// 2. anurad init scripts, ran before all apps and libs are loaded. These will end with .init.ajs and will be loaded here.
					if (!file.endsWith(".init.ajs")) continue;

					const data = await anura.fs.promises.readFile(
						directories["init"] + "/" + file,
					);
					anurad.addInitScript(new TextDecoder("utf-8").decode(data));
				}
			}
		} catch (e) {
			anura.logger.error(e);
		}
	}

	anura.registerLib(new AnuraGlobalsLib());

	// Register built-in Node Polyfills
	anura.registerLib(new NodeFS());
	anura.registerLib(new NodePrelude());

	// Register vendored NPM packages
	anura.registerLib(new Comlink());
	anura.registerLib(new Mime());
	anura.registerLib(new Fflate());

	// console.log("comlink proxy", swProxy);
	// console.log(await swProxy.test);
	// console.log(await swProxy.testfn());

	launcher = new Launcher(
		clickoffChecker as HTMLDivElement,
		updateClickoffChecker,
	);

	quickSettings = new QuickSettings(
		clickoffChecker as HTMLDivElement,
		updateClickoffChecker,
	);

	calendar = new Calendar(
		clickoffChecker as HTMLDivElement,
		updateClickoffChecker,
	);

	taskbar = new Taskbar();

	oobeview = new OobeView();

	document.body.classList.add("platform-" + anura.platform.type);

	if (anura.settings.get("blur-disable")) {
		document.body.classList.add("blur-disable");
	}

	Object.assign(window, {
		$store,
		anura,
	});

	anura.ui.init();

	if (!anura.settings.get("oobe-complete")) {
		// This is a new install, so an old version containing the old extension
		// handler system can't be installed. We can skip the migration.
		anura.settings.set("handler-migration-complete", true);
	}

	if (!anura.settings.get("handler-migration-complete")) {
		// Convert legacy file handlers
		// This is a one-time migration
		const extHandlers = anura.settings.get("FileExts") || {};

		console.debug("migrating file handlers");
		console.debug(extHandlers);

		for (const ext in extHandlers) {
			const handler = extHandlers[ext];
			if (handler.handler_type === "module") continue;
			if (handler.handler_type === "cjs") continue;
			if (typeof handler === "string") {
				if (handler === "/apps/libfileview.app/fileHandler.js") {
					extHandlers[ext] = {
						handler_type: "module",
						id: "anura.fileviewer",
					};
					continue;
				}
				extHandlers[ext] = {
					handler_type: "cjs",
					path: handler,
				};
			}
		}
		anura.settings.set("FileExts", extHandlers);
		anura.settings.set("handler-migration-complete", true);
	}

	bootMark("boot-completed");
	anura.logger.debug("boot completed");
	document.dispatchEvent(new Event("anura-boot-completed"));

	// Safety net only: if building the desktop throws, don't leave the user
	// staring at the splash forever.
	setTimeout(() => dismissSplash(0), 8000);
});

document.addEventListener("anura-boot-completed", async () => {
	AnuradHelpers.setStage("anura.boot");
	if (anura.settings.get("oobe-complete")) {
		document.dispatchEvent(new Event("anura-login-completed"));
	} else {
		document.body.appendChild(oobeview.element);
		// First run keeps the splash up a little longer — it's the first
		// thing anyone ever sees of the system.
		dismissSplash(1100);
	}
});

document.addEventListener("anura-login-completed", async () => {
	AnuradHelpers.setStage("anura.login");
	const directories = anura.settings.get("directories");
	anura.ui.theme = Theme.new(anura.settings.get("theme"));
	anura.ui.theme.apply();
	AnuradHelpers.setReady("anura.ui.theme");

	const generic = new GenericApp();
	anura.registerApp(generic);

	const browser = new BrowserApp();
	anura.registerApp(browser);

	const settings = new SettingsApp();
	anura.registerApp(settings);

	const taskmgr = new TaskManager();
	anura.registerApp(taskmgr);

	const about = new AboutApp();
	anura.registerApp(about);

	const wallpaper = new WallpaperAndStyle();
	anura.registerApp(wallpaper);

	// const themeEditor = new ThemeEditor();
	// anura.registerApp(themeEditor);

	const calculator = new CalculatorApp();
	anura.registerApp(calculator);

	const textEditor = new TextEditorApp();
	anura.registerApp(textEditor);

	anura.registerApp(new NotesApp());
	anura.registerApp(new ClockApp());
	anura.registerApp(new SketchApp());
	anura.registerApp(new Game2048App());
	anura.registerApp(new PhotosApp());
	anura.registerApp(new MusicApp());

	const explore = new ExploreApp();
	anura.registerApp(explore);

	const regedit = new RegEdit();
	anura.registerApp(regedit);

	const dialog = new Dialog();
	const dialogApp = await anura.registerApp(dialog);
	(anura.dialog as any) = dialogApp;
	AnuradHelpers.setReady("anura.dialog");

	wallpaper.setWallpaper(
		anura.settings.get("wallpaper") ||
			"/assets/wallpaper/bundled_wallpapers/Aether.svg",
	);

	// Every manifest below is known up front — start all the requests now so
	// the in-order registration loops only wait on the slowest one.
	anura.prefetch([
		...anura.config.libs.map((lib: string) => `${lib}/manifest.json`),
		...anura.config.apps.flatMap((app: string) => [
			app,
			`${app}/manifest.json`,
		]),
	]);
	bootMark("core-apps");

	// Restore any missing /usr/bin scripts. Only shells and terminals use
	// them, so this runs alongside the rest of boot instead of in front of
	// it (one stat after another cost ~250 ms of every boot).
	void Promise.all(
		anura.config.bin.map(async (bin: string) => {
			const path = directories.bin + "/" + bin.split("/").slice(-1)[0];
			try {
				await anura.fs.promises.stat(path);
			} catch {
				try {
					await anura.fs.promises.writeFile(
						path,
						await fetch(bin).then((r) => r.text()),
					);
				} catch (e) {
					console.warn("[boot] couldn't restore", path, e);
				}
			}
		}),
	).then(() => bootMark("bin-checked"));

	for (const lib of anura.config.libs) {
		await anura.registerExternalLib(lib);
	}
	bootMark("external-libs");

	for (const app of anura.config.apps) {
		await anura.registerExternalApp(app);
	}
	bootMark("external-apps");

	// Initialize static UI components that utilize anura.ui after loading apps, scripts, libs, so that external apps and libraries can apply overrides.
	await quickSettings.init();
	await calendar.init();
	await launcher.init();
	await taskbar.init();

	// The menu bar already sits at the top of the screen on every form factor,
	// so the old "move the clock out of the taskbar" hack is gone. Compact
	// devices only need a denser Launchpad grid.
	if (anura.platform.type === "mobile" || anura.platform.type === "tablet") {
		const aview: HTMLDivElement = launcher.element.querySelector(".appsView")!;
		aview.style.gridTemplateColumns =
			anura.platform.type === "mobile" ? "repeat(4, 1fr)" : "repeat(6, 1fr)";
	}

	document.body.appendChild(launcher.element);
	document.body.appendChild(launcher.clickoffChecker);
	document.body.appendChild(quickSettings.quickSettingsElement);
	document.body.appendChild(calendar.element);
	document.body.appendChild(quickSettings.notificationCenterElement);
	document.body.appendChild(taskbar.element);
	document.body.appendChild(alttab.element);
	bootMark("desktop-mounted");
	dismissSplash();
	anura.systray = new Systray();
	AnuradHelpers.setReady("anura.systray");

	anura.ui.theme.apply();

	// Shell chrome extras. All three are self-gating: the cursor turns itself
	// off on coarse pointers, the sound engine no-ops without WebAudio, and
	// AetherMotion just mirrors the existing disable-animation setting onto
	// <body>. Kept in a try so a failure here can't block the desktop.
	try {
		AetherCursor.init();
		AetherMotion.sync();
		aetherSound.play("boot");
	} catch (e) {
		console.warn("shell chrome init failed", e);
	}

	// Global shortcuts and Spotlight. Each registration is independent, so a
	// feature whose script failed to load just doesn't get its shortcut.
	try {
		AetherShortcuts.init();
		AetherSpotlight.init();
		const spotlight = {
			group: "System",
			description: "Spotlight search",
			handler: () => AetherSpotlight.toggle(),
		};
		AetherShortcuts.register({ ...spotlight, combo: "Ctrl+Space" });
		AetherShortcuts.register({ ...spotlight, combo: "Ctrl+K" });
		AetherShortcuts.register({ ...spotlight, combo: "Alt+Space" });
		const mc = {
			group: "Windows",
			description: "Mission Control",
			handler: () => AetherMissionControl.toggle(),
		};
		AetherShortcuts.register({ ...mc, combo: "F3" });
		AetherShortcuts.register({ ...mc, combo: "Ctrl+ArrowUp" });
		AetherShortcuts.register({
			combo: "Ctrl+Alt+D",
			group: "Windows",
			description: "Show Desktop",
			handler: () => AetherMissionControl.toggleDesktop(),
		});
		AetherCommands.register({
			id: "mission-control",
			title: "Mission Control",
			subtitle: "See all open windows",
			icon: "view_quilt",
			keywords: ["expose", "overview", "windows", "switch"],
			shortcut: "F3",
			run: () => AetherMissionControl.enter(),
		});
		AetherCommands.register({
			id: "show-desktop",
			title: "Show Desktop",
			icon: "desktop_windows",
			keywords: ["hide windows", "clear"],
			shortcut: "Ctrl+Alt+D",
			run: () => AetherMissionControl.toggleDesktop(),
		});
		AetherHotCorners.init();
		AetherLockScreen.init();
		AetherSnapLayouts.init();
		AetherSnapLayouts.registerShortcuts();

		AetherDND.sync();
		AetherNightShift.init();
		AetherBrightness.sync();
		AetherMusic.init();
		AetherIsland.init();
		AetherRGB.init();
		AetherScreensaver.init();
		AetherBattery.init();
		AetherClipboard.init();
		AetherDesktopWidgets.init();
		AetherCommands.register({
			id: "widgets",
			title: "Add Widgets to Desktop",
			icon: "widgets",
			keywords: ["widget", "desktop", "clock", "weather"],
			run: () => AetherDesktopWidgets.openPicker(),
		});
		AetherCommands.register({
			id: "setup",
			title: "Run Setup Assistant",
			subtitle: "Name, look, privacy, browsing. Files and apps stay put",
			icon: "restart_alt",
			keywords: ["oobe", "welcome", "first run", "onboarding", "setup"],
			run: async () => {
				const ok = await anura.dialog.confirm(
					`${BRANDING.name} will restart into the Setup Assistant. Your files and apps stay as they are.`,
				);
				if (!ok) return;
				await anura.settings.set("oobe-complete", false);
				location.reload();
			},
		});

		const shot = (combo: string, description: string, fn: () => void) =>
			AetherShortcuts.register({
				combo,
				group: "Screenshots",
				description,
				handler: fn,
			});
		shot("Ctrl+Shift+3", "Capture the screen", () =>
			AetherScreenshot.capture(),
		);
		shot("Ctrl+Shift+4", "Capture a region", () =>
			AetherScreenshot.captureRegion(),
		);
		shot("Ctrl+Shift+5", "Start / stop screen recording", () =>
			AetherScreenshot.toggleRecording(),
		);
		AetherCommands.register({
			id: "screenshot",
			title: "Take Screenshot",
			icon: "screenshot_monitor",
			keywords: ["capture", "screen", "print screen", "snapshot"],
			shortcut: "Ctrl+Shift+3",
			run: () => setTimeout(() => AetherScreenshot.capture(), 250),
		});
		AetherCommands.register({
			id: "screenshot-region",
			title: "Capture Region",
			icon: "screenshot_region",
			keywords: ["screenshot", "crop", "snip", "area"],
			shortcut: "Ctrl+Shift+4",
			run: () => setTimeout(() => AetherScreenshot.captureRegion(), 250),
		});
		AetherCommands.register({
			id: "record",
			title: () =>
				AetherScreenshot.recording ? "Stop Recording" : "Record Screen",
			icon: "screen_record",
			keywords: ["video", "capture", "recording"],
			shortcut: "Ctrl+Shift+5",
			run: () => setTimeout(() => AetherScreenshot.toggleRecording(), 250),
		});
		AetherShortcuts.register({
			combo: "Ctrl+/",
			group: "System",
			description: "Show keyboard shortcuts",
			handler: () => AetherShortcutSheet.toggle(),
		});
		AetherCommands.register({
			id: "shortcuts",
			title: "Keyboard Shortcuts",
			icon: "keyboard",
			keywords: ["keys", "hotkeys", "help", "cheat sheet"],
			shortcut: "Ctrl+/",
			run: () => AetherShortcutSheet.open(),
		});
		AetherCommands.register({
			id: "dnd",
			title: () => `Turn ${AetherDND.on ? "Off" : "On"} Do Not Disturb`,
			subtitle: "Focus",
			icon: "bedtime",
			keywords: ["focus", "silence", "notifications", "quiet", "dnd"],
			run: () => AetherDND.toggle(),
		});
		AetherCommands.register({
			id: "night-shift",
			title: () => `Turn ${AetherNightShift.active ? "Off" : "On"} Night Shift`,
			subtitle: "Display",
			icon: "nightlight",
			keywords: ["warm", "blue light", "night", "eyes"],
			run: () => AetherNightShift.toggle(),
		});

		// Control Center's toggle grid has always been empty; give it the
		// switches people actually reach for.
		const tile = (
			registry: string,
			name: string,
			icon: string,
			description: string,
			onToggle?: (v: any) => void,
		) => ({
			registry,
			name,
			icon,
			description,
			type: "boolean",
			value: anura.settings.get(registry),
			onToggle,
		});
		quickSettings.state.pinnedSettings = [
			tile("aether.dnd", "Focus", "bedtime", "Do Not Disturb", () =>
				AetherDND.sync(),
			),
			{
				...tile(
					"aether.nightshift.on",
					"Night Shift",
					"nightlight",
					"Warmer colours",
				),
				value: AetherNightShift.active,
				onToggle: (v: boolean) => AetherNightShift.save({ on: !!v }),
			},
			tile("blur-disable", "Performance", "speed", "Turn off blur", (v) =>
				document.body.classList.toggle("blur-disable", !!v),
			),
			tile("sound-enabled", "Sounds", "volume_up", "Interface sounds", () =>
				aetherSound.refresh(),
			),
			tile("aether.rgb", "RGB", "palette", "RGB lighting", () =>
				AetherRGB.sync(),
			),
		];
		AetherShortcuts.register({
			combo: "Ctrl+Alt+L",
			group: "System",
			description: "Lock screen",
			handler: () => AetherLockScreen.lock(),
		});
		AetherCommands.register({
			id: "lock-screen",
			title: "Lock Screen",
			icon: "lock",
			keywords: ["sleep", "away", "privacy"],
			shortcut: "Ctrl+Alt+L",
			run: () => AetherLockScreen.lock(),
		});
		AetherCommands.register({
			id: "spotlight",
			title: "Spotlight Search",
			icon: "search",
			shortcut: "Ctrl+Space",
			run: () => AetherSpotlight.init().open(),
		});
	} catch (e) {
		console.warn("spotlight init failed", e);
	}

	(window as any).taskbar = taskbar;
	// The desktop is on screen and populated (setup waits for this to hand
	// over to it).
	document.dispatchEvent(new Event("aether-desktop-ready"));

	// Initializes apps and libs from userApps/ and userLibs/ and runs any user specified init scripts
	await bootUserCustomizations();
	bootMark("user-customizations");

	if (!anura.settings.get("x86-disabled")) {
		await bootx86();
	}

	if (anura.settings.get("kiosk-mode")) {
		taskbar.element.remove();
		// There is a race condition here, but it doesn't matter
		// because this feature is a joke
		await sleep(1000);
		anura.settings.get("kiosk-apps").forEach((app: string) => {
			anura.apps[app].open();
		});
	}

	const desktopCtx = new ContextMenu(true); // we are init'ing before anura so this is needed

	desktopCtx.addItem(
		"Widgets…",
		() => (globalThis as any).AetherDesktopWidgets?.openPicker(),
		"widgets",
	);
	desktopCtx.addItem(
		"Set wallpaper & style",
		() => {
			// this however will execute after anura is init'ed
			anura.apps["anura.wallpaper"].open();
		},
		"brush",
	);

	document.addEventListener("contextmenu", function (e) {
		if (e.shiftKey) return;
		e.preventDefault();
		if (e.target === document.body) {
			desktopCtx.show(e.clientX, e.clientY);
		}
	});

	document.addEventListener("keydown", (e) => {
		if (e.shiftKey && e.key.toLowerCase() === "tab") {
			e.preventDefault();
			alttab.onComboPress();
		}
		// The Launchpad key is Meta pressed *alone*. It used to fire on Meta's
		// keydown, so every Meta+key combination opened the Launchpad before
		// the second key even arrived. Now a press only counts if no other key
		// joined it before release.
		if (e.key === "Meta") {
			metaAlone = true;
		} else if (e.metaKey) {
			metaAlone = false;
		}
	});
	let metaAlone = false;
	document.addEventListener("keyup", (e) => {
		if (e.key.toLowerCase() === "shift") {
			alttab.onModRelease();
			return;
		}
		if (e.key === "Meta") {
			const alone = metaAlone;
			metaAlone = false;
			if (alone && anura.settings.get("launcher-keybind")) {
				quickSettings.close();
				calendar.close();
				launcher.toggleVisible();
			}
		}
	});
	// Clicking or switching away while Meta is down must not count as "alone".
	document.addEventListener("pointerdown", () => {
		metaAlone = false;
	});
	window.addEventListener("blur", () => {
		metaAlone = false;
	});

	anura.initComplete = true;
	AnuradHelpers.setReady("anura.initComplete");
	taskbar.updateTaskbar();
	alttab.update();

	if (!anura.settings.get("explore-shown")) {
		explore.open();
		anura.settings.set("explore-shown", true);
	}
});
async function bootx86() {
	const mgr = new x86MgrApp();
	await anura.registerApp(mgr);

	await anura.registerApp(new XFrogApp());

	await anura.registerApp(
		new XAppStub("X Calculator", "anura.xcalc", "", "xcalc"),
	);
	await anura.registerApp(new XAppStub("XTerm", "anura.xterm", "", "xterm"));
	anura.x86 = new V86Backend(anura.x86hdd);
	AnuradHelpers.setReady("anura.x86");

	anura.settings
		.get("user-xapps")
		.forEach((stub: { name: string; cmd: string; id: string }) => {
			console.debug("registering user xapp", stub);
			anura.registerApp(new XAppStub(stub.name, stub.id, "", stub.cmd));
		});
	AnuradHelpers.setStage("anura.bootx86");
}
async function bootUserCustomizations() {
	const directories = anura.settings.get("directories");
	console.debug("directories", directories);
	if ((await fetch("/fs/?probe")).status === 404) {
		// Safe mode
		// Register recovery helper app
		const recovery = new RecoveryApp();
		anura.registerApp(recovery);
		anura.notifications.add({
			title: `${BRANDING.name} Error`,
			description: `${BRANDING.name} detected a system fault and booted in safe mode. Click this notification to enter the recovery app.`,
			timeout: "never",
			callback: () => anura.apps["anura.recovery"].open(),
		});

		const safeMode = document.createElement("span");
		safeMode.style.position = "absolute";
		safeMode.style.bottom = "calc(var(--dock-reserve) + 1rem)";
		safeMode.style.color = "#ff5533";
		safeMode.style.fontWeight = "bold";
		safeMode.style.fontSize = "1.25rem";
		safeMode.style.right = "1.5rem";
		safeMode.style.textAlign = "left";
		safeMode.textContent = "Safe Mode";
		document.body.appendChild(safeMode);
	} else {
		// Not in safe mode
		// Load all user provided init scripts
		try {
			const files = await anura.fs.promises.readdir(directories["init"]);
			// Fixes a weird edgecase that I was facing where no user apps are installed, nothing breaks it just throws an error which I would like to mitigate.
			if (files) {
				for (const file of files) {
					// Init scripts have 2 modes:
					// 1. Normal init scripts, ran after all apps and libs are loaded
					// 2. anurad init scripts, ran before all apps and libs are loaded. These will end with .init.ajs and will not be loaded here.
					if (file.endsWith(".init.ajs")) continue;

					try {
						const data = await anura.fs.promises.readFile(
							directories["init"] + "/" + file,
						);
						const script = `try {
                            ${new TextDecoder("utf-8").decode(data)}
                        } catch (e) {
                            console.error(e);
                        }`;

						const process = anura.processes.create(script);
						process.title = file;
					} catch (e) {
						anura.logger.error("Anura failed to load a script " + e);
					}
				}
			}
		} catch (e) {
			anura.logger.error(e);
		}
	}

	// Load all persistent sideloaded libs
	try {
		const files = await anura.fs.promises.readdir(directories["libs"]);
		if (files === undefined) return;
		for (const file of files) {
			try {
				await anura.registerExternalLib(`/fs/${directories["libs"]}/${file}/`);
			} catch (e) {
				anura.logger.error("Anura failed to load a lib", e);
			}
		}
	} catch (e) {
		anura.logger.error(e);
	}

	// Load all persistent sideloaded apps
	try {
		const files = await anura.fs.promises.readdir(directories["apps"]);
		if (files) {
			for (const file of files) {
				const { type } = await anura.fs.promises.stat(
					`${directories["apps"]}/${file}`,
				);
				if (type === "DIRECTORY") {
					try {
						await anura.registerExternalApp(
							`/fs/${directories["apps"]}/${file}/`,
						);
					} catch (e) {
						anura.logger.error("Anura failed to load an app", e);
					}
				} else {
					// This is a shortcut file
					const shortcut = JSON.parse(
						(
							await anura.fs.promises.readFile(`${directories["apps"]}/${file}`)
						).toString(),
					);
					anura.registerApp(new ShortcutApp(file, shortcut));
				}
			}
		}
	} catch (e) {
		anura.logger.error(e);
	}

	AnuradHelpers.setStage("anura.bootUserCustomizations");
}

function setupTNBootsplash() {
	const TNMark = document.createElement("span");
	TNMark.setAttribute("style", "position: absolute; bottom: 70px; right: 10px");
	TNMark.innerHTML =
		"Instance hosted by Titanium Network.<br>More mirrors at discord.gg/unblock";
	TNMark.onclick = () => {
		anura.apps["anura.browser"].open([
			"https://discord.com/invite/unblock/login",
		]);
	};
	document.body.appendChild(TNMark);
}
