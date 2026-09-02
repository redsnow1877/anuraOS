/**
 * Boot splashes. All variants share the same skeleton so that Boot.tsx can keep
 * driving `#systemstatus` regardless of which one is on screen.
 *
 * The progress indicator is an AetherPreloader (Preloader.tsx), so the splash
 * picks up whatever variant the user chose in Settings. Preloader.js loads
 * before this file, but the guard keeps a broken build showing *something*
 * rather than an empty splash.
 */

function BootProgress() {
	try {
		return aetherPreloader({
			variant: AetherPreloader.preferred(),
			size: "sm",
		});
	} catch {
		return (<div class="boot-progress"></div>) as HTMLElement;
	}
}

function BootMark() {
	return (
		<svg
			class="boot-mark"
			viewBox="0 0 96 96"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<defs>
				<linearGradient id="bootGrad" x1="10" y1="4" x2="86" y2="92">
					<stop offset="0" stop-color="#a99cff" />
					<stop offset="0.55" stop-color="#6a5cf0" />
					<stop offset="1" stop-color="#3a2fb0" />
				</linearGradient>
				<linearGradient id="bootGlass" x1="30" y1="30" x2="70" y2="80">
					<stop offset="0" stop-color="#ffffff" stop-opacity="0.55" />
					<stop offset="1" stop-color="#ffffff" stop-opacity="0.05" />
				</linearGradient>
			</defs>
			<path d="M48 4 92 88H4L48 4Z" fill="url(#bootGrad)" />
			<path d="M48 30 71 74H25l23-44Z" fill="#06070a" fill-opacity="0.5" />
			<path d="M48 4 92 88H62L48 4Z" fill="url(#bootGlass)" />
		</svg>
	);
}

const bootsplash = (
	<div class="bootsplash">
		{BootMark()}
		<div class="boot-wordmark">{BRANDING.name}</div>
		{BootProgress()}
		<br id="systemstatus-br" style="display: none;" />
		<h2 id="systemstatus" class="boot-status" style="display: none;"></h2>
	</div>
);

const bootsplashMobile = (
	<div class="bootsplash">
		{BootMark()}
		<div class="boot-wordmark">{BRANDING.name}</div>
		{BootProgress()}
		<br id="systemstatus-br" style="display: none;" />
		<h2 id="systemstatus" class="boot-status" style="display: none;"></h2>
	</div>
);

const gangstaBootsplash = (
	<div class="bootsplash">
		{BootMark()}
		<div class="boot-wordmark">Gangster Edition</div>
		<img
			src="/assets/images/gangsta.jpeg"
			style="position: absolute; top: 0; bottom: 0; right: 0; width: auto; height: 100%; filter: brightness(0.95); z-index: -1;"
		/>
		{BootProgress()}
		<br id="systemstatus-br" style="display: none;" />
		<h2 id="systemstatus" class="boot-status" style="display: none;"></h2>
	</div>
);

const TNBootSplash = (
	<div class="bootsplash">
		{BootMark()}
		<div class="boot-wordmark">{BRANDING.name}</div>
		{BootProgress()}
		<br id="systemstatus-br" style="display: none;" />
		<h2 id="systemstatus" class="boot-status" style="display: none;"></h2>
		<span style="position: absolute; bottom: 1.25rem; left: 1.25rem; text-align: left; font-size: 12px; color: var(--ink-faint);">
			More mirrors and links at Titanium Network<br></br>
			discord.gg/unblock
		</span>
	</div>
);
