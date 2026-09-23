class History {
    // localStorage holds ~5 MB per origin, shared with everything else here,
    // and every entry carries its favicon as a data URL. Keep it bounded.
    static MAX = 500;

    constructor() {
        this.reload();
    }

    push(url, title, icon) {
        const list = this.history.history;
        const last = list[list.length - 1];
        if (last && last.url === url) {
            // A reload, or the same page again: refresh it, don't duplicate it.
            last.title = title;
            last.icon = icon;
        } else {
            list.push({url: url, title: title, icon: icon});
            if (list.length > History.MAX) list.splice(0, list.length - History.MAX);
        }
        this.save();
    }

    clear() {
        this.history.history = [];
        this.history.statistics.domainViewCounts = {};
        this.save();
    }

    save() {
        // Out of room? Drop the oldest fifth and try again, a few times.
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                localStorage.setItem("history", JSON.stringify(this.history));
                return;
            } catch (e) {
                const list = this.history.history;
                if (!list.length) return;
                list.splice(0, Math.max(1, Math.ceil(list.length / 5)));
            }
        }
    }

    reload() {
        try {
            this.history = JSON.parse(localStorage.getItem("history"));
        } catch {
            this.history = null;
        }
        if (this.history == null || !Array.isArray(this.history.history)) {
            this.history = {history: [], statistics: {domainViewCounts: {}}};
            this.save();
        }
    }

    getList() {
        return this.history.history;
    }

    /** Most visited pages, most visited first: [{url, title, icon, count}]. */
    getTopSites(limit = 8) {
        const map = new Map();
        for (const site of this.history.history) {
            if (!site || !site.url) continue;
            const e = map.get(site.url) || {url: site.url, title: site.title, icon: site.icon, count: 0};
            e.count++;
            // Latest visit wins for title and icon.
            if (site.title) e.title = site.title;
            if (site.icon) e.icon = site.icon;
            map.set(site.url, e);
        }
        return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
    }

    // Kept for anything still asking in the old shape: [[JSON of {url,title,icon}, count]].
    getSortedDomainViewCounts() {
        return this.getTopSites(50).map((s) => [JSON.stringify({url: s.url, title: s.title, icon: s.icon}), s.count]);
    }

    recalculateDomainViewCounts() {}
}
