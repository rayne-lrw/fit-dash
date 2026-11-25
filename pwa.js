(() => {
  const $ = id => document.getElementById(id);
  const note = t => { const el = $("log"); if (el) el.textContent += (el.textContent ? "\n" : "") + t; };

  // install: Chrome/Edge fire beforeinstallprompt when one-tap install is available; otherwise show manual steps.
  // Running from the home-screen icon = display-mode isn't "browser" (the 全螢幕 button's fullscreen doesn't count).
  let deferred = null, justInstalled = false;
  const inApp = () => navigator.standalone === true ||
    (["standalone","minimal-ui","fullscreen"].some(m => matchMedia(`(display-mode: ${m})`).matches) && !document.fullscreenElement);
  const instState = () => {
    if (inApp()) return ["app", "已安裝（目前從主畫面圖示開啟）"];
    if (justInstalled) return ["done", "已安裝，之後請從主畫面的「車況面板」圖示開啟"];
    if (deferred) return ["ready", "可一鍵安裝：按右上角「安裝」"];
    if (location.protocol !== "https:") return ["none", "要用 https 網址開啟才能安裝"];
    return ["none", "瀏覽器沒有提供一鍵安裝（可能已安裝過，或之前拒絕過安裝提示），可按「安裝」看手動步驟"];
  };
  const showInst = () => {
    const [k, txt] = instState();
    $("instLine").textContent = txt;
    $("btnInstall").hidden = k === "app" || k === "done";
    $("instWhy").textContent = k === "none" ? "若主畫面或 App 清單已經有「車況面板」，代表裝過了，直接從那裡開啟即可。" : "";
  };
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; showInst(); });
  addEventListener("appinstalled", () => { deferred = null; justInstalled = true; $("instHelp").hidden = true; showInst(); note("已安裝到主畫面"); });
  document.addEventListener("fullscreenchange", showInst);
  $("btnInstall").onclick = async () => {
    if (!deferred) { $("instHelp").hidden = false; return; }
    const d = deferred; deferred = null;
    d.prompt();
    const { outcome } = await d.userChoice;
    note(outcome === "accepted" ? "開始安裝…" : "已取消安裝");
    showInst();
  };
  $("instClose").onclick = () => { $("instHelp").hidden = true; };
  showInst();

  if (!("serviceWorker" in navigator) || location.protocol !== "https:") return;
  // update banner: a new sw.js waits until the driver taps 更新, then the page reloads once
  let reloading = false, dismissed = false;
  const offer = reg => { if (reg.waiting && navigator.serviceWorker.controller && !dismissed) $("updToast").hidden = false; };
  $("updYes").onclick = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    $("updToast").hidden = true;
    reg?.waiting?.postMessage("skipWaiting");
  };
  $("updNo").onclick = () => { dismissed = true; $("updToast").hidden = true; };
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloading) { reloading = true; location.reload(); } });
  navigator.serviceWorker.register("sw.js").then(reg => {
    note("離線模式已就緒：之後沒有網路也能打開");
    offer(reg);
    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      sw?.addEventListener("statechange", () => { if (sw.state === "installed") offer(reg); });
    });
    // installed apps can stay open for hours — look for a new version when brought back to the front
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch(() => {});
})();
