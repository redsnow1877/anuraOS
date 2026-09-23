// The chip at the left of the address bar: is this page secure, and is the
// proxy server answering? Clicking it opens the details, including the
// server picker.
class SiteInfo {
    constructor(browser) {
        this.browser = browser;
        this.chip = document.querySelector("#siteChip");
        this.icon = this.chip.querySelector(".siteChipIcon");
        this.dot = this.chip.querySelector(".connDot");
        this.panel = document.querySelector("#siteInfo");
        this.pickerOpen = false;
        this.results = new Map(); // url -> probe result

        this.chip.addEventListener("click", (e) => {
            e.stopPropagation();
            if (this.isOpen) this.close();
            else this.open(false);
        });
        document.addEventListener("pointerdown", (e) => {
            if (this.isOpen && !this.panel.contains(e.target) && !this.chip.contains(e.target)) this.close();
        });
        this.panel.addEventListener("keydown", (e) => {
            if (e.key === "Escape") this.close();
        });
        browser.connection.onChange(() => {
            this.update();
            if (this.isOpen) this.render();
        });
    }

    get isOpen() {
        return this.panel.classList.contains("is-open");
    }

    /** What kind of page is showing: "internal", "secure", "insecure" or "search". */
    kind() {
        const url = this.browser.activeTab?.currentUrl || "";
        if (!url || url.startsWith(this.browser.resourcesProtocol)) return "internal";
        if (url.startsWith("https:")) return "secure";
        if (url.startsWith("http:")) return "insecure";
        return "search";
    }

    update() {
        const k = this.kind();
        this.icon.textContent = { internal: "info", secure: "lock", insecure: "warning", search: "search" }[k];
        this.chip.dataset.kind = k;
        const c = this.browser.connection;
        this.dot.dataset.state = c.state;
        this.chip.title = c.state === "down"
            ? "Proxy server unreachable — click for details"
            : "View site information";
    }

    open(picker) {
        this.pickerOpen = !!picker;
        this.render();
        clearTimeout(this.hideTimer);
        this.panel.hidden = false;
        requestAnimationFrame(() => this.panel.classList.add("is-open"));
        this.chip.classList.add("active");
        if (this.browser.connection.state !== "checking") this.browser.connection.check();
    }

    close() {
        this.panel.classList.remove("is-open");
        this.chip.classList.remove("active");
        this.hideTimer = setTimeout(() => { this.panel.hidden = true; }, 180);
    }

    el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    icon_(name) {
        return this.el("span", "material-symbols-outlined", name);
    }

    statusLine(state, latency, reason) {
        if (state === "checking") return "Checking…";
        if (state === "ok") return `Connected · ${latency} ms`;
        if (state === "down") return reason ? `Unreachable · ${reason}` : "Unreachable";
        return "Not checked";
    }

    render() {
        const b = this.browser;
        const c = b.connection;
        const k = this.kind();
        const frag = document.createDocumentFragment();

        // ---- the page
        const tab = b.activeTab;
        let host = "";
        try { host = new URL(tab?.currentUrl || "").host; } catch { /* internal */ }
        const head = this.el("div", "siHead");
        const headIcon = this.icon_({ internal: "info", secure: "lock", insecure: "warning", search: "search" }[k]);
        headIcon.classList.add("siHeadIcon", "is-" + k);
        const headText = this.el("div", "siHeadText");
        headText.append(
            this.el("div", "siTitle", {
                internal: "Aether page",
                secure: "Connection is secure",
                insecure: "Connection is not secure",
                search: "Search",
            }[k]),
            this.el("div", "siSub", {
                internal: "Built into the browser.",
                secure: `${host} encrypts what it sends. The proxy server can see the page address, not its contents.`,
                insecure: `${host} doesn't use HTTPS. Don't send passwords or card numbers here.`,
                search: "",
            }[k]),
        );
        head.append(headIcon, headText);
        frag.append(head);

        if (tab && tab.zoom !== 100) {
            const zoom = this.el("div", "siRow");
            zoom.append(this.icon_("zoom_in"), this.el("span", "siRowText", `Zoom ${tab.zoom}%`));
            const reset = this.el("button", "siLink", "Reset");
            reset.addEventListener("click", () => { tab.stepZoom(0); this.render(); });
            zoom.append(reset);
            frag.append(zoom);
        }

        // ---- the proxy
        frag.append(this.el("div", "siSep"));
        const conn = this.el("div", "siConn");
        const dot = this.el("span", "siDot");
        dot.dataset.state = c.state;
        const connText = this.el("div", "siConnText");
        connText.append(
            this.el("div", "siTitle", "Proxy server"),
            this.el("div", "siStatus", this.statusLine(c.state, c.latency, c.reason)),
            this.el("div", "siUrl", c.url),
        );
        const retest = this.el("button", "siIconBtn");
        retest.title = "Check again";
        retest.append(this.icon_("refresh"));
        retest.classList.toggle("is-spinning", c.state === "checking");
        retest.addEventListener("click", () => c.check());
        conn.append(dot, connText, retest);
        frag.append(conn);

        if (c.state === "down" && !this.pickerOpen) {
            const hint = this.el("div", "siHint",
                "Pages can't load until the browser can reach a proxy server. Static hosts like GitHub Pages can't run one, so pick another.");
            frag.append(hint);
        }

        if (!this.pickerOpen) {
            const change = this.el("button", "siWide", "Change server…");
            change.addEventListener("click", () => { this.pickerOpen = true; this.render(); this.testAll(); });
            frag.append(change);
        } else {
            frag.append(this.renderPicker());
        }

        this.panel.replaceChildren(frag);
    }

    renderPicker() {
        const c = this.browser.connection;
        const wrap = this.el("div", "siPicker");
        const presets = c.presets;
        const current = c.url;
        const known = presets.some((p) => p.url === current);
        const rows = known ? presets : [...presets, { name: "Custom", url: current, note: "" }];
        for (const p of rows) {
            const row = this.el("button", "siServer" + (p.url === current ? " is-current" : ""));
            const r = this.results.get(p.url);
            const dot = this.el("span", "siDot");
            dot.dataset.state = r ? (r.pending ? "checking" : r.ok ? "ok" : "down") : "unknown";
            const text = this.el("span", "siServerText");
            text.append(this.el("span", "siServerName", p.name), this.el("span", "siServerUrl", p.url));
            const meta = this.el("span", "siServerMeta",
                !r ? "" : r.pending ? "…" : r.ok ? `${r.ms} ms` : "offline");
            row.append(dot, text, meta);
            if (p.url === current) row.append(this.icon_("check"));
            row.addEventListener("click", () => this.choose(p.url));
            wrap.append(row);
        }
        const custom = this.el("form", "siCustom");
        const input = this.el("input", "siInput");
        input.placeholder = "wss://your-server.example/";
        input.spellcheck = false;
        const test = this.el("button", "siBtn", "Use");
        test.type = "submit";
        custom.append(input, test);
        custom.addEventListener("submit", (e) => {
            e.preventDefault();
            let url = input.value.trim();
            if (!url) return;
            if (!/^wss?:\/\//.test(url)) url = "wss://" + url.replace(/^https?:\/\//, "");
            if (!url.endsWith("/")) url += "/";
            this.choose(url);
        });
        wrap.append(custom);
        wrap.append(this.el("div", "siFine", "Everything you browse passes through this server. Only use one you trust."));
        return wrap;
    }

    async testAll() {
        for (const p of this.browser.connection.presets) this.test(p.url);
    }

    async test(url) {
        this.results.set(url, { pending: true });
        if (this.isOpen) this.render();
        const r = await ProxyConnection.probe(url, 6000);
        this.results.set(url, r);
        if (this.isOpen) this.render();
        return r;
    }

    async choose(url) {
        const c = this.browser.connection;
        if (url === c.url && c.state === "ok") return;
        const r = await this.test(url);
        if (!r.ok) return; // stays on the old server; the row says why
        await c.use(url);
        this.pickerOpen = false;
        this.render();
        // Pages that failed on the old server get another go.
        const tab = this.browser.activeTab;
        if (tab && !tab.currentUrl.startsWith(this.browser.resourcesProtocol)) tab.handleReload();
    }
}
