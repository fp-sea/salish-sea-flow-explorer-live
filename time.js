// The time bar along the bottom of the page: the time on screen within the model run — the date
// and a large clock in local time, how far that is from now, UTC and the hours into the run — with
// Play, a slider marked at each local midnight and at now, Now and the playback speed.
//
// Time is a number (ms since the epoch). Play advances it by `rate` model hours per real second,
// wrapping at the end of the run. Local time is the region's zone (America/Los_Angeles, PDT/PST).

const $ = (id) => document.getElementById(id);

export class TimeBar {
  constructor({ tz = "America/Los_Angeles", onChange }) {
    this.tz = tz; this.onChange = onChange;
    this.t0 = this.t1 = this.t = 0; this.playing = false; this.rate = 1;
    this.fmtDate = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
    this.fmtTime = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" });
    this.fmtDay = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", day: "numeric" });
    this.fmtHour = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" });
    this.fmtUtc = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
    $("t-slider").addEventListener("input", (e) => this.set(this.t0 + +e.target.value * 3600e3, { from: "slider" }));
    $("play").onclick = () => this.play(!this.playing);
    $("now-btn").onclick = () => this.now();
    $("play-rate").onchange = (e) => { this.rate = +e.target.value; };
    this.rate = +$("play-rate").value;
    setInterval(() => this.ticks(), 600e3);                          // (the now mark creeps along)
    addEventListener("keydown", (e) => {
      if (e.target.closest?.("input, select, textarea") || $("timebar").hidden) return;
      if (e.key === " ") { e.preventDefault(); this.play(!this.playing); }
      else if (e.key === "ArrowRight") this.set(this.t + (e.shiftKey ? 6 : 1) * 3600e3);
      else if (e.key === "ArrowLeft") this.set(this.t - (e.shiftKey ? 6 : 1) * 3600e3);
    });
  }

  setRange(t0, t1, note = "") {
    this.t0 = t0; this.t1 = t1;
    $("t-slider").max = String((t1 - t0) / 3600e3);
    $("t-note").textContent = note;
    $("timebar").hidden = false;
    this.ticks();
  }

  dayName(t) { const q = this.fmtDay.formatToParts(new Date(t)), g = (k) => q.find((x) => x.type === k)?.value || ""; return `${g("weekday")} ${g("day")}`; }   // "Fri 2"

  // Marks under the slider: each local midnight (with the day) and now, if the run covers it.
  ticks() {
    const T = $("t-ticks"), span = this.t1 - this.t0; T.textContent = "";
    if (!(span > 0)) return;
    const at = (t, cls, text, title) => {
      const d = document.createElement("span"); d.className = cls; d.style.setProperty("--f", ((t - this.t0) / span).toFixed(4));
      if (text) d.textContent = text; if (title) d.title = title; T.appendChild(d);
    };
    // the first local midnight after t0 (step by the hour: DST days are 23 or 25 h)
    let t = Math.ceil(this.t0 / 3600e3) * 3600e3;
    while (t <= this.t1 && +this.fmtHour.format(new Date(t)) % 24 !== 0) t += 3600e3;
    for (; t <= this.t1; t += 22 * 3600e3) {
      while (t <= this.t1 && +this.fmtHour.format(new Date(t)) % 24 !== 0) t += 3600e3;
      if (t <= this.t1) at(t, "tk-day", this.dayName(t), "Midnight, local time");
    }
    const n = Date.now(); if (n >= this.t0 && n <= this.t1) at(n, "tk-now", "", "Now");
  }

  // Now, if the run covers it, else the run's start.
  now() { const n = Date.now(); this.set(n >= this.t0 && n <= this.t1 ? n : this.t0); }

  set(t, { from } = {}) {
    this.t = Math.max(this.t0, Math.min(this.t1, t));
    if (from !== "slider") $("t-slider").value = String((this.t - this.t0) / 3600e3);
    const d = new Date(this.t), h = (this.t - this.t0) / 3600e3, ago = (Date.now() - this.t) / 3600e3;
    const parts = this.fmtTime.formatToParts(d), zone = parts.find((q) => q.type === "timeZoneName")?.value || "";
    $("t-date").textContent = this.fmtDate.format(d);
    $("t-time").textContent = parts.filter((q) => q.type === "hour" || q.type === "minute" || q.type === "literal").map((q) => q.value).join("").trim();
    $("t-zone").textContent = zone;
    const a = Math.abs(ago), span = a < 24 ? `${Math.round(a)} h` : `${(a / 24).toFixed(1)} days`, rel = a < 0.5 ? "now" : ago > 0 ? `${span} ago` : `in ${span}`;
    $("t-rel").textContent = rel; $("t-rel").classList.toggle("is-now", a < 0.5);
    $("t-utc").textContent = `${this.fmtUtc.format(d)} UTC · run +${h.toFixed(1)} h`;
    this.onChange?.(this.t);
  }

  play(on) {
    this.playing = on; $("play").textContent = on ? "❚❚" : "▶"; $("play").classList.toggle("on", on); $("play").title = on ? "Pause (space)" : "Play: the model hours, blended smoothly (space)";
    this.last = performance.now();
  }

  // Called every frame by the stage. → true if the time moved.
  tick(now) {
    if (!this.playing) return false;
    const dt = Math.min(0.1, (now - (this.last ?? now)) / 1000); this.last = now;
    let t = this.t + dt * this.rate * 3600e3;
    if (t > this.t1) t = this.t0;
    this.set(t);
    return true;
  }
}
