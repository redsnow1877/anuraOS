class ExploreApp extends App {
	name = "Explore";
	package = "anura.explore";
	icon = "/assets/icons/explore.png";
	hidden = false;

	css = css`
		background-color: var(--theme-bg);
		color: var(--theme-fg);
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: row;

		#sidebar {
			width: 22rem;
			padding: 1rem;
			padding-left: 0;

			& div {
				padding-block: 0.7rem;
				font-size: 1.1rem;
				border-radius: 0 3rem 3rem 0;
				padding-left: 1.25em;
				display: flex;
				align-items: center;
				gap: 0.5rem;
				font-weight: 600;
				width: 100%;

				transition: 0.2s;
			}

			& div.selected {
				color: color-mix(in srgb, var(--theme-accent) 35%, var(--theme-fg));
				background-color: color-mix(
					in srgb,
					var(--theme-accent) 30%,
					transparent
				);
				font-weight: 700;

				transition: 0.15s ease;
			}
		}

		h1 {
			font-size: 2em;
		}

		article {
			width: 100%;
			height: 100%;
			overflow-y: auto;
		}

		a,
		a:link {
			color: var(--theme-accent);
		}

		a:visited {
			color: var(--theme-accent);
		}

		#body {
			font-size: 1.05rem;
			padding: 1rem;
			padding-left: 2rem;

			& p {
				margin-block: 0.5rem;
			}

			& p img {
				width: 1.05rem;
				height: 1.05rem;
				top: 0.2rem;
				position: relative;
				margin-right: 0.2rem;
			}

			& span:has(img) {
				gap: 0.2rem;
				align-items: center;
				font-weight: 600;
			}

			& code {
				background-color: var(--theme-secondary-bg);
				padding: 0.1rem 0.3rem;
				border-radius: 0.2rem;
				font-family: var(--theme-font-mono);
			}

			& h2 {
				margin-block: 1.5rem 0;
			}

			& kbd {
				font-family: var(--theme-font-sans);
				font-size: 0.8em;
				padding: 0.1em 0.45em;
				border-radius: 0.35em;
				border: 1px solid rgba(255, 255, 255, 0.18);
				border-bottom-width: 2px;
				background: rgba(255, 255, 255, 0.08);
				white-space: nowrap;
			}

			& .app-link img {
				width: 1.1em;
				height: 1.1em;
				vertical-align: -0.2em;
				margin-right: 0.2em;
			}

			& h2:first-of-type {
				margin-block-start: 0.25rem;
			}
		}

		.head {
			display: flex;
			flex-direction: row;

			gap: 1rem;
			align-items: center;

			& img {
				width: 2.5rem;
				height: 2.5rem;
			}
		}

		::-webkit-scrollbar {
			width: 8px;
		}

		::-webkit-scrollbar-thumb {
			background-color: var(--theme-secondary-bg);
			border-radius: 8px;
		}

		::-webkit-scrollbar-button {
			display: none;
		}
	`;

	constructor() {
		super();
	}

	whatsnew = (
		<div id="body">
			<h1>
				What's new in {BRANDING.name} {anura.version.pretty}?
			</h1>
			<p>
				Press <kbd>Ctrl</kbd> <kbd>/</kbd> at any time to see every keyboard
				shortcut.
			</p>

			<h2>Spotlight</h2>
			<p>
				<kbd>Ctrl</kbd> <kbd>Space</kbd> (or the search icon in the menu bar)
				searches everything at once: apps, open windows, files, notes and
				settings. It also does maths (<code>12*(3+4)^2</code>), converts units (
				<code>5 km to mi</code>, <code>72 f in c</code>), runs commands like
				"Lock Screen" or "Turn On Night Shift", and opens web addresses.
			</p>

			<h2>Mission Control and hot corners</h2>
			<p>
				<kbd>F3</kbd> spreads every open window out so you can pick one — they
				stay live while you look. <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>D</kbd>{" "}
				slides everything aside to show the desktop. Push the pointer into the
				top-left corner for Mission Control, or the bottom-right for the
				desktop; each corner is configurable under Desktop in Settings.
			</p>

			<h2>Snap layouts</h2>
			<p>
				Rest the pointer on a window's green button to pick a layout — halves,
				thirds, quarters and more. From the keyboard, <kbd>Ctrl</kbd>{" "}
				<kbd>Alt</kbd> with the arrow keys snaps, maximises and restores.
			</p>

			<h2>Widgets, on the desktop too</h2>
			<p>
				The Launchpad has a rail of widgets — weather, clocks, calendar, system
				stats, a scratchpad and more. Pin any of them to the desktop with the
				pin on its card, or right-click the desktop and choose Widgets.
			</p>

			<h2>Lock screen, Focus and Night Shift</h2>
			<p>
				<kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>L</kbd> locks the screen. An
				optional passcode and auto-lock live under Desktop in Settings. Control
				Center now has Focus (Do Not Disturb), Night Shift, Performance mode and
				RGB toggles, display brightness and system volume sliders, and Now
				Playing. On a laptop, the menu bar shows your battery.
			</p>

			<h2>Music</h2>
			<p>
				<a class="app-link" href="javascript:anura.apps['anura.music'].open();">
					<img src="/assets/icons/music.svg" alt="" />
					Music
				</a>{" "}
				plays everything in /Documents/Music, with a live visualizer (Orb, Bars
				or Wave) that takes its colours from the album art. Songs keep playing
				when the window closes; Control Center's Now Playing card, Spotlight
				("Next Song") and your keyboard's media keys control them. No music yet?
				Music can compose a small demo album for you, synthesized right in the
				browser.
			</p>

			<h2>The island</h2>
			<p>
				A black pill in the middle of the menu bar shows what's happening right
				now: the song that's playing (hover it for the full player), a running
				Clock timer, a screen recording, and volume, brightness and battery
				levels as they change.
			</p>

			<h2>RGB mode</h2>
			<p>
				Because a setup without RGB is just a setup: rainbow lighting chases
				around the dock, the island and the focused window. Turn it on in
				Control Center; Settings has a speed slider from chill to party.
			</p>

			<h2>Emoji, symbols and clipboard history</h2>
			<p>
				<kbd>Ctrl</kbd> <kbd>⇧</kbd> <kbd>Space</kbd> opens searchable emoji,
				kaomoji ¯\_(ツ)_/¯ and symbols, and types your pick wherever you were
				typing. <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>V</kbd> shows everything
				you've copied recently; pin the things you paste often.
			</p>

			<h2>Screen savers</h2>
			<p>
				Starfield, Aurora, Flurry, and Bounce: the clock bouncing around the
				screen like a certain DVD logo. Pick one and the idle time under Desktop
				in Settings, or give a hot corner the job.
			</p>

			<h2>Screenshots and screen recording</h2>
			<p>
				<kbd>Ctrl</kbd> <kbd>⇧</kbd> <kbd>3</kbd> captures the screen,{" "}
				<kbd>Ctrl</kbd> <kbd>⇧</kbd> <kbd>4</kbd> a region, and <kbd>Ctrl</kbd>{" "}
				<kbd>⇧</kbd> <kbd>5</kbd> records it. Your browser asks for permission
				each time.
			</p>

			<h2>New apps</h2>
			<ul>
				<li>
					<a
						class="app-link"
						href="javascript:anura.apps['anura.notes'].open();"
					>
						<img src="/assets/icons/notes.svg" alt="" />
						Notes
					</a>{" "}
					— quick notes, saved as files and searchable from Spotlight
				</li>
				<li>
					<a
						class="app-link"
						href="javascript:anura.apps['anura.clock'].open();"
					>
						<img src="/assets/icons/clock.svg" alt="" />
						Clock
					</a>{" "}
					— world clock, alarms, stopwatch and timer
				</li>
				<li>
					<a
						class="app-link"
						href="javascript:anura.apps['anura.sketch'].open();"
					>
						<img src="/assets/icons/sketch.svg" alt="" />
						Sketch
					</a>{" "}
					— draw and paint, with pen pressure
				</li>
				<li>
					<a
						class="app-link"
						href="javascript:anura.apps['anura.music'].open();"
					>
						<img src="/assets/icons/music.svg" alt="" />
						Music
					</a>{" "}
					— your library, a visualizer, and a demo album it writes itself
				</li>
				<li>
					<a
						class="app-link"
						href="javascript:anura.apps['anura.photos'].open();"
					>
						<img src="/assets/icons/photos.svg" alt="" />
						Photos
					</a>{" "}
					— your screenshots, sketches and imported pictures
				</li>
				<li>
					<a
						class="app-link"
						href="javascript:anura.apps['anura.calculator'].open();"
					>
						<img src="/assets/icons/calculator.svg" alt="" />
						Calculator
					</a>
					,{" "}
					<a
						class="app-link"
						href="javascript:anura.apps['anura.texteditor'].open();"
					>
						<img src="/assets/icons/texteditor.svg" alt="" />
						Text Editor
					</a>{" "}
					and{" "}
					<a
						class="app-link"
						href="javascript:anura.apps['anura.2048'].open();"
					>
						<img src="/assets/icons/2048.svg" alt="" />
						2048
					</a>
				</li>
			</ul>

			<h2>Faster</h2>
			<p>
				The desktop appears in well under a second on a returning visit, and an
				idle desktop does next to no background work: animations and meters
				sleep whenever there's nothing new to show.
			</p>

			<h2>Also</h2>
			<ul>
				<li>
					An experimental OPFS filesystem driver for much faster file access,
					under{" "}
					<a href="javascript:anura.apps['anura.settings'].open();">Settings</a>
				</li>
				<li>
					Visual Studio Code, from the Developer Repository in{" "}
					<a href="javascript:anura.apps['anura.store'].open();">Marketplace</a>
				</li>
				<li>A WebDAV endpoint at /dav/*</li>
			</ul>
		</div>
	);

	v86 = () => (
		<div id="body" class="v86">
			<h1>Using the x86 Subsystem</h1>
			<p>
				{BRANDING.name} includes an x86 subsystem (based on{" "}
				<a
					href="javascript:anura.apps['anura.browser'].open(['https://github.com/copy/v86']);" // using dreamland on:click or html onclick makes the link not blue
				>
					v86
				</a>
				), which lets you run real Linux inside {BRANDING.name}.
				{anura.x86 === undefined && (
					<p>
						It seems like you dont have the subsystem enabled. You can install
						it from{" "}
						<span>
							<img src="/assets/icons/settings.png" alt="Settings icon" />
							<a href="javascript:anura.apps['anura.settings'].open();">
								Settings
							</a>
						</span>
						.
					</p>
				)}
				{anura.x86 !== undefined && (
					<p>
						You can open a terminal using the{" "}
						<span>
							<img src="/assets/icons/terminal.png" alt="v86 Terminal Icon" />
							<a href="javascript:anura.apps['anura.ashell'].open(['--cmd', '/usr/bin/x86-run.ajs']);">
								v86 Terminal
							</a>
						</span>{" "}
						app.
					</p>
				)}
			</p>
			<p>
				The x86 subsystem is based on an Alpine Linux, a lightweight distro
				commonly used in containers. To install packages, you can run{" "}
				<code>apk add &lt;package&gt;</code>.
			</p>
			<p>
				If you want to create a shortcut for an X11 app in the launcher, you can
				do so from{" "}
				<span>
					<img src="/assets/icons/settings.png" alt="Settings icon" />
					<a href="javascript:anura.apps['anura.settings'].open();">Settings</a>
				</span>
				.
			</p>
		</div>
	);

	welcome = (
		<div id="body">
			<div class="head">
				<img src="/icon.png" alt="Logo" />
				<h1>Welcome to {BRANDING.name}!</h1>
			</div>
			<h2>What is {BRANDING.name}?</h2>
			<p>
				{BRANDING.name} is a desktop environment made for development that runs
				right in your browser. It features full Linux emulation and a robust app
				ecosystem.
			</p>
			<h2>Getting Started</h2>
			<p>
				It works the way a desktop should: open apps from Launchpad (the grid
				icon at the left of the dock, or press the Meta key), drag windows
				around by their title bars, and keep the apps you use in the dock. The
				menu bar along the top carries the clock, Control Center and
				notifications.
			</p>

			<h2>Get new apps</h2>
			<p>
				To install more native apps, head to the{" "}
				<span>
					<img
						src="/apps/marketplace.app/playstore.webp"
						alt="Marketplace Icon"
					/>
					<a href="javascript:anura.apps['anura.store'].open();">Marketplace</a>
					.
				</span>
			</p>
			<h2>Customize your experience</h2>
			<p>
				{BRANDING.name} has robust customization features. You can change the
				wallpaper and system colors using{" "}
				<span>
					<a href="javascript:anura.apps['anura.wallpaper'].open();">
						<img
							src="/assets/icons/wallpaper.png"
							alt="Wallpaper Selector Icon"
						/>
						Wallpaper &amp; Style
					</a>
				</span>
				.
			</p>
			<p>
				For advanced users, {BRANDING.name} will execute any files in the
				/usr/init folder as JavaScript code on boot.
			</p>
		</div>
	);
	state: Stateful<{
		screen?: HTMLElement;
	}> = $state({
		screen: this.welcome,
	});

	page = async () => (
		<div class={this.css}>
			<div id="sidebar">
				<div
					on:click={() => {
						this.state.screen = this.welcome;
					}}
					class:selected={use(this.state.screen, (sc) => sc === this.welcome)}
				>
					<span class="material-symbols-outlined">kid_star</span>
					Welcome
				</div>
				<div
					on:click={() => {
						this.state.screen = this.whatsnew;
					}}
					class:selected={use(this.state.screen, (sc) => sc === this.whatsnew)}
				>
					<span class="material-symbols-outlined">history</span>
					What's new
				</div>
				<div
					on:click={() => {
						this.state.screen = this.v86();
					}}
					class:selected={use(this.state.screen, (sc: HTMLElement) =>
						sc.classList.contains("v86"),
					)}
				>
					<span class="material-symbols-outlined">memory</span>
					x86 Subsystem
				</div>
			</div>
			<article>{use(this.state.screen)}</article>
		</div>
	);

	async open(args: string[] = []): Promise<WMWindow | undefined> {
		const win = anura.wm.create(this, {
			title: `Explore ${BRANDING.name}`,
			width: `calc(${window.innerHeight * 0.6}px * 16 / 10)`, // manually calculating to prevent wonky behaviour on window resize
			height: `${window.innerHeight * 0.6}px`,
		});
		win.content.style.backgroundColor = "var(--theme-bg)";
		win.content.style.color = "var(--theme-fg)";
		win.content.style.height = "calc(100% - 24px)"; // very dirty hack
		win.content.appendChild(await this.page());

		return win;
	}
}
