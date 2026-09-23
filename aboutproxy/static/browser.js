// todo private methods+variables maybe?
class AboutBrowser {
    constructor(plugins) {
        this.branding = {
            name: "AboutBrowser",
            version: "v0.9.0-dev"
        }
        this.addBranding();

        this.plugins = plugins;
        this.resourcesProtocol = "aboutbrowser://"
        this.resourcesPrefix = window.location.origin + "/aboutbrowser/";
        this.titleSuffix = ` - ${this.branding.name}`;
        this.browserTitle = "New Tab" + this.titleSuffix;
        document.title = this.browserTitle;

        // i have no idea why i wasn't initializing this super early
        this.settings = new Settings(this);

        // initialize themes as early as possible
        this.extensions = new ExtensionsController();
        
        this.bookmarks = new Bookmarks(document.querySelector(".bookmarksContainer"));
        this.bookmarks.load();

        this.addressBar = document.querySelector("#browserUrl");
        this.iFrameContainer = document.querySelector("#tabContents");

        this.history = new History();

        this.activeIframe = null;

        this.chromeTabs = new ChromeTabs();
        var tabsEl = document.querySelector(".chrome-tabs");
        this.chromeTabs.init(tabsEl);
        tabsEl.classList.add("chrome-tabs-dark-theme");

        this.tabs = new ElementMap();

        var self = this;

        tabsEl.addEventListener("activeTabChange", (event) => {
            console.debug("Active tab changed: ", event.detail.active, event.detail.tabEl);
            self.switchTabs(event.detail);
        });

        tabsEl.addEventListener("tabAdd", (event) => {
            console.debug("Tab created: ", event.detail.tabEl);
            // we no longer handle this event since each `Tab` recieves its tabEl when calling the tab create function
        });

        tabsEl.addEventListener("tabRemove", (event) => {
            console.debug("Tab closed: ", event.detail.tabEl);
            self.closeTab(event.detail);
            if(self.chromeTabs.tabEls.length === 0) {
                // Closing the last tab closes the window, like every browser.
                const win = self.hostWindow();
                if (win) {
                    win.close();
                    return;
                }
                document.querySelector(".container.browserContainer").style.setProperty("display", "none");
                document.querySelector(".goodbyeContainer").style.removeProperty("display");
            }
            self.saveSession();
        });

        tabsEl.addEventListener("tabReorder", () => self.saveSession());

        document.querySelector("button[data-add-tab]").addEventListener("click", () => {
            self.openTab();
        })

        this.closedTabs = [];
        this.loadBar = document.querySelector("#loadBar");
        this.reloadBtn = document.querySelector("#browserReload");
        this.starBtn = document.querySelector("#browserBookmarks");
        this.zoomBadge = document.querySelector("#zoomBadge");
        this.zoomBadge.addEventListener("click", () => this.activeTab?.stepZoom(0));
        this.connection = new ProxyConnection(this);
        this.omnibox = new Omnibox(this);
        this.findBar = new FindBar(this);
        this.siteInfo = new SiteInfo(this);
        this.tabMenu = new TabMenu(this);
        this.shortcuts = new BrowserShortcuts(this);
        document.querySelectorAll(".moreMenu .zoomStep").forEach((b) =>
            b.addEventListener("click", (e) => {
                e.stopPropagation();
                this.activeTab?.stepZoom(Number(b.dataset.zoom));
            }),
        );

        this.settingsCtxMenu = document.querySelector(".moreMenu");
        this.settingsCtxBtn = document.querySelector(".navbarBtn#browserSettings");
        this.ctxMenuClickChecker = document.querySelector(".ctxMenuClickChecker");
        this.ctxMenuClickChecker.addEventListener("click", () => {
            self.settingsCtxMenu.classList.add("hidden");
            self.ctxMenuClickChecker.style.setProperty('display', 'none');
            self.settingsCtxBtn.classList.remove("active");
        })

        window.addEventListener("bookmarkClicked", (event) => { self.navigateTo(event.detail.url) });

        // the best line of code in this codebase
        // it used to be:
        // if(probeForChrome()) unfuckChrome();
        // sadly got removed

        this.bareClient = new Ultraviolet.BareClient()

        this.eventsInit();

        this.asyncInit();
    }

    async asyncInit() {
        // prime the serviceworker
        await new Promise(r=>proxyUsing("https://nya.r58playz.dev", "UV", r));

        this.extensions = new ExtensionsController(this);
        await this.extensions.setup();

        Extension.chromeApis = await fetch("/extensions/injector/apis.js").then(r=>r.text());

        this.reapplyTheme();

        if (!this.restoreSession()) this.openTab();

        document.querySelector(".container.browserContainer").style.removeProperty("visibility");
        this.connection.check();
    }

    eventsInit() {
        let self = this;
        this.eventsEl = document.querySelector(".aboutbrowser-event-el#aboutbrowser-event-el");
        this.eventsEl.addEventListener("aboutbrowser-contextmenu", (event)=>{
            if(event.detail.type === "more") {
                self.settingsCtxMenu.querySelector(".reopenItem").disabled = !self.closedTabs.length;
                self.settingsCtxMenu.classList.remove("hidden");
                self.settingsCtxMenu.classList.add("transition");
                setTimeout(() => {
                    self.settingsCtxMenu.classList.remove("transition");
                }, 250);
                self.ctxMenuClickChecker.style.removeProperty("display");
                self.settingsCtxBtn.classList.add("active");
            }
        });
    }

    createEvent(name, detail, cancelable) {
        return new CustomEvent(name, {detail: detail, bubbles: false, cancelable: cancelable, composed: false});
    }

    reapplyTheme() {
        this.extensions.injectTheme();
        for (const tab of this.tabs.internalList) {
            tab.value.reinjectTheme();
        }
    }

    propagateMessage(msg) {
        for (const tab of this.tabs.internalList) {
            try {
                tab.value.iframe.contentWindow?.postMessage(msg, window.origin);
            } catch { /* tab is between pages */ }
        }
    }

    /** `opts.background` opens it without switching to it. */
    openTab(url, opts = {}) {
        if(!url) url = this.settings.getSetting("startUrl");
        var tab = new Tab(this, !!opts.background);
        tab.navigateTo(url);
        this.saveSession();
        return tab;
    }

    closeTab(detail) {
        var tabEl = detail.tabEl;
        const tab = this.tabs.get(tabEl);
        if (tab.currentUrl) {
            this.closedTabs.push(tab.currentUrl);
            if (this.closedTabs.length > 25) this.closedTabs.shift();
        }
        tab.handleClose();
        this.tabs.delete(tabEl);
    }

    reopenClosedTab() {
        const url = this.closedTabs.pop();
        if (url) this.openTab(url);
    }

    closeActiveTab() {
        if (this.activeTab) this.chromeTabs.removeTab(this.activeTab.tabEl);
    }

    /** Tabs in strip order. */
    get orderedTabs() {
        return this.chromeTabs.tabEls.map((el) => this.tabs.get(el)).filter(Boolean);
    }

    selectTab(index) {
        const tabs = this.orderedTabs;
        if (!tabs.length) return;
        const i = index < 0 ? tabs.length - 1 : Math.min(index, tabs.length - 1);
        this.chromeTabs.setCurrentTab(tabs[i].tabEl);
    }

    cycleTab(dir) {
        const tabs = this.orderedTabs;
        const i = tabs.indexOf(this.activeTab);
        if (i < 0) return;
        this.chromeTabs.setCurrentTab(tabs[(i + dir + tabs.length) % tabs.length].tabEl);
    }

    /** The Aether window this browser lives in, if any. */
    hostWindow() {
        try {
            const app = top.anura?.apps["anura.browser"];
            return app?.windows.find((w) => w.content.contains(window.frameElement)) || null;
        } catch {
            return null;
        }
    }

    /* ---- sessions ------------------------------------------------------ */

    saveSession() {
        clearTimeout(this.sessionTimer);
        this.sessionTimer = setTimeout(() => {
            const tabs = this.orderedTabs;
            if (!tabs.length) return;
            localStorage.setItem("session", JSON.stringify({
                tabs: tabs.map((t) => t.currentUrl || this.settings.getSetting("startUrl")),
                active: Math.max(0, tabs.indexOf(this.activeTab)),
            }));
        }, 250);
    }

    /** Reopen last time's tabs, unless another browser window already has them. */
    restoreSession() {
        if (this.settings.getSetting("restoreSession") !== "on") return false;
        try {
            if ((top.anura?.apps["anura.browser"]?.windows.length || 0) > 1) return false;
        } catch { /* not in Aether */ }
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem("session")); } catch { /* corrupt */ }
        if (!saved || !Array.isArray(saved.tabs) || !saved.tabs.length) return false;
        const start = this.settings.getSetting("startUrl");
        if (saved.tabs.length === 1 && saved.tabs[0] === start) return false;
        saved.tabs.forEach((url, i) => this.openTab(url, { background: i !== saved.active }));
        return true;
    }

    /* ---- chrome that follows the active tab --------------------------- */

    onTabLoadState(tab, switched = false) {
        if (tab !== this.activeTab) return;
        this.reloadBtn.classList.toggle("is-loading", tab.loading);
        this.reloadBtn.title = tab.loading ? "Stop loading (Esc)" : "Reload (Ctrl+R)";
        const bar = this.loadBar;
        // Two independent Web Animations: scale (the progress) and opacity
        // (showing and hiding). Both run on the compositor, and each can be
        // retargeted mid-flight from wherever it currently is.
        const scaleNow = () => {
            const m = getComputedStyle(bar).transform;
            const v = m && m !== "none" ? parseFloat(m.split("(")[1]) : 0;
            return Number.isFinite(v) ? v : 0;
        };
        const scaleTo = (to, duration, easing) => {
            const from = scaleNow();
            this.barScale?.cancel();
            this.barScale = bar.animate(
                [{ transform: `scaleX(${from})` }, { transform: `scaleX(${to})` }],
                { duration, easing, fill: "forwards" },
            );
            return this.barScale;
        };
        const fadeTo = (to, duration, delay = 0) => {
            const from = parseFloat(getComputedStyle(bar).opacity) || 0;
            this.barFade?.cancel();
            this.barFade = bar.animate([{ opacity: from }, { opacity: to }], {
                duration, delay, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards",
            });
            return this.barFade;
        };
        const jump = (scale, opacity) => {
            this.barScale?.cancel();
            this.barFade?.cancel();
            bar.style.transform = `scaleX(${scale})`;
            bar.style.opacity = String(opacity);
        };

        if (tab.loadState === "loading") {
            const visible = parseFloat(getComputedStyle(bar).opacity) > 0.05;
            if (switched) jump(0.12, 1);
            else if (!visible || scaleNow() >= 0.99) jump(0, 0);
            fadeTo(1, 120);
            // Races ahead, then crawls: it never claims to be done.
            scaleTo(0.82, 9000, "cubic-bezier(0.1, 0.75, 0.2, 1)");
        } else if (tab.loadState === "interactive") {
            fadeTo(1, 120);
            scaleTo(Math.max(scaleNow(), 0.93), 450, "cubic-bezier(0.2, 0.8, 0.2, 1)");
        } else if (switched) {
            jump(0, 0);
        } else {
            scaleTo(1, 220, "cubic-bezier(0.3, 0.7, 0.4, 1)").finished.then(() => {
                if (!this.activeTab?.loading) fadeTo(0, 280);
            }).catch(() => {});
        }
    }

    onTabUrlChange(tab) {
        if (tab !== this.activeTab) return;
        const on = this.bookmarks.indexOf(tab.currentUrl) >= 0;
        this.starBtn.classList.toggle("is-on", on);
        this.starBtn.title = on ? "Remove bookmark (Ctrl+D)" : "Bookmark this page (Ctrl+D)";
        this.siteInfo.update();
        this.findBar.reset();
    }

    onZoomChange(tab) {
        if (tab !== this.activeTab) return;
        const z = tab.zoom;
        this.zoomBadge.hidden = z === 100;
        this.zoomBadge.textContent = z + "%";
        document.querySelectorAll(".moreMenu .zoomValue").forEach((el) => el.textContent = z + "%");
    }

    switchTabs(detail) {
        var oldTab = detail.active;
        var newTab = detail.tabEl;
        if(oldTab) this.tabs.get(oldTab).handleSwitchAway();
        this.tabs.get(newTab).handleSwitchTo(); 
    }

    navigateTo(url) {
        this.activeTab.navigateTo(url);
    }

    handleReload() {
        if (this.activeTab.loading) this.activeTab.handleStop();
        else this.activeTab.handleReload();
    }

    handleSettings() {
        this.eventsEl.dispatchEvent(this.createEvent("aboutbrowser-contextmenu", {type: "more", browser: this}, true));
    }

    handleSettingsCtxMenu(menuItem) {
        this.settingsCtxMenu.classList.add("hidden");
        this.settingsCtxBtn.classList.remove("active");
        this.ctxMenuClickChecker.style.setProperty("display", "none");
        switch(menuItem) {
            case "newTab":
                this.openTab();
                break;
            case "reopenTab":
                this.reopenClosedTab();
                break;
            case "find":
                this.findBar.open();
                break;
            case "connection":
                this.siteInfo.open(true);
                break;
            case "shortcuts":
                this.shortcuts.showSheet();
                break;
            case "history":
                this.openTab(this.resourcesProtocol + "history");
                break;
            case "downloads":
                this.openTab(this.resourcesProtocol + "downloads");
                break;
            case "bookmarks":
                this.openTab(this.resourcesProtocol + "bookmarks");
                break;
            case "devtools":
                this.handleDevTools()
                break;
            case "settings":
                this.openTab(this.resourcesProtocol + "settings");
                break;
            case "about":
                this.openTab(this.resourcesProtocol + "versionHistory");
                break;
        }
    }

    handleBack() {
        this.activeTab.handleHistoryBack();
    }
    handleDevTools() {
        this.activeTab.handleDevTools();
    }

    handleForward() {
        this.activeTab.handleHistoryForward();
    }

    handleBookmarks() {
        const tab = this.activeTab;
        const i = this.bookmarks.indexOf(tab.currentUrl);
        if (i >= 0) this.bookmarks.delete(i);
        else {
            this.bookmarks.add(tab.currentTitle, tab.currentUrl, tab.currentFavi);
            this.starBtn.classList.remove("pop");
            void this.starBtn.offsetWidth; // restart the pop
            this.starBtn.classList.add("pop");
        }
        this.bookmarks.save();
        this.propagateMessage({ type: "reloadBookmarks" });
        this.onTabUrlChange(tab);
    }

    handleExtensions() {
        this.openTab(this.resourcesProtocol + "extensions");
    }

    replaceInText(element, pattern, replacement) {
      for (let node of element.childNodes) {
        switch (node.nodeType) {
          case Node.ELEMENT_NODE:
            this.replaceInText(node, pattern, replacement);
            break;
          case Node.TEXT_NODE:
            node.textContent = node.textContent.replace(pattern, replacement);
            break;
          case Node.DOCUMENT_NODE:
            this.replaceInText(node, pattern, replacement);
        }
      }
    }

    addBranding() {
        this.replaceInText(document.body, /\${name}/g, this.branding.name);
        this.replaceInText(document.body, /\${version}/g, this.branding.version);
    }
}

async function init(injectNode) {
    let plugins = new AboutBrowserPlugins();
    await plugins.init();
    await plugins.inject();
    let aboutbrowser = new AboutBrowser(plugins);
    window.aboutbrowser = aboutbrowser;
}
