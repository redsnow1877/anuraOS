var omnibox = document.querySelector("#omnibox");
omnibox.addEventListener("keydown", function(e) {
    if (e.code === "Enter") {
        console.debug("user pressed enter on omnibox");
        if (omnibox.value === "") return;
        sendMessage({
            type: "setUrl",
            value: omnibox.value
        });
    }
});

function openVerHistory() {
    sendMessage({
        type: "setUrl",
        value: "aboutbrowser://versionHistory"
    });
}

function topSitesCallback(msg) {
    const recents = document.querySelector('#recents');
    recents.replaceChildren();
    msg.data.slice(0, 6).forEach((site, i) => {
        const el = document.createElement('div');
        el.className = "recent";
        el.style.setProperty("--i", i);
        el.title = site.url;
        el.addEventListener('click', () => sendMessage({type: "setUrl", value: site.url}));
        const imgWrapperEl = document.createElement('div');
        imgWrapperEl.className = "recentIconWrapper";
        const imgEl = document.createElement('img');
        imgEl.src = site.icon;
        imgEl.alt = "";
        imgWrapperEl.appendChild(imgEl);
        el.appendChild(imgWrapperEl);
        const titleEl = document.createElement('span');
        // Page titles come from the web: text, never markup.
        titleEl.textContent = site.title || site.url;
        el.appendChild(titleEl);
        recents.appendChild(el);
    });
}

function connectionStateCallback(msg) {
    const banner = document.querySelector('#proxyBanner');
    if (!banner) return;
    if (msg.state === "down") {
        banner.querySelector('.bannerUrl').textContent = msg.url;
        banner.hidden = false;
        requestAnimationFrame(() => banner.classList.add('is-shown'));
    } else if (msg.state === "ok") {
        banner.classList.remove('is-shown');
        setTimeout(() => { banner.hidden = true; }, 250);
    }
}

document.querySelector('#proxyBannerBtn')?.addEventListener('click', () => sendMessage({ type: "openConnectionPanel" }));

sendMessage({ type: "getTopSites", limit: 6 });
sendMessage({ type: "getConnection" });
