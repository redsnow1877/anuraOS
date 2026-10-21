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

/**
 * The Dimension cube, in real 3D: six faces in a preserve-3d box. It spins in
 * and comes to rest at the isometric angle (rotateX -35.26deg, rotateY 45deg),
 * which is exactly the flat logo, so the boot animation ends on the mark.
 * Transforms only, so it runs on the compositor while boot is busy.
 */
function BootMark() {
	return (
		<div class="boot-mark boot-cube" aria-hidden="true">
			<div class="cube-spin">
				<i class="f-top"></i>
				<i class="f-bottom"></i>
				<i class="f-front"></i>
				<i class="f-back"></i>
				<i class="f-left"></i>
				<i class="f-right"></i>
			</div>
		</div>
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
