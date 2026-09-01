class OobeView {
	state = $state({
		color: "transparent",
		text: "var(--ink)",
		step: 0,
		offlineEnabled: true,
		v86Enabled: false,
		localfsdriver: false,
		dlsize: "0MB",
	});

	constructor() {
		useChange([this.state.offlineEnabled, this.state.v86Enabled], () => {
			this.state.dlsize = "0MB";

			if (this.state.offlineEnabled) {
				this.state.dlsize = "~25MB";
			}

			if (this.state.v86Enabled) {
				this.state.dlsize = "1GB";

				if (this.state.offlineEnabled) {
					this.state.dlsize = "~1GB";
				}
			}
		});
	}

	css = css`
		z-index: 9996;
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--theme-font-sans);

		/* Same mesh gradient as the default wallpaper, so setup and desktop
		   feel like one product rather than two. */
		background-image:
			radial-gradient(
				120% 80% at 15% 0%,
				rgba(94, 84, 214, 0.4) 0%,
				transparent 60%
			),
			radial-gradient(
				90% 70% at 95% 15%,
				rgba(38, 132, 255, 0.3) 0%,
				transparent 55%
			),
			radial-gradient(
				110% 90% at 60% 110%,
				rgba(214, 84, 160, 0.26) 0%,
				transparent 60%
			);
		background-color: #06070a;

		#oobe-top {
			width: min(92vw, 760px);
			max-height: 88vh;
			overflow-y: auto;
			border-radius: 22px;
			background: var(--glass-tint);
			backdrop-filter: var(--glass-blur);
			-webkit-backdrop-filter: var(--glass-blur);
			border: 1px solid var(--glass-stroke);
			box-shadow: var(--glass-highlight), var(--shadow-panel);
			animation: oobe-in 0.4s var(--ease-out);
		}

		@keyframes oobe-in {
			from {
				opacity: 0;
				transform: translateY(12px) scale(0.985);
			}
		}

		#content {
			padding: 48px 52px 40px;
			box-sizing: border-box;
		}

		.screen {
			display: flex;
			flex-direction: column;
		}

		.oobe-mark {
			width: 56px;
			height: 56px;
			margin-bottom: 22px;
			filter: drop-shadow(0 6px 20px rgba(120, 110, 255, 0.5));
		}

		.screen h1 {
			margin: 0;
			font-size: 30px;
			font-weight: 680;
			letter-spacing: -0.022em;
			color: var(--ink);
		}

		.screen #subtitle {
			margin: 10px 0 30px 0;
			font-size: 15px;
			color: var(--ink-dim);
		}

		.screen #gridContent {
			display: flex;
			justify-content: flex-end;
			margin-top: 30px;
		}

		.screen .preferredButton {
			background: var(--theme-accent);
			border-radius: 10px;
			border: none;
			color: #fff;
			font-weight: 600;
			font-size: 14px;
			height: 38px;
			padding: 0 22px;
			cursor: pointer;
			font-family: var(--theme-font-sans);
			box-shadow:
				inset 0 1px 0 rgba(255, 255, 255, 0.22),
				0 6px 18px -6px color-mix(in srgb, var(--theme-accent) 80%, transparent);
			transition:
				filter 0.12s ease,
				transform 0.12s var(--ease-out);
		}

		.screen .preferredButton:hover {
			filter: brightness(1.09);
		}

		.screen .preferredButton:active {
			transform: scale(0.97);
		}

		.screen button {
			font-family: var(--theme-font-sans);
			cursor: pointer;
		}

		/* Each choice is a card so the checkbox and its explainer read as one
		   unit instead of a loose stack of rows. */
		.oobe-option {
			border: 1px solid var(--glass-stroke);
			border-radius: 13px;
			padding: 15px 17px;
			margin-bottom: 11px;
			background: rgba(255, 255, 255, 0.04);
			transition: background-color 0.12s ease;
		}

		.oobe-option:hover {
			background: rgba(255, 255, 255, 0.07);
		}

		.oobe-option .matter-checkbox span {
			font-weight: 600;
			font-size: 14.5px;
			color: var(--ink);
		}

		.sub {
			color: var(--ink-faint);
			font-size: 12.5px;
			line-height: 1.5;
			display: flex;
			align-items: flex-start;
			margin-top: 7px;
			& > .material-symbols-outlined {
				font-size: 15px;
				margin-top: 1px;
			}
		}

		.oobe-footnotes {
			display: flex;
			flex-direction: column;
			gap: 4px;
			margin-top: 18px;
			padding-top: 16px;
			border-top: 1px solid var(--hairline);
		}

		.oobe-footnotes .sub {
			margin-top: 0;
		}

		.material-symbols-outlined {
			font-size: 1rem;
		}

		#tracker {
			display: block;
			margin-top: 14px;
			color: var(--ink-dim);
			font-size: 13px;
		}

		.oobe-progress {
			margin-top: 26px;
			width: 100%;
			height: 4px;
			border-radius: 999px;
			background: rgba(255, 255, 255, 0.12);
			overflow: hidden;
		}

		.oobe-progress::after {
			content: "";
			display: block;
			width: 35%;
			height: 100%;
			border-radius: 999px;
			background: linear-gradient(
				90deg,
				transparent,
				var(--theme-accent),
				transparent
			);
			animation: oobe-sweep 1.5s ease-in-out infinite;
		}

		@keyframes oobe-sweep {
			0% {
				transform: translateX(-120%);
			}
			100% {
				transform: translateX(340%);
			}
		}
	`;

	/** The brand triangle, reused across every setup step. */
	mark = () => (
		<svg
			class="oobe-mark"
			viewBox="0 0 96 96"
			xmlns="http://www.w3.org/2000/svg"
		>
			<defs>
				<linearGradient id="oobeGrad" x1="10" y1="4" x2="86" y2="92">
					<stop offset="0" stop-color="#a99cff" />
					<stop offset="0.55" stop-color="#6a5cf0" />
					<stop offset="1" stop-color="#3a2fb0" />
				</linearGradient>
			</defs>
			<path d="M48 4 92 88H4L48 4Z" fill="url(#oobeGrad)" />
			<path d="M48 30 71 74H25l23-44Z" fill="#06070a" fill-opacity="0.5" />
		</svg>
	);

	steps = [
		{
			elm: (
				<div class="screen" id="welcome">
					{this.mark()}
					<h1>Welcome to {BRANDING.name}</h1>
					<div id="subtitle">{BRANDING.tagline}</div>
					<div id="gridContent">
						<div id="bottomButtons">
							<button on:click={() => this.nextStep()} class="preferredButton">
								Get Started
							</button>
						</div>
					</div>
				</div>
			),
			on: () => {},
		},
		{
			elm: (
				<div class="screen" id="features">
					{this.mark()}
					<h1>Choose your experience</h1>
					<div id="subtitle">What kind of {BRANDING.name} user are you?</div>
					<div class="oobe-option">
						<label class="matter-checkbox">
							<input
								type="checkbox"
								bind:checked={use(this.state.offlineEnabled)}
							/>
							<span>Offline Functionality</span>
						</label>
						<div class="sub">
							<span class="material-symbols-outlined">info</span>
							&nbsp;This allows you to use {BRANDING.name} without an internet
							connection.
						</div>
					</div>
					<div class="oobe-option">
						<label class="matter-checkbox">
							<input
								type="checkbox"
								bind:checked={use(this.state.v86Enabled)}
							/>
							<span>Linux Emulation</span>
						</label>
						<div class="sub">
							<span class="material-symbols-outlined">info</span>
							&nbsp;This allows you to run Linux applications on {BRANDING.name}
							.
						</div>
					</div>
					<div class="oobe-option">
						<label class="matter-checkbox">
							<input
								type="checkbox"
								bind:checked={use(this.state.localfsdriver)}
							/>
							<span>Experimental OPFS Driver</span>
						</label>
						<div class="sub">
							<span class="material-symbols-outlined">info</span>
							&nbsp;Use experimental OPFS based filesystem driver. Comes with a
							speed improvement at the cost of system stability.
						</div>
					</div>
					<div class="oobe-footnotes">
						<div id="size" class="sub">
							<span class="material-symbols-outlined">download</span>
							&nbsp;{use(this.state.dlsize)} download
						</div>
						<div class="sub">
							<span class="material-symbols-outlined">info</span>
							&nbsp;These features can always be enabled in Settings.
						</div>
					</div>
					<div id="gridContent">
						<div id="bottomButtons">
							<button
								on:click={async () => {
									anura.settings.set("x86-disabled", !this.state.v86Enabled);
									anura.settings.set("use-sw-cache", this.state.offlineEnabled);
									anura.settings.set("applist", [
										...anura.settings.get("applist"),
										this.state.v86Enabled ? "anura.term" : "anura.ashell",
									]);

									if (this.state.localfsdriver) {
										await (window as any).idbKeyval.set("bootFromOPFS", true);
										navigator.serviceWorker.controller?.postMessage({
											anura_target: "anura.bootFromOPFS",
											value: true,
										});
									}
									this.nextStep();
								}}
								class="preferredButton"
							>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										fontSize: "0.7rem!important",
									}}
								>
									{$if(
										use(this.state.v86Enabled),
										<span>Next</span>,
										<span>
											<span>Finish</span>
										</span>,
									)}

									{$if(
										use(this.state.v86Enabled),
										<span class="material-symbols-outlined">
											chevron_right
										</span>,
									)}
								</div>
							</button>
						</div>
					</div>
				</div>
			),
			on: () => {},
		},
		{
			elm: (
				<div class="screen" id="downloadingFiles">
					<div id="assetsDiv" style="display:none;"></div>
					{this.mark()}
					<h1>Setting things up</h1>
					<div id="subtitle">
						For the best experience, {BRANDING.name} needs to download required
						assets.
					</div>
					<div class="oobe-progress"></div>
					<span id="tracker"></span>
				</div>
			),
			on: async () => {
				await navigator.serviceWorker.controller!.postMessage({
					anura_target: "anura.cache",
					value: anura.settings.get("use-sw-cache"),
				});
				this.state.color = "transparent";
				this.state.text = "var(--ink)";
				if (!anura.settings.get("x86-disabled")) {
					await anura.settings.set("x86-image", "alpine");
					await installx86();
				}
				if (anura.settings.get("use-sw-cache")) await preloadFiles();
				console.debug("Cached important files");

				this.complete();
			},
		},
	];

	element = (
		<div
			class={this.css}
			style={{
				backgroundColor: use(this.state.color),
				color: use(this.state.text),
			}}
		>
			<div id="oobe-top">
				<div id="content">
					{use(this.state.step, (step) => this.steps[step]!.elm)}
				</div>
			</div>
		</div>
	);

	nextStep() {
		this.state.step++;
		const step = this.steps[this.state.step]!;
		if (step.on) step.on();
	}
	async complete() {
		await anura.settings.set("oobe-complete", true);
		if (this.state.localfsdriver) {
			await anura.fs.promises.writeFile(
				"/opfs/anura_settings.json",
				JSON.stringify(anura.settings.cache),
			);
			window.location.reload(); // need to reboot to go through firstboot again if using new opfs driver
		}
		document.dispatchEvent(new Event("anura-login-completed"));
		this.element.remove();
	}
}

async function installx86(tracker = document.getElementById("tracker")) {
	console.debug("installing x86");
	await anura.fs.mkdir("/boot");
	const x86image = anura.settings.get("x86-image");
	tracker!.innerText = "Downloading x86 kernel";
	const bzimage = await fetch(anura.config.x86[x86image].bzimage);
	anura.fs.writeFile(
		"/boot/bzimage",
		Filer.Buffer(await bzimage.arrayBuffer()),
	);
	tracker!.innerText = "Downloading x86 initrd";
	const initrd = await fetch(anura.config.x86[x86image].initrd);
	anura.fs.writeFile(
		"/boot/initrd.img",
		Filer.Buffer(await initrd.arrayBuffer()),
	);

	if (typeof anura.config.x86[x86image].rootfs === "string") {
		const rootfs = await fetch(anura.config.x86[x86image].rootfs);
		const blob = await rootfs.blob();
		//@ts-ignore
		await anura.x86hdd.loadfile(blob);
	} else if (anura.config.x86[x86image].rootfs) {
		// TODO: add batching, this will bottleneck and OOM if the rootfs is too large

		console.debug("fetching");
		// const files = await Promise.all(
		//     anura.config.x86[x86image].rootfs.map((part: string) => fetch(part)),
		// );

		const files: Blob[] = [];
		let limit = 4;
		let i = 0;
		let done = false;
		let doneSoFar = 0;
		const doWhenAvail = function () {
			if (limit === 0) return;
			limit--;
			const assigned = i;
			i++;

			fetch(anura.config.x86[x86image].rootfs[assigned])
				.then(async (response) => {
					if (response.status !== 200) {
						console.error("Status code bad on chunk " + assigned);
						console.error(anura.config.x86[x86image].rootfs[assigned]);
						console.error("Finished " + doneSoFar + " chunks before error");
						anura.notifications.add({
							title: "bad chunk on x86 download",
							description: `Chunk ${assigned} gave status code ${response.status}\nClick me to reload`,
							timeout: 50000,
							callback: () => {
								location.reload();
							},
						});
						return;
					}
					files[assigned] = await response.blob();
					limit++;
					doneSoFar++;
					tracker!.innerHTML = `Downloading x86 rootfs. Chunk ${doneSoFar}/${anura.config.x86[x86image].rootfs.length} done`;
					if (i < anura.config.x86[x86image].rootfs.length) {
						doWhenAvail();
					}
					if (doneSoFar === anura.config.x86[x86image].rootfs.length) {
						done = true;
					}
					console.debug(
						anura.config.x86[x86image].rootfs.length -
							doneSoFar +
							" chunks to go",
					);
				})

				.catch((e) => {
					console.error("Error on chunk " + assigned);
					anura.notifications.add({
						title: "bad chunk on x86 download",
						description: `Chunk ${assigned} had a download error ${e}\nClick me to reload`,
						timeout: 50000,
						callback: () => {
							location.reload();
						},
					});
				}); // Peak error handling right there
		};
		doWhenAvail();
		doWhenAvail();
		doWhenAvail();
		doWhenAvail();
		while (!done) {
			await sleep(200);
		}

		console.debug("constructing blobs...");
		tracker!.innerText = "Concatenating and installing x86 rootfs";
		//@ts-ignore
		await anura.x86hdd.loadfile(new Blob(files));
	}

	console.debug("done");
}

async function preloadFiles(tracker = document.getElementById("tracker")) {
	try {
		const list = await (await fetch("cache-load.json")).json();
		/*
		 * The list has a few items that aren't exactly real
		 * as a result of the developers schizophrenia.
		 * Because of this, there will be a few errors on the fetch.
		 * These can safely be ignored, just like the voices in
		 * the developers head.
		 */
		const chunkSize = 10;
		const promises = [];
		let i = 0;
		for (const item in list) {
			promises.push(fetch(list[item]));
			if (Number(item) % chunkSize === chunkSize - 1) {
				await Promise.all(promises);
			}
			tracker!.innerText = `Downloading anura system files, chunk ${i}/${list.length}`;
			i++;
		}
		await Promise.all(promises);
	} catch (e) {
		console.warn("error durring oobe preload", e);
	}
}
