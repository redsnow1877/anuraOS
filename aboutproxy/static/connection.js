// Which Wisp server carries this browser's traffic, and is it answering?
//
// Every page loads through a Wisp relay. By default that's the server Aether
// itself is hosted on, which is right for a self-hosted install and useless
// on static hosting (GitHub Pages can't run one). This keeps an eye on the
// relay, tells the UI, and lets you move to another one without a restart.
class ProxyConnection {
    constructor(browser) {
        this.browser = browser;
        this.state = "unknown"; // "checking" | "ok" | "down"
        this.latency = null;
        this.reason = "";
        this.listeners = new Set();
        this.checking = null;
    }

    static sameOrigin() {
        return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/";
    }

    get presets() {
        return [
            { name: "This site", url: ProxyConnection.sameOrigin(), note: "The server Aether is running on" },
            { name: "Mercury Workshop", url: "wss://wisp.mercurywork.shop/", note: "Public relay from the anuraOS developers" },
        ];
    }

    get anura() {
        try { return top.anura || null; } catch { return null; }
    }

    get url() {
        return this.anura?.net?.wispServer || this.anura?.settings.get("wisp-url") || ProxyConnection.sameOrigin();
    }

    onChange(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    emit() {
        for (const fn of this.listeners) {
            try { fn(this); } catch (e) { console.warn(e); }
        }
        this.browser.propagateMessage({ type: "connectionState", state: this.state, url: this.url, latency: this.latency });
    }

    static probe(url, timeout) {
        let net = null;
        try { net = top.Networking; } catch { /* not inside Aether */ }
        if (net) return net.probeWisp(url, timeout);
        return Promise.resolve({ ok: false, reason: "Not running inside Aether" });
    }

    check() {
        if (this.checking) return this.checking;
        this.state = "checking";
        this.emit();
        this.checking = ProxyConnection.probe(this.url).then((r) => {
            this.checking = null;
            this.state = r.ok ? "ok" : "down";
            this.latency = r.ok ? r.ms : null;
            this.reason = r.reason || "";
            this.emit();
            return r;
        });
        return this.checking;
    }

    async use(url) {
        const a = this.anura;
        if (!a) return;
        a.net.setWispServer(url);
        await a.settings.set("wisp-url", url);
        return this.check();
    }
}
