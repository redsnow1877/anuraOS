class Tab {
    constructor(browser, background = false) {
        this.browser = browser;

        this.tabEl = this.browser.chromeTabs.addTab({}, { background: true });
        this.browser.tabs.set(this.tabEl, this);

        this.iframe = document.createElement("iframe");
        this.iframe.title = "Tab Contents";
        this.iframe.classList.add("browserTabContents");
        this.iframe.style.setProperty("display", "none");
        this.browser.iFrameContainer.appendChild(this.iframe);

        this.currentUrl = '';
        this.currentTitle = '';
        this.currentFavi = '';
        this.isActive = false;
        this.isDevToolsActive = false;
        // "idle" | "loading" (navigating) | "interactive" (DOM ready, still loading)
        this.loadState = "idle";
        this.zoom = 100;
        this.handleUnload();

        this.iframe.addEventListener("load", () => this.setLoadState("idle"));

        if (!background) this.browser.chromeTabs.setCurrentTab(this.tabEl);
    }

    reinjectTheme() {
        this.browser.extensions.injectThemeIntoFrame(this.currentUrl, this.iframe);
    }

    get loading() {
        return this.loadState !== "idle";
    }

    setLoadState(state) {
        if (this.loadState === state) return;
        this.loadState = state;
        if (state === "idle") this.tabEl.removeAttribute("loading");
        else this.tabEl.setAttribute("loading", "");
        this.browser.onTabLoadState(this);
    }

    // Needed because you can't listen for DOMContentLoaded from an iframe across navigations
    handleUnload() {
        var self = this;
        setTimeout(() => {
            if (!self.iframe || !self.iframe.contentWindow) return;
            self.iframe.contentWindow.addEventListener("DOMContentLoaded", () => {
                self.handleOnload();
            });
            self.iframe.contentWindow.addEventListener("load", () => { self.browser.extensions.injectLoaded(self.currentUrl, self.iframe) });
            // Fires the moment a navigation starts (link, form, script), long
            // before the old page goes away: that's when "loading" begins.
            self.iframe.contentWindow.addEventListener("beforeunload", () => {
                self.setLoadState("loading");
                // Downloads and 204s start a navigation that never replaces the
                // page. If the same page is still here after a while, it didn't.
                const doc = self.iframe.contentDocument;
                clearTimeout(self.staleTimer);
                self.staleTimer = setTimeout(() => {
                    if (self.iframe.contentDocument === doc && self.loadState === "loading") self.setLoadState("idle");
                }, 20000);
            });
            self.iframe.contentWindow.addEventListener("pagehide", () => {
                // The page is going away: whatever replaces it is loading now.
                self.setLoadState("loading");
                self.handleUnload();
            }); // s/unload/pagehide/
        }, 0);
    }

    /** A proxied (or internal) address, turned back into what the user sees. */
    displayUrl(url) {
        if (url.startsWith(this.browser.resourcesPrefix)) {
            url = url.replace(this.browser.resourcesPrefix, '');
            url = url.replace(/\.html(?=$|[?#])/, '');
            return this.browser.resourcesProtocol + url;
        }
        const prefix = window.location.origin + baseUrlFor(this.browser.settings.getSetting("currentProxyId"));
        if (url.startsWith(prefix)) {
            return decodeUrl(url.slice(prefix.length), this.browser.settings.getSetting("currentProxyId"));
        }
        return url;
    }

    handleOnload() {
        var url = this.iframe.contentWindow.location.toString();
        let urlEncoded = url;
        if (url == "about:blank") {
            return;
        }
        if (this.loadState === "loading") this.setLoadState("interactive");

        url = this.displayUrl(url);
        if (!url.startsWith(this.browser.resourcesProtocol) && !url.startsWith("http") && !url.startsWith("https")) {
            this.handleHistoryBack();
            top.anura.dialog.confirm(`This website wants to open ${url}`).then((res) => {
                if (res === true) {
                    top.anura.uri.handle(url);
                }
            })
        }
        this.currentUrl = url;

        this.browser.extensions.injectDOMContentLoaded(this.currentUrl, this.iframe);

        // get title of iframe
        var title = this.iframe.contentWindow.document.title;
        if (title == "") {
            title = url;
        }
        title = title.replace(decodeURIComponent(urlEncoded.split('/').slice(-1)), url);
        this.currentTitle = title;

        this.attachPageHooks();
        this.applyZoom();

        if (this.isActive) this.setBrowserAttributes();
        this.browser.saveSession();

        var self = this;
        (async (url) => {
            // get favicon of iframe
            var favi = null;
            try {
                if (url.startsWith(this.browser.resourcesProtocol)) {
                    favi = getIconNoFallback(self.iframe.contentWindow.document);
                } else if (url != "") {
                    var faviUrl = getIcon(self.iframe.contentWindow.document, new URL(url));
                    var blob = await this.browser.bareClient.fetch(faviUrl).then((r) => r.blob())
                    if (
                        blob != null &&
                        /* for sites that 200 and send some other non-image data instead of 404ing
                           LOOKING AT YOU, mercurywork.shop! seriously, what server does this??? */
                        blob.type.includes("image")
                    ) {
                        favi = await blobToDataUrl(blob);
                    }
                }
            } catch (e) {
                console.debug("favicon fetch failed", e);
            }

            if (favi == null) {
                favi = this.browser.resourcesPrefix + "darkfavi.png";
            }

            if (url != this.browser.settings.getSetting("startUrl")) this.browser.history.push(url, title, favi);
            this.currentFavi = favi;

            // update tab
            self.browser.chromeTabs.updateTab(self.tabEl, {
                favicon: favi,
                title: self.currentTitle
            });
        })(url);
    }

    /**
     * Wire the page up to behave like a real browser tab: links that ask for a
     * new tab get one, window.open opens a tab instead of escaping into a real
     * browser window, single-page apps keep the address bar and title honest,
     * and the browser's shortcuts work while the page has focus.
     */
    attachPageHooks() {
        const win = this.iframe.contentWindow;
        const doc = this.iframe.contentDocument;
        if (!win || !doc || win.__aboutbrowserHooked) return;
        win.__aboutbrowserHooked = true;
        const self = this;

        const onLinkClick = (e) => {
            if (e.type === "auxclick" && e.button !== 1) return;
            if (e.type === "click" && e.button !== 0) return;
            const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
            if (!a) return;
            const raw = a.getAttribute("href") || "";
            if (!raw || raw.startsWith("#") || /^javascript:/i.test(raw)) return;
            const url = self.displayUrl(a.href);
            const modified = e.button === 1 || e.ctrlKey || e.metaKey;
            const target = (a.getAttribute("target") || "").toLowerCase();
            const wantsNew = target && !["_self", "_top", "_parent"].includes(target);
            if (modified) {
                e.preventDefault();
                e.stopImmediatePropagation();
                self.browser.openTab(url, { background: !e.shiftKey, opener: self });
            } else if (wantsNew) {
                e.preventDefault();
                self.browser.openTab(url, { opener: self });
            }
        };
        doc.addEventListener("click", onLinkClick, true);
        doc.addEventListener("auxclick", onLinkClick, true);

        try {
            win.open = function (url) {
                let target = "";
                try {
                    target = url ? new URL(String(url), self.currentUrl).href : "";
                } catch {
                    target = String(url || "");
                }
                self.browser.openTab(target || undefined, { opener: self });
                return null;
            };
        } catch { /* locked down */ }

        // Single-page apps change the URL and title without a page load.
        const sync = () => self.syncLocation();
        for (const fn of ["pushState", "replaceState"]) {
            try {
                const orig = win.history[fn];
                win.history[fn] = function () {
                    const r = orig.apply(this, arguments);
                    sync();
                    return r;
                };
            } catch { /* not writable */ }
        }
        win.addEventListener("popstate", sync);
        win.addEventListener("hashchange", sync);
        const titleEl = doc.querySelector("title");
        if (titleEl) {
            new win.MutationObserver(() => {
                if (doc.title && doc.title !== self.currentTitle) {
                    self.currentTitle = doc.title;
                    self.browser.chromeTabs.updateTab(self.tabEl, { favicon: self.currentFavi, title: doc.title });
                    if (self.isActive) self.setBrowserAttributes();
                }
            }).observe(titleEl, { childList: true, characterData: true, subtree: true });
        }

        this.browser.shortcuts?.attach(win);
    }

    syncLocation() {
        try {
            const url = this.displayUrl(this.iframe.contentWindow.location.toString());
            if (url === this.currentUrl) return;
            this.currentUrl = url;
            if (this.isActive) this.setBrowserAttributes();
            this.browser.saveSession();
        } catch { /* navigated cross-origin */ }
    }

    /* ---- zoom --------------------------------------------------------- */

    static ZOOM_LEVELS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];

    zoomKey() {
        try {
            if (this.currentUrl.startsWith(this.browser.resourcesProtocol)) return "aboutbrowser";
            return new URL(this.currentUrl).host;
        } catch {
            return "";
        }
    }

    applyZoom() {
        const levels = JSON.parse(localStorage.getItem("zoomLevels") || "{}");
        this.zoom = levels[this.zoomKey()] || 100;
        try {
            const root = this.iframe.contentDocument.documentElement;
            if (this.zoom === 100) root.style.removeProperty("zoom");
            else root.style.setProperty("zoom", String(this.zoom / 100));
        } catch { /* not reachable */ }
        if (this.isActive) this.browser.onZoomChange(this);
    }

    /** `dir` is -1, +1, or 0 to reset. */
    stepZoom(dir) {
        const L = Tab.ZOOM_LEVELS;
        let next = 100;
        if (dir !== 0) {
            const i = L.findIndex((z) => z >= this.zoom);
            const at = i < 0 ? L.length - 1 : i;
            const exact = L[at] === this.zoom;
            next = L[Math.max(0, Math.min(L.length - 1, dir > 0 ? (exact ? at + 1 : at) : at - 1))];
        }
        const levels = JSON.parse(localStorage.getItem("zoomLevels") || "{}");
        const key = this.zoomKey();
        if (next === 100) delete levels[key];
        else levels[key] = next;
        localStorage.setItem("zoomLevels", JSON.stringify(levels));
        // Every open tab on the same site follows, like Chrome.
        for (const t of this.browser.tabs.internalList) if (t.value.zoomKey() === key) t.value.applyZoom();
    }

    /* ---- navigation --------------------------------------------------- */

    handleSwitchAway() {
        this.iframe.style.setProperty("display", "none");
        this.isActive = false;
    }

    handleSwitchTo() {
        this.isActive = true;
        this.browser.activeTab = this;
        this.iframe.style.removeProperty("display");
        this.setBrowserAttributes();
        this.browser.onTabLoadState(this, true);
        this.browser.onZoomChange(this);
        this.browser.saveSession();
    }

    handleHistoryBack() {
        this.iframe.contentWindow.history.back();
    }

    handleHistoryForward() {
        this.iframe.contentWindow.history.forward();
    }

    handleReload() {
        this.setLoadState("loading");
        this.iframe.contentWindow.location.reload();
    }

    handleStop() {
        try {
            this.iframe.contentWindow.stop();
        } catch { /* nothing to stop */ }
        this.setLoadState("idle");
    }

    handleClose() {
        this.iframe.remove();
    }

    async handleDevTools() {
        const iframeWindow = this.iframe.contentWindow;
        let state = this.isDevToolsActive;
        if (!iframeWindow.eruda) {
            iframeWindow.eval(await (await fetch('/libs/eruda.js')).text())
            this.isDevToolsActive = true;
            state = true;
        }

        if (!iframeWindow.eruda._isInit) iframeWindow.eruda.init();

        const btnBk = iframeWindow.eruda._entryBtn._$el[0].cloneNode(true);
        btnBk.style.display = "none";
        iframeWindow.eruda._entryBtn._$el[0].parentElement.replaceChild(
            btnBk,
            iframeWindow.eruda._entryBtn._$el[0]
        );
        btnBk.onclick = () => {
            btnBk.style.display = "none";
            iframeWindow.eruda.hide();
        };
        iframeWindow.eruda._entryBtn._$el[0] = btnBk;
        btnBk.setAttribute("style", "display: flex; position: fixed; bottom: 0; right: 0; margin-right: 20px; margin-bottom: 20px;")

        if (state) {
            btnBk.style.display = "flex";
            iframeWindow.eruda.show();
        } else {
            if (
                state !== undefined ||
                iframeWindow.eruda._shadowRoot.querySelector(".eruda-dev-tools").style
                    .display !== "none"
            ) {
                this.isDevToolsActive = false;
                btnBk.style.display = "none";
                iframeWindow.eruda.hide();
            } else {
                btnBk.style.display = "flex";
                iframeWindow.eruda.show();
            }
        }
    }


    setBrowserAttributes() {
        // Don't yank the address bar out from under someone typing in it.
        if (document.activeElement !== this.browser.addressBar) {
            this.browser.addressBar.value = this.currentUrl;
        }
        this.browser.browserTitle = this.currentTitle + this.browser.titleSuffix;
        document.title = this.browser.browserTitle;
        this.browser.onTabUrlChange(this);
    }

    navigateTo(url, callback) {
        var self = this;
        this.setLoadState("loading");
        // TODO: allow registering custom protocols and clean this up
        if (url == "" || url.startsWith(this.browser.resourcesProtocol)) {
            if (url == "") {
                url = this.browser.resourcesPrefix + "blank.html";
            } else if (url.startsWith(this.browser.resourcesProtocol)) {
                url = url.replace(this.browser.resourcesProtocol, this.browser.resourcesPrefix);
                url = url + ".html"
            }
            this.iframe.src = url;
            if (callback) callback();
        } else if (url.startsWith("javascript:")) {
            this.setLoadState("idle");
            let el = this.iframe.contentWindow.document.createElement("script");
            el.textContent = url;
            this.iframe.contentWindow.document.querySelector("head").appendChild(el);
            this.setBrowserAttributes();
        } else if (isUrl(url)) {
            if (hasHttps(url)) {
                proxyUsing(url, this.browser.settings.getSetting("currentProxyId"), (url) => {
                    self.iframe.src = url;
                    if (callback) callback();
                });
            } else {
                proxyUsing('https://' + url, this.browser.settings.getSetting("currentProxyId"), (url) => {
                    self.iframe.src = url;
                    if (callback) callback();
                })
            }
            return;
        } else {
            proxyUsing(this.browser.settings.getSetting("searchEngineUrl") + encodeURIComponent(url), this.browser.settings.getSetting("currentProxyId"), (url) => {
                self.iframe.src = url;
                if (callback) callback();
            });
        }
    }
}

function proxyUsing(url, proxy, callback) {
    if (proxy === "UV") {
        proxyUsingUV(url, callback);
    } else {
        console.error("Invalid proxy!");
    }
}

function baseUrlFor(proxy) {
    if (proxy === "UV") {
        return __uv$config.prefix;
    } else {
        console.error("Invalid proxy!");
    }
}

function decodeUrl(url, proxy) {
    if (proxy === "UV") {
        return __uv$config.decodeUrl(url);
    } else {
        console.error("Invalid proxy!");
    }
}

function encodeUrl(url, proxy) {
    if (proxy === "UV") {
        return __uv$config.encodeUrl(url);
    } else {
        console.error("Invalid proxy!");
    }
}

function proxyUsingUV(url, callback) {
    // window.navigator.serviceWorker.register('./sw.js', {scope: "/service"}).then(() => {
        callback(baseUrlFor("UV") + encodeUrl(url, "UV"));
    // });
}
