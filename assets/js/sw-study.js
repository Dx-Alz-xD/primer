/* =====================================================================
   The service worker's part in the study tools. server/offline.mjs adds
   this file after sw.js when it sends /sw.js (it is wrapped, so its
   names don't meet sw.js's).

   - Notifications from the study timer and from reminders (shown by the
     pages through registration.showNotification): a click brings back
     the Primer window, or opens the page the notification is about.
   - Periodic Background Sync ("primer-reminders"), where the browser
     allows it (the installed app on Chrome or Edge): with Primer closed,
     it asks the server which reminders are new and shows them, once
     each, outside the learner's quiet hours.
   ===================================================================== */
(() => {
  const ORIGIN_HERE = self.location.origin;
  const ICON = '/assets/icons/icon-192.png';

  self.addEventListener('notificationclick', (event) => {
    const data = (event.notification && event.notification.data) || {};
    if (!data.primer) return; // not one of ours
    event.notification.close();
    let url;
    try { url = new URL(data.url || '/app.html', ORIGIN_HERE); } catch (e) { url = new URL('/app.html', ORIGIN_HERE); }
    if (url.origin !== ORIGIN_HERE) url = new URL('/app.html', ORIGIN_HERE);
    event.waitUntil((async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const same = wins.find((c) => c.url === url.href);
      if (same && 'focus' in same) return same.focus();
      // the timer only needs Primer back in front; a reminder opens its lesson
      const any = wins.find((c) => 'focus' in c);
      if (data.focus && any) return any.focus();
      if (any && 'navigate' in any && data.primer === 'reminder') {
        try { const c = await any.navigate(url.href); return (c || any).focus(); } catch (e) { /* not ours to steer: open a window */ }
      }
      return self.clients.openWindow(url.href);
    })());
  });

  /* ---------------- reminders while Primer is closed ---------------- */
  async function dictionary(lang) {
    if (!lang || lang === 'en') return {};
    try {
      const r = await fetch(`/assets/i18n/${encodeURIComponent(lang)}.json`, { credentials: 'same-origin' });
      return r.ok ? ((await r.json()).strings || {}) : {};
    } catch (e) { return {}; }
  }

  function words(r, tr) {
    const vals = { title: r.title, days: r.days, done: r.done, next: r.next };
    const lead = r.days === 1 ? tr('It’s been a day since you opened “{title}”.', vals)
      : r.stage === 1 ? tr('It’s been {days} days since you opened “{title}”.', vals)
        : tr('You haven’t opened “{title}” for {days} days.', vals);
    const where = r.done === 0 ? tr('Pick up at lesson {next}.', vals)
      : r.done === 1 ? tr('You’re 1 lesson in: pick up at lesson {next}.', vals)
        : tr('You’re {done} lessons in: pick up at lesson {next}.', vals);
    return lead + ' ' + where + (r.last ? ' ' + tr('This is the last reminder about it.', vals) : '');
  }

  function quiet(s) {
    if (s.quietFrom == null || s.quietTo == null) return false;
    const h = new Date().getHours();
    return s.quietFrom < s.quietTo ? h >= s.quietFrom && h < s.quietTo : h >= s.quietFrom || h < s.quietTo;
  }

  async function checkReminders() {
    if (!self.registration || self.Notification && self.Notification.permission !== 'granted') return;
    const res = await fetch('/api/reminders', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return; // signed out, or the server is away: try next time
    const d = await res.json();
    if (!d || !d.ok || !d.settings || !d.settings.notify || quiet(d.settings)) return;
    const fresh = (d.reminders || []).filter((r) => !r.notified && r.unread);
    if (!fresh.length) return;
    const dict = await dictionary(d.lang);
    const tr = (key, vals) => (dict[key] || key).replace(/\{(\w+)\}/g, (m, k) => (vals && k in vals ? vals[k] : m));
    if (fresh.length === 1) {
      const r = fresh[0];
      await self.registration.showNotification(tr('Primer', {}), {
        body: words(r, tr), icon: ICON, badge: ICON, tag: 'primer-remind-' + r.courseId,
        data: { primer: 'reminder', url: `/lesson.html?course=${encodeURIComponent(r.courseId)}&lesson=${r.next}` }
      });
    } else {
      const n = d.unfinished;
      await self.registration.showNotification(n === 1 ? tr('You have 1 unfinished course.', {}) : tr('You have {n} unfinished courses.', { n }), {
        body: fresh.slice(0, 4).map((r) => '“' + r.title + '”').join(', ') + (fresh.length > 4 ? ' …' : ''),
        icon: ICON, badge: ICON, tag: 'primer-remind', data: { primer: 'reminder', url: '/app.html#reminders' }
      });
    }
    await fetch('/api/reminders/notified', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseIds: fresh.map((r) => r.courseId) })
    });
  }

  self.addEventListener('periodicsync', (event) => {
    if (event.tag !== 'primer-reminders') return;
    event.waitUntil(checkReminders().catch(() => {}));
  });
  // a page can ask for the same check (used to test it)
  self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'study-check-reminders') event.waitUntil(checkReminders().catch(() => {}));
  });
})();
