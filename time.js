// The time bar: the time on screen within the model run, with a slider, Now and Play.
//
// Time is a number (ms since the epoch). Play advances it by `rate` model hours per real second,
// wrapping at the end of the run. Labels: local time in the region's zone (America/Los_Angeles,
// PDT/PST) and UTC, and how far into the run.

const $ = (id) => document.getElementById(id);

export class TimeBar {
  constructor({ tz = "America/Los_Angeles", onChange }) {
    this.tz = tz; this.onChange = onChange;
    this.t0 = this.t1 = this.t = 0; this.playing = false; this.rate = 1;
    this.fmtLocal = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" });
    this.fmtUtc = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
    $("t-slider").addEventListener("input", (e) => this.set(this.t0 + +e.target.value * 3600e3, { from: "slider" }));
    $("play").onclick = () => this.play(!this.playing);
    $("now-btn").onclick = () => this.now();
    $("play-rate").onchange = (e) => { this.rate = +e.target.value; };
    this.rate = +$("play-rate").value;
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
  }

  // Now, if the run covers it, else the run's start.
  now() { const n = Date.now(); this.set(n >= this.t0 && n <= this.t1 ? n : this.t0); }

  set(t, { from } = {}) {
    this.t = Math.max(this.t0, Math.min(this.t1, t));
    if (from !== "slider") $("t-slider").value = String((this.t - this.t0) / 3600e3);
    const d = new Date(this.t), h = (this.t - this.t0) / 3600e3, ago = (Date.now() - this.t) / 3600e3;
    $("t-local").textContent = this.fmtLocal.format(d);
    $("t-utc").textContent = `${this.fmtUtc.format(d)} UTC · +${h.toFixed(1)} h` + (Math.abs(ago) < 0.5 ? " · now" : "");
    this.onChange?.(this.t);
  }

  play(on) {
    this.playing = on; $("play").textContent = on ? "❚❚" : "▶"; $("play").classList.toggle("on", on);
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
