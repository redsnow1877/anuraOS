// Dimension: run programs from the bin directory by name.
//
// Upstream chimerix only knows its builtins on anuraOS, so `neofetch` can't
// find /usr/bin/neofetch.ajs. This provider is copied into a scratch copy of
// the shell's source at build time (tools/chimerix/build.sh) and added after
// the builtins, so a builtin of the same name still wins.
//
// A program gets its arguments as main(args), writes with print/println,
// and is done when it calls exit(). One that reads keys declares it in its
// header: #! {"lang":"module","stdin":true}. The terminal's size is on
// globalThis.term ({ rows, cols }) before main runs.

export class AjsCommandProvider {
	async #find(id, ctx) {
		if (!id || id.includes("/")) return undefined;
		const anura = globalThis.anura;
		let dir = "/usr/bin";
		try {
			dir = anura.settings.get("directories")?.bin || dir;
		} catch {
			/* default */
		}
		const path = `${dir}/${id}.ajs`;
		try {
			await anura.fs.promises.stat(path);
		} catch {
			return undefined;
		}
		return {
			name: id,
			path,
			execute: (ctx) => runAjs(anura, path, ctx),
		};
	}

	async lookup(id, { ctx }) {
		return this.#find(id, ctx);
	}

	async lookupAll(id, { ctx }) {
		const c = await this.#find(id, ctx);
		return c ? [c] : undefined;
	}

	async complete(query) {
		const anura = globalThis.anura;
		try {
			const dir = anura.settings.get("directories")?.bin || "/usr/bin";
			const names = await anura.fs.promises.readdir(dir);
			return names
				.filter((n) => n.endsWith(".ajs") && !n.endsWith(".init.ajs"))
				.map((n) => n.slice(0, -4))
				.filter((n) => n.startsWith(query));
		} catch {
			return [];
		}
	}
}

async function runAjs(anura, path, ctx) {
	const proc = await anura.processes.execute(path, ctx.locals.args || []);
	try {
		proc.window.term = { rows: ctx.env.ROWS || 24, cols: ctx.env.COLS || 80 };
	} catch {
		/* frame not ready; programs fall back to 80x24 */
	}

	const decoder = new TextDecoder();
	const pump = (stream, out) =>
		stream
			.pipeTo(
				new WritableStream({
					write: (chunk) =>
						out.write(
							typeof chunk === "string"
								? chunk
								: decoder.decode(chunk, { stream: true }),
						),
				}),
			)
			.catch(() => {});
	pump(proc.stdout, ctx.externs.out);
	pump(proc.stderr, ctx.externs.err);

	let done = false;
	const exited = new Promise((resolve) => {
		const t = setInterval(() => {
			if (!proc.frame.isConnected) {
				clearInterval(t);
				done = true;
				resolve();
			}
		}, 60);
	});

	ctx.externs.sig?.on?.(() => {
		try {
			proc.kill();
		} catch {
			/* gone */
		}
	});

	// Programs that read keys say so in their header
	// (#! {"lang":"module","stdin":true}) and get every key while they run.
	// For the rest, keys typed ahead are held and handed back to the shell
	// when the program ends, as a real terminal would, except Ctrl+C,
	// which stops it.
	let wantsKeys = false;
	try {
		const head = new TextDecoder().decode(
			(await anura.fs.promises.readFile(path)).slice(0, 200),
		);
		wantsKeys = !!JSON.parse(head.split("\n")[0].replace(/^#!\s*/, "")).stdin;
	} catch {
		/* no header: no keys */
	}
	const giveBack = (v) => window.postMessage({ type: "stdin", message: v });
	const held = [];
	const writer = proc.stdin.getWriter();
	const EXIT = {};
	(async () => {
		while (!done) {
			const pending = ctx.externs.in_.read();
			const r = await Promise.race([pending, exited.then(() => EXIT)]);
			if (r === EXIT) {
				// The read is still waiting; whatever it gets is the shell's.
				pending.then((late) => {
					if (late && !late.done && late.value) giveBack(late.value);
				});
				break;
			}
			if (!r || r.done) break;
			const text =
				typeof r.value === "string"
					? r.value
					: new TextDecoder().decode(r.value);
			if (!wantsKeys) {
				if (text.includes("\x03")) proc.kill();
				else held.push(r.value);
				continue;
			}
			try {
				await writer.write(r.value);
			} catch {
				break;
			}
		}
	})();

	await exited;
	// Let the last of its output through, then hand back the type-ahead.
	await new Promise((res) => setTimeout(res, 30));
	for (const v of held) giveBack(v);
}
