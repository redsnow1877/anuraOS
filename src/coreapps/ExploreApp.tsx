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
			<h2>A brand new shell</h2>
			<p>
				The desktop has been rebuilt around a menu bar, a magnifying dock, and
				translucent window chrome. Windows have traffic lights, the launcher is
				now a full-screen Launchpad, and Control Center drops down from the top
				right. Almost every surface is frosted glass — you can turn that off
				under Appearance in{" "}
				<span>
					<a href="javascript:anura.apps['anura.settings'].open();">
						<img src="/assets/icons/settings.png" alt="Settings Icon" />
						Settings
					</a>
					.
				</span>
			</p>
			<h2>Experimental OPFS filesystem driver</h2>
			<p>
				{BRANDING.name} includes an experimental filesystem driver for the
				Origin Private File System (OPFS). This greatly improves the speed of
				file operations. You can enable it in{" "}
				<span>
					<a href="javascript:anura.apps['anura.ui.settings'].open();">
						<img src="/assets/icons/settings.png" alt="Settings Icon" />
						Settings
					</a>
					.
				</span>
			</p>
			<h2>VSCode Support</h2>
			<p>
				{BRANDING.name} supports Visual Studio Code. You can download it from
				the Developer Repository in{" "}
				<span>
					<img
						src="/apps/marketplace.app/playstore.webp"
						alt="Marketplace Icon"
					/>
					<a href="javascript:anura.apps['anura.store'].open();">Marketplace</a>
					.
				</span>
			</p>
			<h2>Other changes</h2>
			<ul>
				<li>Added WebDAV endpoint at /dav/*</li>
				<li>Fix UI bugs in the file picker</li>
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
				For advanced users, Anura will execute any files in the /usr/init folder
				as JavaScript code on boot.
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
