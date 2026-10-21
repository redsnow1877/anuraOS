class NotificationService {
	state: Stateful<{
		notifications: AnuraNotification[];
		render: boolean;
	}> = $state({
		notifications: [],
		render: true,
	});

	css = css`
		position: absolute;
		float: right;
		display: flex;
		flex-direction: column;
		gap: 10px;
		bottom: 60px;
		right: 10px;
		z-index: 9997;
	`;

	element = (
		<div
			class={this.css}
			style={{
				display: use(this.state.render, (render) => (render ? "flex" : "none")),
			}}
		>
			{/* {use(this.state.notifications, (notifications) =>
                notifications.map((notif) => notif.element),
            )} */}
		</div>
	);

	// For legacy reasons, this is a getter and setter for external use.
	// Internally, you should use this.state.notifications instead.
	get notifications() {
		return this.state.notifications;
	}

	set notifications(value) {
		this.state.notifications = value;
	}

	constructor() {}

	add(params: NotifParams) {
		const notif = new AnuraNotification(params, () => {
			this.remove(notif);
		});

		useChange(use(notif.state.timedOut), (timedOut) => {
			if (timedOut) this.remove(notif, true);
		});

		// Do Not Disturb: the notification is still recorded (the notification
		// centre and its badge still show it) but no toast and no sound.
		const quiet = (globalThis as any).AetherDND?.on;
		if (quiet) {
			this.state.notifications = [...this.state.notifications, notif];
			return;
		}

		// With the island on screen, the notice bursts out of it instead of
		// sliding in as a corner toast. It's still recorded for the centre.
		const island = (globalThis as any).AetherIsland;
		if (island?.present) {
			island.alert({
				icon: notif.icon || "notifications",
				title: notif.title,
				body: notif.description,
				// Toast timeouts are tuned for a big card; the island picks
				// its own from the length of the text unless asked for longer.
				ms:
					typeof notif.timeout === "number" && notif.timeout > 4000
						? notif.timeout
						: undefined,
				sticky: notif.timeout === "never" && notif.buttons.length > 0,
				onTap: () => {
					notif.callback(notif);
					this.remove(notif);
				},
				actions: notif.buttons.map((b) => ({
					label: b.text,
					primary: (b.style || "contained") === "contained",
					run: () => {
						b.callback(notif);
						if (typeof (b as any).close === "undefined" || (b as any).close)
							this.remove(notif);
					},
				})),
			});
			try {
				aetherSound.play("notify");
			} catch {
				/* best-effort */
			}
			this.state.notifications = [...this.state.notifications, notif];
			return;
		}

		this.element.appendChild(notif.element);
		notif.element.classList.add("notif-in");
		notif.element.addEventListener(
			"animationend",
			() => notif.element.classList.remove("notif-in"),
			{ once: true },
		);
		try {
			aetherSound.play("notify");
		} catch {
			/* sound is best-effort — a missing Sound.js must not drop a notice */
		}

		this.state.notifications = [...this.state.notifications, notif];
	}

	remove(notification: AnuraNotification, rendererOnly = false) {
		if (!rendererOnly) {
			this.state.notifications = this.state.notifications.filter(
				(n) => n !== notification,
			);
		}

		// `notif-out` fills to opacity 0, so the node stays invisible for the
		// gap between the animation ending and the timeout firing.
		notification.element.classList.remove("notif-in");
		notification.element.classList.add("notif-out");
		setTimeout(() => {
			notification.element.remove();
		}, 360);
	}

	subscribe(callback: (notifications: AnuraNotification[]) => void) {
		let active = true;

		useChange(use(this.state.notifications), () => {
			if (!active) return;

			callback(this.state.notifications);
		});

		return () => {
			active = false;
		};
	}

	setRender(render: boolean) {
		this.state.render = render;
	}
}

interface NotifParams {
	title?: string;
	description?: string;
	timeout?: number | "never";
	callback?: (notif: AnuraNotification) => void;
	closeIndicator?: boolean;
	buttons?: Array<{
		text: string;
		style?: "contained" | "outlined" | "text";
		callback: (notif: AnuraNotification) => void;
		close?: boolean;
	}>;
	/** A Material Symbols name, shown when the notice comes out of the island. */
	icon?: string;
}

class AnuraNotification implements NotifParams {
	title = `${BRANDING.name} Notification`;
	description = `${BRANDING.name} Description`;
	timeout: number | "never" = 2000;
	closeIndicator = false;
	icon?: string;
	callback = (_notif: AnuraNotification) => null;
	buttons: Array<{
		text: string;
		style?: "contained" | "outlined" | "text";
		callback: (notif: AnuraNotification) => void;
	}> = [];
	close: () => void;

	state = $state({
		timedOut: false,
	});

	css = css`
		background-color: color-mix(
			in srgb,
			var(--theme-dark-bg) 77.5%,
			transparent
		);
		backdrop-filter: blur(30px);
		-webkit-backdrop-filter: blur(30px);
		border-radius: 1em;
		color: white;
		width: 360px;
		cursor: pointer;
		animation: slideIn 0.35s ease-in-out forwards;
		opacity: 1;
		transition: 250ms ease-in-out;
		box-shadow: 0px 5px 5px 0px rgba(0, 0, 0, 0.5);

		&:hover .nbody .ntitle-container .close-indicator {
			opacity: 1;
		}

		.nbody {
			display: flex;
			flex-direction: column;
			padding: 1em;
			gap: 0.5em;

			.ntitle-container {
				display: flex;
				flex-direction: row;

				.ntitle {
					color: var(--theme-fg);
					font-size: 14px;
					font-weight: 700;
					flex-grow: 1;
				}

				.close-indicator {
					width: 16px;
					height: 16px;
					opacity: 0;

					span {
						font-size: 16px;
					}
				}
			}

			.ndescription {
				font-size: 12px;
				color: var(--theme-secondary-fg);
			}

			.nbutton-container {
				display: flex;
				gap: 6px;

				.nbutton {
					flex-grow: 1;
				}
			}
		}
	`;

	element: HTMLElement;
	constructor(params: NotifParams, close: () => void) {
		Object.assign(this, params);
		this.close = close;
		this.buttons = params.buttons || [];
		this.element = (
			<div class={`${this.css} notification`}>
				<div
					class="nbody"
					on:click={(e: PointerEvent) => {
						if ((e.target as HTMLElement).tagName.toLowerCase() !== "button") {
							this.callback(this);
							this.close();
						}
					}}
				>
					<div class="ntitle-container">
						<div class="ntitle">{this.title}</div>
						<div
							class="close-indicator"
							on:click={(e: PointerEvent) => {
								e.stopPropagation();
								this.close();
							}}
						>
							<span class="material-symbols-outlined">close</span>
						</div>
					</div>
					<div class="ndescription">{this.description}</div>
					{$if(
						this.buttons.length > 0,
						<div class="nbutton-container">
							{this.buttons.map(
								(value: {
									text: string;
									style?: "contained" | "outlined" | "text";
									close?: boolean;
									callback: (notif: AnuraNotification) => void;
								}) => (
									<button
										class={[
											"nbutton",
											`matter-button-${value.style || "contained"}`,
										]}
										on:click={() => {
											value.callback(this);
											if (typeof value.close === "undefined" || value.close)
												this.close();
										}}
									>
										{value.text}
									</button>
								),
							)}
						</div>,
					)}
				</div>
			</div>
		);
		// Hide to notif center after period
		this.timeout !== "never" &&
			setTimeout(() => {
				this.state.timedOut = true;
			}, this.timeout);
	}
}
