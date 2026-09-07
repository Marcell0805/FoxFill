/**
 * FoxFill service worker — message relay and future background work.
 * Phase 1: popup talks to the active tab via chrome.scripting; this worker
 * stays ready for coordination as later phases add storage/events.
 */
chrome.runtime.onInstalled.addListener(() => {
  // Reserved for future defaults (profile schema migrations, etc.).
});
