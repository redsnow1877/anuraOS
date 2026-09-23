// Right-click a tab for the usual tab actions; middle-click closes it.
class TabMenu {
    constructor(browser) {
        this.browser = browser;
        this.el = document.querySelector("#tabMenu");
        this.target = null;
        const strip = document.querySelector(".chrome-tabs");

        strip.addEventListener("contextmenu", (e) => {
            const tabEl = e.target.closest(".chrome-tab");
            if (!tabEl) return;
            e.preventDefault();
            this.show(tabEl, e.clientX, e.clientY);
        });
        strip.addEventListener("auxclick", (e) => {
            if (e.button !== 1) return;
            const tabEl = e.target.closest(".chrome-tab");
            if (!tabEl) return;
            e.preventDefault();
            browser.chromeTabs.removeTab(tabEl);
        });
        // No autoscroll cursor on middle-press over the strip.
        strip.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
        document.addEventListener("pointerdown", (e) => {
            if (!this.el.classList.contains("hidden") && !this.el.contains(e.target)) this.hide();
        });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.hide(); });
        window.addEventListener("blur", () => this.hide());
    }

    show(tabEl, x, y) {
        this.target = tabEl;
        const b = this.browser;
        const tabs = b.orderedTabs;
        const tab = b.tabs.get(tabEl);
        const i = tabs.indexOf(tab);
        const items = [
            ["add", "New tab", () => b.openTab()],
            null,
            ["refresh", "Reload", () => tab.handleReload()],
            ["content_copy", "Duplicate", () => b.openTab(tab.currentUrl)],
            null,
            ["close", "Close tab", () => b.chromeTabs.removeTab(tabEl)],
            ["tab_close", "Close other tabs", () => tabs.filter((t) => t !== tab).forEach((t) => b.chromeTabs.removeTab(t.tabEl)), tabs.length < 2],
            ["tab_close_right", "Close tabs to the right", () => tabs.slice(i + 1).forEach((t) => b.chromeTabs.removeTab(t.tabEl)), i === tabs.length - 1],
            null,
            ["tab_recent", "Reopen closed tab", () => b.reopenClosedTab(), !b.closedTabs.length],
        ];
        const frag = document.createDocumentFragment();
        for (const it of items) {
            if (!it) {
                const sep = document.createElement("div");
                sep.className = "sep";
                frag.append(sep);
                continue;
            }
            const [icon, label, run, disabled] = it;
            const btn = document.createElement("button");
            btn.disabled = !!disabled;
            const ic = document.createElement("span");
            ic.className = "material-symbols-outlined menuIcon";
            ic.textContent = icon;
            const t = document.createElement("span");
            t.className = "title";
            t.textContent = label;
            btn.append(ic, t);
            btn.addEventListener("click", () => {
                this.hide();
                run();
            });
            frag.append(btn);
        }
        this.el.replaceChildren(frag);
        this.el.style.left = "0px";
        this.el.style.top = "0px";
        this.el.classList.remove("hidden");
        // Keep it on screen, and grow it out of the corner nearest the click.
        const w = this.el.offsetWidth;
        const h = this.el.offsetHeight;
        const left = Math.min(x, innerWidth - w - 6);
        const top = Math.min(y, innerHeight - h - 6);
        this.el.style.left = left + "px";
        this.el.style.top = top + "px";
        this.el.style.transformOrigin = `${x - left}px ${y - top}px`;
        this.el.classList.remove("is-open");
        requestAnimationFrame(() => this.el.classList.add("is-open"));
    }

    hide() {
        this.el.classList.remove("is-open");
        this.el.classList.add("hidden");
    }
}
