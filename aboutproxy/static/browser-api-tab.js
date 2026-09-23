function sendMessage(msg) {
    window.parent.postMessage(msg, window.origin);
}

window.addEventListener("message", (event) => {
    if (event.origin != window.origin) return;
    let msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "settingSet") {
        console.debug("recieved settingSet for " + msg.setting)
        settingSetCallback(msg);
    } else if (msg.type === "settingValue") {
        console.debug("recieved settingValue for " + msg.setting + " and value is " + msg.value)
        settingValueCallback(msg);
    } else if (msg.type === "reloadBookmarks") {
        console.debug("recieved reloadBookmarks");
        reloadBookmarksCallback(msg);
    } else if (msg.type === "historyDomainViewCounts") {
        console.debug("recieved historyDomainViewCounts - redacted because it may be giant");
        historyDomainViewCountsCallback(msg);
    } else if (msg.type === "reloadExtensions") {
        console.debug("recieved reloadExtensions");
        reloadExtensionsCallback(msg);
    } else if (msg.type === "extensionList") {
        console.debug("recieved extensionList - redacted because it may be giant");
        extensionListCallback(msg);
    } else if (msg.type === "branding") {
        console.debug("recieved branding");
        brandingCallback(msg);
    } else if (msg.type === "topSites") {
        topSitesCallback(msg);
    } else if (msg.type === "connectionState") {
        connectionStateCallback(msg);
    } else if (msg.type === "settingsMetadata") {
        console.debug("recieved settingsMetadata");
        settingsMetadataCallback(msg);
    }
})

function settingSetCallback() {}
function settingValueCallback() {}
function reloadBookmarksCallback() {}
function historyDomainViewCountsCallback() {}
function reloadExtensionsCallback() {}
function extensionListCallback() {}
function brandingCallback() {}
function settingsMetadataCallback() {}
function topSitesCallback() {}
function connectionStateCallback() {}
