/**
 * A small, precise calculator.
 *
 * Evaluation is a hand-written shunting-yard parser rather than eval() — this
 * runs inside a shell that hosts untrusted third-party apps, and the display
 * string is reachable from anywhere that can drive the keypad.
 */
class CalculatorApp extends App {
	name = "Calculator";
	package = "anura.calculator";
	icon = "/assets/icons/calculator.svg";

	state = $state({
		display: "0",
		/** The expression as typed, shown small above the result. */
		expression: "",
		/** Set when the last keypress produced a result, so a digit starts fresh. */
		justEvaluated: false,
		history: [] as { expression: string; result: string }[],
		showHistory: false,
	});

	css = css`
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--theme-bg);
		color: var(--ink);
		user-select: none;

		.calc-readout {
			flex-shrink: 0;
			padding: 18px 20px 14px;
			text-align: right;
			display: flex;
			flex-direction: column;
			justify-content: flex-end;
			gap: 4px;
			min-height: 96px;
			box-sizing: border-box;
		}

		.calc-expression {
			font-size: 13px;
			color: var(--ink-faint);
			min-height: 1.2em;
			font-variant-numeric: tabular-nums;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			direction: rtl;
		}

		.calc-display {
			font-size: 40px;
			font-weight: 300;
			letter-spacing: -0.02em;
			font-variant-numeric: tabular-nums;
			line-height: 1.1;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			direction: rtl;
		}

		/* Long results shrink rather than clip. */
		.calc-display.long {
			font-size: 28px;
		}
		.calc-display.very-long {
			font-size: 20px;
		}

		.calc-keys {
			flex: 1;
			display: grid;
			grid-template-columns: repeat(4, 1fr);
			gap: 8px;
			padding: 0 14px 14px;
			min-height: 0;
		}

		.calc-key {
			border: 1px solid var(--glass-stroke);
			border-radius: 12px;
			background: rgba(255, 255, 255, 0.06);
			color: var(--ink);
			font-size: 17px;
			font-weight: 500;
			font-family: inherit;
			cursor: default;
			display: grid;
			place-items: center;
			transition:
				background-color 0.1s ease,
				transform 0.08s var(--ease-out);
			box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07);
		}

		.calc-key:hover {
			background: rgba(255, 255, 255, 0.11);
		}

		.calc-key:active,
		.calc-key.pressed {
			transform: scale(0.94);
			background: rgba(255, 255, 255, 0.16);
		}

		.calc-key.op {
			background: color-mix(in srgb, var(--theme-accent) 22%, transparent);
			border-color: color-mix(in srgb, var(--theme-accent) 40%, transparent);
		}

		.calc-key.op:hover {
			background: color-mix(in srgb, var(--theme-accent) 34%, transparent);
		}

		.calc-key.equals {
			background: var(--theme-accent);
			border-color: transparent;
			color: #fff;
			box-shadow:
				inset 0 1px 0 rgba(255, 255, 255, 0.25),
				0 4px 14px -4px color-mix(in srgb, var(--theme-accent) 70%, transparent);
		}

		.calc-key.equals:hover {
			filter: brightness(1.08);
		}

		.calc-key.fn {
			font-size: 15px;
			color: var(--ink-dim);
		}

		.calc-key.wide {
			grid-column: span 2;
		}

		/* --- history --------------------------------------------------- */
		.calc-history {
			position: absolute;
			inset: 0;
			background: var(--theme-bg);
			display: flex;
			flex-direction: column;
			z-index: 2;
		}

		.calc-history-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 12px 16px;
			border-bottom: 1px solid var(--hairline);
			font-size: 13px;
			font-weight: 600;
		}

		.calc-history-list {
			flex: 1;
			overflow-y: auto;
			padding: 6px 0;
		}

		.calc-history-item {
			padding: 10px 16px;
			cursor: default;
			border-bottom: 1px solid rgba(255, 255, 255, 0.04);
		}

		.calc-history-item:hover {
			background: rgba(255, 255, 255, 0.06);
		}

		.calc-history-expr {
			font-size: 12px;
			color: var(--ink-faint);
			font-variant-numeric: tabular-nums;
		}

		.calc-history-result {
			font-size: 18px;
			font-variant-numeric: tabular-nums;
		}

		.calc-history-empty {
			padding: 30px 16px;
			text-align: center;
			color: var(--ink-faint);
			font-size: 13px;
		}

		.calc-textbtn {
			background: none;
			border: none;
			color: var(--theme-accent);
			font-family: inherit;
			font-size: 13px;
			cursor: default;
		}
	`;

	/* ------------------------------------------------------------------ */
	/* Expression evaluation                                               */
	/* ------------------------------------------------------------------ */

	/** Tokenises, then evaluates via shunting-yard. Throws on malformed input. */
	static evaluate(expr: string): number {
		const tokens = CalculatorApp.tokenize(expr);
		const output: (number | string)[] = [];
		const ops: string[] = [];
		const prec: Record<string, number> = {
			"+": 1,
			"-": 1,
			"*": 2,
			"/": 2,
			"%": 2,
			"^": 3,
		};
		const rightAssoc = new Set(["^"]);

		for (const tok of tokens) {
			if (typeof tok === "number") {
				output.push(tok);
			} else if (tok === "(") {
				ops.push(tok);
			} else if (tok === ")") {
				while (ops.length && ops[ops.length - 1] !== "(") {
					output.push(ops.pop()!);
				}
				if (!ops.length) throw new Error("unbalanced parentheses");
				ops.pop();
			} else {
				while (
					ops.length &&
					ops[ops.length - 1] !== "(" &&
					(prec[ops[ops.length - 1]!]! > prec[tok]! ||
						(prec[ops[ops.length - 1]!] === prec[tok] && !rightAssoc.has(tok)))
				) {
					output.push(ops.pop()!);
				}
				ops.push(tok);
			}
		}
		while (ops.length) {
			const op = ops.pop()!;
			if (op === "(") throw new Error("unbalanced parentheses");
			output.push(op);
		}

		const stack: number[] = [];
		for (const tok of output) {
			if (typeof tok === "number") {
				stack.push(tok);
				continue;
			}
			const b = stack.pop();
			const a = stack.pop();
			if (a === undefined || b === undefined) throw new Error("malformed");
			switch (tok) {
				case "+":
					stack.push(a + b);
					break;
				case "-":
					stack.push(a - b);
					break;
				case "*":
					stack.push(a * b);
					break;
				case "/":
					stack.push(a / b);
					break;
				case "%":
					stack.push(a % b);
					break;
				case "^":
					stack.push(Math.pow(a, b));
					break;
				default:
					throw new Error("unknown operator " + tok);
			}
		}
		if (stack.length !== 1) throw new Error("malformed");
		return stack[0]!;
	}

	/**
	 * parseFloat is too forgiving on its own — it reads "1..2" as 1 rather than
	 * rejecting it, so a malformed expression would silently evaluate. Require
	 * the whole token to be a well-formed number first.
	 */
	static parseNumber(text: string): number {
		if (!/^(?:\d+\.?\d*|\.\d+)$/.test(text)) {
			throw new Error("bad number " + text);
		}
		return parseFloat(text);
	}

	static tokenize(expr: string): (number | string)[] {
		const out: (number | string)[] = [];
		let i = 0;
		while (i < expr.length) {
			const ch = expr[i]!;
			if (ch === " ") {
				i++;
				continue;
			}
			if (/[0-9.]/.test(ch)) {
				let num = "";
				while (i < expr.length && /[0-9.]/.test(expr[i]!)) num += expr[i++]!;
				out.push(CalculatorApp.parseNumber(num));
				continue;
			}
			if ("+-*/%^()".includes(ch)) {
				// A leading +/-, or one straight after another operator or an
				// opening paren, is a sign rather than a binary operator.
				const prev = out[out.length - 1];
				const isUnary =
					(ch === "-" || ch === "+") &&
					(out.length === 0 || prev === "(" || typeof prev === "string");
				if (isUnary) {
					let num = "";
					i++;
					while (i < expr.length && /[0-9.]/.test(expr[i]!)) num += expr[i++]!;
					if (num === "") throw new Error("dangling sign");
					const value = CalculatorApp.parseNumber(num);
					out.push(ch === "-" ? -value : value);
					continue;
				}
				out.push(ch);
				i++;
				continue;
			}
			throw new Error("unexpected character " + ch);
		}
		return out;
	}

	/** Trims float noise (0.1+0.2) without clobbering genuine precision. */
	static format(n: number): string {
		if (!Number.isFinite(n))
			return n > 0 ? "∞" : Number.isNaN(n) ? "Error" : "-∞";
		if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
		const rounded = parseFloat(n.toPrecision(12));
		if (
			Math.abs(rounded) >= 1e12 ||
			(Math.abs(rounded) < 1e-6 && rounded !== 0)
		) {
			return rounded.toExponential(6).replace(/e\+?/, "e");
		}
		return String(rounded);
	}

	/* ------------------------------------------------------------------ */
	/* Input handling                                                      */
	/* ------------------------------------------------------------------ */

	press(key: string) {
		const s = this.state;
		const isDigit = /^[0-9.]$/.test(key);

		if (key === "clear") {
			s.display = "0";
			s.expression = "";
			s.justEvaluated = false;
			return;
		}
		if (key === "back") {
			if (s.justEvaluated) return;
			s.display = s.display.length > 1 ? s.display.slice(0, -1) : "0";
			return;
		}
		if (key === "negate") {
			s.display = s.display.startsWith("-")
				? s.display.slice(1)
				: "-" + s.display;
			return;
		}
		if (key === "=") {
			this.evaluateNow();
			return;
		}

		if (isDigit) {
			// A digit right after "=" starts a new calculation.
			if (s.justEvaluated) {
				s.display = key === "." ? "0." : key;
				s.expression = "";
				s.justEvaluated = false;
				return;
			}
			if (key === "." && s.display.includes(".")) return;
			s.display = s.display === "0" && key !== "." ? key : s.display + key;
			return;
		}

		// Operator: fold the current display into the running expression.
		s.expression =
			(s.justEvaluated ? s.display : s.expression + s.display) + key;
		s.display = "0";
		s.justEvaluated = false;
	}

	evaluateNow() {
		const s = this.state;
		const full = (s.expression + s.display).trim();
		if (!full) return;
		try {
			const result = CalculatorApp.evaluate(full);
			const formatted = CalculatorApp.format(result);
			s.history = [{ expression: full, result: formatted }, ...s.history].slice(
				0,
				50,
			);
			s.expression = full + "=";
			s.display = formatted;
			s.justEvaluated = true;
		} catch {
			s.display = "Error";
			s.expression = full + "=";
			s.justEvaluated = true;
		}
	}

	/* ------------------------------------------------------------------ */
	/* View                                                                */
	/* ------------------------------------------------------------------ */

	key(label: string, action: string, cls = "") {
		return (
			<button
				class={`calc-key ${cls}`}
				data-key={action}
				on:click={() => {
					this.press(action);
					(globalThis as any).aetherSound?.play?.("click");
				}}
			>
				{label}
			</button>
		);
	}

	page() {
		const displayClass = use(this.state.display, (d) =>
			d.length > 14
				? "calc-display very-long"
				: d.length > 9
					? "calc-display long"
					: "calc-display",
		);

		return (
			<div class={this.css} style="position: relative;">
				{$if(
					use(this.state.showHistory),
					<div class="calc-history">
						<div class="calc-history-head">
							<span>History</span>
							<span>
								<button
									class="calc-textbtn"
									on:click={() => (this.state.history = [])}
								>
									Clear
								</button>
								<button
									class="calc-textbtn"
									on:click={() => (this.state.showHistory = false)}
								>
									Done
								</button>
							</span>
						</div>
						<div class="calc-history-list">
							{use(this.state.history, (items) =>
								items.length === 0
									? [<div class="calc-history-empty">Nothing yet</div>]
									: items.map((item) => (
											<div
												class="calc-history-item"
												on:click={() => {
													this.state.display = item.result;
													this.state.expression = "";
													this.state.justEvaluated = true;
													this.state.showHistory = false;
												}}
											>
												<div class="calc-history-expr">{item.expression}</div>
												<div class="calc-history-result">{item.result}</div>
											</div>
										)),
							)}
						</div>
					</div>,
				)}

				<div class="calc-readout">
					<div class="calc-expression">{use(this.state.expression)}</div>
					<div class={displayClass}>{use(this.state.display)}</div>
				</div>

				<div class="calc-keys">
					{this.key("AC", "clear", "fn")}
					{this.key("±", "negate", "fn")}
					{this.key("%", "%", "fn")}
					{this.key("÷", "/", "op")}

					{this.key("7", "7")}
					{this.key("8", "8")}
					{this.key("9", "9")}
					{this.key("×", "*", "op")}

					{this.key("4", "4")}
					{this.key("5", "5")}
					{this.key("6", "6")}
					{this.key("−", "-", "op")}

					{this.key("1", "1")}
					{this.key("2", "2")}
					{this.key("3", "3")}
					{this.key("+", "+", "op")}

					{this.key("0", "0", "wide")}
					{this.key(".", ".")}
					{this.key("=", "=", "equals")}
				</div>
			</div>
		);
	}

	async open(args: string[] = []): Promise<WMWindow | undefined> {
		const win = anura.wm.create(this, {
			title: "Calculator",
			width: "300px",
			height: "440px",
		});
		const page = this.page();
		win.content.appendChild(page);

		// Keyboard support, scoped to this window so two calculators don't fight.
		const onKey = (e: KeyboardEvent) => {
			const map: Record<string, string> = {
				Enter: "=",
				"=": "=",
				Escape: "clear",
				Backspace: "back",
				"*": "*",
				x: "*",
				"/": "/",
				"+": "+",
				"-": "-",
				"%": "%",
				"^": "^",
				".": ".",
			};
			const action = /^[0-9]$/.test(e.key) ? e.key : map[e.key];
			if (!action) return;
			e.preventDefault();
			this.press(action);

			// Flash the matching key so typing feels connected to the pad.
			const el = page.querySelector(`[data-key="${CSS.escape(action)}"]`);
			if (el) {
				el.classList.add("pressed");
				setTimeout(() => el.classList.remove("pressed"), 90);
			}
		};

		win.element.addEventListener("keydown", onKey);
		win.element.tabIndex = -1;
		setTimeout(() => win.element.focus(), 50);
		win.addEventListener("close", () =>
			win.element.removeEventListener("keydown", onKey),
		);

		return win;
	}
}
