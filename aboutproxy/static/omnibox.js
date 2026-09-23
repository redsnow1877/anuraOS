// The address bar: select-all on focus, suggestions from history and
// bookmarks as you type, inline completion of sites you've been to, and full
// keyboard control (arrows, Enter, Tab, Escape).
class Omnibox {
    constructor(browser) {
        this.browser = browser;
        this.input = browser.addressBar;
        this.drop = document.querySelector("#omniDrop");
        this.box = document.querySelector("#omnibox");
        this.items = [];
        this.selected = 0;
        this.typed = "";
        this.open = false;

        const input = this.input;
        // Chrome's trick: the first click selects everything, a second click
        // places the caret. Selecting on focus alone loses to mouseup.
        let fresh = false;
        input.addEventListener("mousedown", () => { fresh = document.activeElement !== input; });
        input.addEventListener("mouseup", (e) => {
            if (fresh && input.selectionStart === input.selectionEnd) {
                e.preventDefault();
                input.select();
            }
            fresh = false;
        });
        input.addEventListener("focus", () => {
            this.box.classList.add("is-focused");
            input.select();
        });
        input.addEventListener("blur", () => {
            this.box.classList.remove("is-focused");
            // Let a click on a suggestion land first.
            setTimeout(() => this.close(), 120);
        });
        input.addEventListener("input", (e) => this.onInput(e));
        input.addEventListener("keydown", (e) => this.onKey(e));
        this.drop.addEventListener("mousedown", (e) => e.preventDefault());
        this.drop.addEventListener("click", (e) => {
            const row = e.target.closest(".omniItem");
            if (row) this.go(this.items[Number(row.dataset.i)]);
        });
    }

    focus() {
        this.input.focus();
        this.input.select();
    }

    /* ---- candidates ---------------------------------------------------- */

    static host(url) {
        try {
            return new URL(url).host.replace(/^www\./, "");
        } catch {
            return "";
        }
    }

    /** History and bookmarks, one entry per URL, with a visit count. */
    candidates() {
        const map = new Map();
        const list = this.browser.history.getList();
        for (let i = 0; i < list.length; i++) {
            const h = list[i];
            if (!h || !h.url || h.url.startsWith(this.browser.resourcesProtocol)) continue;
            const c = map.get(h.url) || { url: h.url, title: h.title || h.url, icon: h.icon, visits: 0, last: 0, bookmark: false };
            c.visits++;
            c.last = i;
            if (h.title) c.title = h.title;
            if (h.icon) c.icon = h.icon;
            map.set(h.url, c);
        }
        for (const b of this.browser.bookmarks.bookmarkContainer.childNodes) {
            const url = b.dataset && b.dataset.url;
            if (!url) continue;
            const c = map.get(url) || { url, title: b.childNodes[1]?.data || url, icon: b.childNodes[0]?.getAttribute("src"), visits: 0, last: 0 };
            c.bookmark = true;
            map.set(url, c);
        }
        return [...map.values()];
    }

    score(c, q) {
        const url = c.url.toLowerCase();
        const host = Omnibox.host(c.url).toLowerCase();
        const title = (c.title || "").toLowerCase();
        let s = -1;
        if (host.startsWith(q)) s = 100;
        else if (url.replace(/^https?:\/\/(www\.)?/, "").startsWith(q)) s = 90;
        else if (title.split(/\W+/).some((w) => w.startsWith(q))) s = 60;
        else if (url.includes(q) || title.includes(q)) s = 30;
        if (s < 0) return -1;
        return s + Math.min(40, c.visits * 4) + (c.bookmark ? 25 : 0) + c.last * 0.001;
    }

    /** `completed` is the inline completion, when there is one: the top row
     *  always shows exactly what Enter will do. */
    suggest(q, completed = "") {
        const query = q.trim().toLowerCase();
        const out = [];
        if (!query) return out;
        const looksUrl = isUrl(q.trim()) || q.trim().startsWith(this.browser.resourcesProtocol);
        if (completed) out.push({ kind: "go", url: completed, title: completed });
        else out.push(looksUrl
            ? { kind: "go", url: q.trim(), title: q.trim() }
            : { kind: "search", url: q.trim(), title: q.trim() });
        const ranked = this.candidates()
            .map((c) => [this.score(c, query), c])
            .filter(([s]) => s >= 0)
            .sort((a, b) => b[0] - a[0])
            .slice(0, 6)
            .map(([, c]) => ({ kind: c.bookmark ? "bookmark" : "history", ...c }));
        return out.concat(ranked);
    }

    /** The best site you've visited that starts with what's typed. */
    completion(q) {
        if (!q || /\s/.test(q) || q.includes("/")) return "";
        const lower = q.toLowerCase();
        let best = null;
        for (const c of this.candidates()) {
            const host = Omnibox.host(c.url);
            if (!host.toLowerCase().startsWith(lower) || host.length === q.length) continue;
            if (!best || c.visits > best.visits) best = { host, visits: c.visits };
        }
        return best ? best.host : "";
    }

    /* ---- events --------------------------------------------------------- */

    onInput(e) {
        const input = this.input;
        this.typed = input.value.slice(0, input.selectionStart);
        let value = input.value;
        let completed = "";
        // Complete inline only while typing forwards at the end of the text.
        if (e.inputType && e.inputType.startsWith("insert") && input.selectionStart === value.length) {
            const host = this.completion(value);
            if (host) {
                completed = value + host.slice(value.length);
                input.value = completed;
                input.setSelectionRange(value.length, input.value.length);
            }
        }
        this.items = this.suggest(this.typed || input.value, completed);
        this.selected = 0;
        this.render();
    }

    onKey(e) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            if (!this.open) return;
            e.preventDefault();
            this.selected = (this.selected + (e.key === "ArrowDown" ? 1 : -1) + this.items.length) % this.items.length;
            this.render();
            const it = this.items[this.selected];
            if (it && it.kind !== "search") this.input.value = it.url;
            else if (it) this.input.value = it.title;
        } else if (e.key === "Enter") {
            e.preventDefault();
            const it = this.open && this.selected > 0 ? this.items[this.selected] : null;
            this.go(it || { kind: "go", url: this.input.value.trim() });
        } else if (e.key === "Tab" && this.input.selectionEnd > this.input.selectionStart && !e.shiftKey) {
            // Accept the inline completion.
            e.preventDefault();
            const end = this.input.value.length;
            this.input.setSelectionRange(end, end);
            this.items = this.suggest(this.input.value);
            this.render();
        } else if (e.key === "Escape") {
            e.preventDefault();
            if (this.open) this.close();
            else {
                this.input.value = this.browser.activeTab?.currentUrl || "";
                this.input.blur();
                this.browser.activeTab?.iframe.contentWindow?.focus();
            }
        }
    }

    go(item) {
        if (!item || !item.url) return;
        this.close();
        this.input.blur();
        this.browser.navigateTo(item.url);
        this.browser.activeTab?.iframe.focus();
    }

    /* ---- dropdown ------------------------------------------------------- */

    close() {
        if (!this.open) return;
        this.open = false;
        this.drop.classList.remove("is-open");
        this.box.classList.remove("has-drop");
    }

    render() {
        if (!this.items.length || document.activeElement !== this.input) return this.close();
        const frag = document.createDocumentFragment();
        this.items.forEach((it, i) => {
            const row = document.createElement("div");
            row.className = "omniItem" + (i === this.selected ? " is-selected" : "");
            row.dataset.i = String(i);
            row.setAttribute("role", "option");
            const icon = document.createElement("span");
            icon.className = "omniIcon";
            if (it.kind === "search" || it.kind === "go") {
                icon.classList.add("material-symbols-outlined");
                icon.textContent = it.kind === "search" ? "search" : "public";
            } else {
                const img = document.createElement("img");
                img.src = it.icon || this.browser.resourcesPrefix + "darkfavi.png";
                img.alt = "";
                icon.append(img);
            }
            const text = document.createElement("span");
            text.className = "omniText";
            const title = document.createElement("span");
            title.className = "omniTitle";
            const sub = document.createElement("span");
            sub.className = "omniSub";
            if (it.kind === "search") {
                title.textContent = it.title;
                sub.textContent = "— " + this.engineName() + " Search";
            } else if (it.kind === "go") {
                title.textContent = it.title;
                sub.textContent = "— Go to site";
            } else {
                title.textContent = it.title;
                sub.textContent = "— " + it.url.replace(/^https?:\/\//, "");
            }
            text.append(title, sub);
            row.append(icon, text);
            if (it.kind === "bookmark") {
                const star = document.createElement("span");
                star.className = "material-symbols-outlined omniBadge";
                star.textContent = "star";
                row.append(star);
            }
            frag.append(row);
        });
        this.drop.replaceChildren(frag);
        if (!this.open) {
            this.open = true;
            this.box.classList.add("has-drop");
            this.drop.classList.add("is-open");
        }
    }

    engineName() {
        const url = this.browser.settings.getSetting("searchEngineUrl") || "";
        const host = Omnibox.host(url).split(".");
        const name = host.length > 1 ? host[host.length - 2] : "Web";
        return name.charAt(0).toUpperCase() + name.slice(1);
    }
}
