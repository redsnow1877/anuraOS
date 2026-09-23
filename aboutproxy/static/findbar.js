// Find in page (Ctrl+F). Matches are painted with the CSS Custom Highlight
// API: the page's DOM is never touched, so nothing on it can break, and
// clearing is just forgetting the ranges.
class FindBar {
    constructor(browser) {
        this.browser = browser;
        this.el = document.querySelector("#findBar");
        this.input = document.querySelector("#findInput");
        this.count = document.querySelector("#findCount");
        this.ranges = [];
        this.index = -1;
        this.doc = null;
        this.timer = 0;

        this.input.addEventListener("input", () => {
            clearTimeout(this.timer);
            this.timer = setTimeout(() => this.search(), 60);
        });
        this.input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                this.step(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") {
                e.preventDefault();
                this.close();
            }
        });
        document.querySelector("#findNext").addEventListener("click", () => this.step(1));
        document.querySelector("#findPrev").addEventListener("click", () => this.step(-1));
        document.querySelector("#findClose").addEventListener("click", () => this.close());
    }

    get isOpen() {
        return !this.el.hidden && this.el.classList.contains("is-open");
    }

    open() {
        clearTimeout(this.hideTimer);
        this.el.hidden = false;
        // Next frame, so the entrance transition has a start state to leave.
        requestAnimationFrame(() => this.el.classList.add("is-open"));
        this.input.focus();
        this.input.select();
        if (this.input.value) this.search();
    }

    close() {
        this.clear();
        this.el.classList.remove("is-open");
        this.hideTimer = setTimeout(() => { this.el.hidden = true; }, 180);
        try { this.browser.activeTab?.iframe.contentWindow.focus(); } catch { /* gone */ }
    }

    /** The page changed (navigation, tab switch): old matches are stale. */
    reset() {
        this.clear();
        if (this.isOpen && this.input.value) setTimeout(() => this.search(), 0);
    }

    clear() {
        try { this.doc?.defaultView?.CSS.highlights.delete("ab-find"); } catch { /* gone */ }
        try { this.doc?.defaultView?.CSS.highlights.delete("ab-find-current"); } catch { /* gone */ }
        this.ranges = [];
        this.index = -1;
        this.doc = null;
        this.count.textContent = "";
        this.el.classList.remove("no-match");
    }

    search() {
        this.clear();
        const q = this.input.value;
        const tab = this.browser.activeTab;
        let doc = null;
        try { doc = tab?.iframe.contentDocument; } catch { /* cross-origin */ }
        if (!q || !doc || !doc.body) return;
        const win = doc.defaultView;
        if (!win.CSS || !win.CSS.highlights) {
            this.count.textContent = "Unsupported";
            return;
        }
        if (!doc.getElementById("ab-find-style")) {
            const style = doc.createElement("style");
            style.id = "ab-find-style";
            style.textContent =
                "::highlight(ab-find){background-color:rgba(255,213,74,.55);color:inherit}" +
                "::highlight(ab-find-current){background-color:#ff9632;color:#111}";
            (doc.head || doc.documentElement).append(style);
        }
        this.doc = doc;

        const needle = q.toLowerCase();
        const walker = doc.createTreeWalker(doc.body, win.NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => {
                const p = n.parentElement;
                if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA)$/.test(p.tagName)) return win.NodeFilter.FILTER_REJECT;
                return win.NodeFilter.FILTER_ACCEPT;
            },
        });
        const ranges = [];
        for (let n = walker.nextNode(); n && ranges.length < 2000; n = walker.nextNode()) {
            const text = n.data.toLowerCase();
            for (let i = text.indexOf(needle); i >= 0 && ranges.length < 2000; i = text.indexOf(needle, i + needle.length)) {
                const r = doc.createRange();
                r.setStart(n, i);
                r.setEnd(n, i + needle.length);
                // Skip text nobody can see (display: none and friends).
                const rect = r.getBoundingClientRect();
                if (rect.width || rect.height) ranges.push(r);
            }
        }
        this.ranges = ranges;
        win.CSS.highlights.set("ab-find", new win.Highlight(...ranges));
        if (!ranges.length) {
            this.count.textContent = "No results";
            this.el.classList.add("no-match");
            return;
        }
        // Start at the first match on or below the top of the viewport.
        const first = ranges.findIndex((r) => r.getBoundingClientRect().bottom >= 0);
        this.goto(first < 0 ? 0 : first);
    }

    step(dir) {
        if (!this.ranges.length) {
            this.search();
            return;
        }
        this.goto((this.index + dir + this.ranges.length) % this.ranges.length);
    }

    goto(i) {
        const doc = this.doc;
        if (!doc) return;
        const win = doc.defaultView;
        this.index = i;
        const r = this.ranges[i];
        win.CSS.highlights.set("ab-find-current", new win.Highlight(r));
        this.count.textContent = `${i + 1} of ${this.ranges.length}`;
        const rect = r.getBoundingClientRect();
        const margin = 80;
        if (rect.top < margin || rect.bottom > win.innerHeight - margin || rect.left < 0 || rect.right > win.innerWidth) {
            win.scrollBy({
                top: rect.top - win.innerHeight / 2 + rect.height / 2,
                left: rect.left < 0 || rect.right > win.innerWidth ? rect.left - win.innerWidth / 2 : 0,
                behavior: "smooth",
            });
        }
    }
}
