// Keyboard shortcuts, active in the browser's own UI and inside pages.
//
// Chrome keeps Ctrl+T, Ctrl+W, Ctrl+Tab and friends for itself: a page never
// sees them. So tab management lives on Alt (Alt+T, Alt+W, Alt+1…9), and the
// Ctrl versions are handled too in case they ever arrive (an installed app
// window, fullscreen with keyboard lock).
class BrowserShortcuts {
    constructor(browser) {
        this.browser = browser;
        this.handler = (e) => this.onKey(e);
        document.addEventListener("keydown", this.handler, true);
        this.sheet = document.querySelector("#shortcutSheet");
        this.sheet.addEventListener("click", (e) => { if (e.target === this.sheet) this.hideSheet(); });
    }

    attach(win) {
        try { win.addEventListener("keydown", this.handler, true); } catch { /* cross-origin */ }
    }

    static LIST = [
        ["Tabs", [
            ["Alt+T", "New tab"],
            ["Alt+W", "Close tab"],
            ["Alt+Shift+T", "Reopen closed tab"],
            ["Alt+1…8", "Go to tab"],
            ["Alt+9", "Go to last tab"],
            ["Ctrl+PgDn / PgUp", "Next / previous tab"],
        ]],
        ["Page", [
            ["Ctrl+L", "Address bar"],
            ["Ctrl+R", "Reload"],
            ["Esc", "Stop loading"],
            ["Alt+← / →", "Back / forward"],
            ["Ctrl+F", "Find in page"],
            ["Ctrl+D", "Bookmark"],
            ["Ctrl+= / − / 0", "Zoom in / out / reset"],
        ]],
        ["Links", [
            ["Ctrl+click", "Open in background tab"],
            ["Ctrl+Shift+click", "Open in new tab"],
            ["Middle-click", "Open in background tab"],
        ]],
    ];

    onKey(e) {
        const b = this.browser;
        const tab = b.activeTab;
        const k = e.key;
        const ctrl = e.ctrlKey || e.metaKey;
        const alt = e.altKey && !ctrl;
        const code = e.code;
        let run = null;

        if (ctrl && !e.altKey) {
            if (k === "l" || k === "L") run = () => b.omnibox.focus();
            else if ((k === "r" || k === "R") && !e.shiftKey) run = () => b.handleReload();
            else if (k === "f" || k === "F") run = () => b.findBar.open();
            else if (k === "g" || k === "G") run = () => b.findBar.isOpen ? b.findBar.step(e.shiftKey ? -1 : 1) : b.findBar.open();
            else if (k === "d" || k === "D") run = () => b.handleBookmarks();
            else if (k === "=" || k === "+") run = () => tab?.stepZoom(1);
            else if (k === "-" || k === "_") run = () => tab?.stepZoom(-1);
            else if (k === "0") run = () => tab?.stepZoom(0);
            else if (k === "PageDown") run = () => b.cycleTab(1);
            else if (k === "PageUp") run = () => b.cycleTab(-1);
            else if (k === "t" || k === "T") run = () => (e.shiftKey ? b.reopenClosedTab() : b.openTab());
            else if (k === "w" || k === "W") run = () => b.closeActiveTab();
            else if (k === "Tab") run = () => b.cycleTab(e.shiftKey ? -1 : 1);
        } else if (alt) {
            if (code === "KeyT") run = () => (e.shiftKey ? b.reopenClosedTab() : b.openTab());
            else if (code === "KeyW") run = () => b.closeActiveTab();
            else if (code === "KeyD") run = () => b.omnibox.focus();
            else if (k === "ArrowLeft") run = () => b.handleBack();
            else if (k === "ArrowRight") run = () => b.handleForward();
            else if (/^Digit[1-9]$/.test(code)) {
                const n = Number(code.slice(5));
                run = () => b.selectTab(n === 9 ? -1 : n - 1);
            }
        } else if (!e.shiftKey && !e.altKey) {
            if (k === "F5") run = () => b.handleReload();
            else if (k === "F6") run = () => b.omnibox.focus();
            else if (k === "F3") run = () => b.findBar.isOpen ? b.findBar.step(1) : b.findBar.open();
            else if (k === "Escape" && tab?.loading && !b.findBar.isOpen) run = () => tab.handleStop();
        } else if (e.shiftKey && k === "F3") {
            run = () => b.findBar.step(-1);
        }

        if (!run) return;
        e.preventDefault();
        e.stopPropagation();
        run();
    }

    showSheet() {
        const frag = document.createDocumentFragment();
        const card = document.createElement("div");
        card.className = "sheetCard";
        const h = document.createElement("h2");
        h.textContent = "Keyboard shortcuts";
        card.append(h);
        const cols = document.createElement("div");
        cols.className = "sheetCols";
        for (const [group, rows] of BrowserShortcuts.LIST) {
            const sec = document.createElement("section");
            const t = document.createElement("h3");
            t.textContent = group;
            sec.append(t);
            for (const [keys, what] of rows) {
                const row = document.createElement("div");
                row.className = "sheetRow";
                const w = document.createElement("span");
                w.textContent = what;
                const kb = document.createElement("kbd");
                kb.textContent = keys;
                row.append(w, kb);
                sec.append(row);
            }
            cols.append(sec);
        }
        card.append(cols);
        frag.append(card);
        this.sheet.replaceChildren(frag);
        this.sheet.hidden = false;
        requestAnimationFrame(() => this.sheet.classList.add("is-open"));
        const esc = (e) => {
            if (e.key === "Escape") {
                this.hideSheet();
                document.removeEventListener("keydown", esc, true);
            }
        };
        document.addEventListener("keydown", esc, true);
    }

    hideSheet() {
        this.sheet.classList.remove("is-open");
        setTimeout(() => { this.sheet.hidden = true; }, 200);
    }
}
