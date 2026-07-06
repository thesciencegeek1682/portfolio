/* Nathan Joseph portfolio — interactive strings, spotlight, scroll reveals. */
(function () {
  "use strict";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Scroll reveals ---------- */
  var revealed = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reducedMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("visible");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    revealed.forEach(function (el) { io.observe(el); });
  } else {
    revealed.forEach(function (el) { el.classList.add("visible"); });
  }

  /* ---------- Spotlight follows cursor ---------- */
  var spot = document.querySelector(".spotlight");
  if (spot && !reducedMotion) {
    var sx = window.innerWidth / 2, sy = window.innerHeight * 0.3;
    var tx = sx, ty = sy, spotRaf = null;
    function spotStep() {
      sx += (tx - sx) * 0.12;
      sy += (ty - sy) * 0.12;
      spot.style.setProperty("--mx", sx + "px");
      spot.style.setProperty("--my", sy + "px");
      if (Math.abs(tx - sx) + Math.abs(ty - sy) > 0.5) {
        spotRaf = requestAnimationFrame(spotStep);
      } else {
        spotRaf = null;
      }
    }
    window.addEventListener("pointermove", function (e) {
      tx = e.clientX; ty = e.clientY;
      if (!spotRaf) spotRaf = requestAnimationFrame(spotStep);
    }, { passive: true });
  }

  /* ---------- Interactive strings (hero) ---------- */
  var canvas = document.getElementById("strings");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var hero = canvas.parentElement;

  var STRING_COUNT = 11;
  var POINTS = 90;          // samples per string
  var SPRING = 0.045;       // pull back to rest
  var COUPLING = 0.28;      // neighbor pull (wave propagation)
  var DAMPING = 0.972;
  var MOUSE_RADIUS = 70;    // px influence around cursor
  var MOUSE_PUSH = 1.9;

  // Gradient stops matching the site accents.
  var COLORS = [
    [78, 224, 193],   // teal
    [123, 92, 255],   // violet
    [255, 92, 158]    // magenta
  ];

  var W = 0, H = 0, dpr = 1;
  var strings = [];
  var lastMouse = null;
  var running = false;
  var heroVisible = true;

  /* ---------- Sound: Karplus-Strong plucked strings ---------- */
  // C major pentatonic, two octaves. Index matches string index (top string = highest note).
  var NOTES = [1046.50, 880.00, 783.99, 659.26, 587.33, 523.25, 440.00, 392.00, 329.63, 293.66, 261.63];
  var audioEnabled = false;
  var actx = null, masterOut = null;
  var noteBuffers = [];
  var noteLastPlayed = new Float64Array(NOTES.length);
  var NOTE_COOLDOWN_MS = 90;

  function makePluckBuffer(freq) {
    var sr = actx.sampleRate;
    var dur = 2.2;
    var N = Math.max(2, Math.round(sr / freq));
    var len = Math.floor(sr * dur);
    var data = new Float32Array(len);
    var i;
    for (i = 0; i < N; i++) data[i] = Math.random() * 2 - 1;
    for (i = 1; i < N; i++) data[i] = (data[i] + data[i - 1]) * 0.5; // soften the attack
    for (i = N; i < len; i++) {
      var a = data[i - N];
      var b = i - N - 1 >= 0 ? data[i - N - 1] : 0;
      data[i] = (a + b) * 0.5 * 0.998;
    }
    for (i = len - 2400; i < len; i++) data[i] *= (len - i) / 2400; // fade tail
    var buf = actx.createBuffer(1, len, sr);
    buf.getChannelData(0).set(data);
    return buf;
  }

  function initAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    actx = new AC();
    var comp = actx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    masterOut = actx.createGain();
    masterOut.gain.value = 0.55;
    masterOut.connect(comp);
    comp.connect(actx.destination);
    for (var i = 0; i < NOTES.length; i++) noteBuffers.push(makePluckBuffer(NOTES[i]));
    return true;
  }

  var VEL_CAP = 0.55; // hard strums plateau here instead of getting harsh

  function playNote(si, vel) {
    if (!audioEnabled || !actx || si < 0 || si >= noteBuffers.length) return;
    var now = performance.now();
    if (now - noteLastPlayed[si] < NOTE_COOLDOWN_MS) return;
    noteLastPlayed[si] = now;
    vel = Math.min(Math.max(vel, 0), VEL_CAP);
    var src = actx.createBufferSource();
    src.buffer = noteBuffers[si];
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.004; // organic micro-detune
    var filt = actx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 950 + vel * 2600; // harder strum = fuller, never shrill
    filt.Q.value = 0.4;
    var g = actx.createGain();
    g.gain.value = 0.07 + vel * 0.5;
    src.connect(filt);
    filt.connect(g);
    g.connect(masterOut);
    src.start();
    src.onended = function () { src.disconnect(); filt.disconnect(); g.disconnect(); };
  }

  var soundBtn = document.getElementById("soundToggle");

  function syncToggleUI() {
    if (!soundBtn) return;
    soundBtn.classList.toggle("on", audioEnabled);
    soundBtn.setAttribute("aria-pressed", String(audioEnabled));
    soundBtn.innerHTML = audioEnabled ? "&#9834; Sound on" : "&#9834; Strum with sound";
  }

  function enableAudio() {
    if (!actx && !initAudio()) return false;
    if (actx.state === "suspended") actx.resume();
    audioEnabled = true;
    syncToggleUI();
    return true;
  }

  function playArpeggio() {
    // A soft opening arpeggio, with matching visual plucks.
    [10, 7, 5, 3, 0].forEach(function (si, k) {
      setTimeout(function () {
        playNote(si, 0.35);
        if (strings[si]) { pluck(strings[si], Math.floor(POINTS * 0.5), 16); wake(); }
      }, 110 * k);
    });
  }

  if (soundBtn) {
    if (reducedMotion) {
      soundBtn.style.display = "none";
    } else {
      soundBtn.addEventListener("click", function () {
        if (audioEnabled) {
          audioEnabled = false;
          syncToggleUI();
        } else if (enableAudio()) {
          playArpeggio();
        } else {
          soundBtn.style.display = "none";
        }
      });
    }
  }

  /* ---------- Curtain (enter screen) ---------- */
  var curtain = document.getElementById("curtain");
  var enterSoundBtn = document.getElementById("enterSound");
  var enterQuietBtn = document.getElementById("enterQuiet");

  function liftCurtain() {
    if (!curtain) return;
    curtain.classList.add("lift");
    document.body.classList.remove("no-scroll");
    setTimeout(function () {
      if (curtain.parentNode) curtain.parentNode.removeChild(curtain);
    }, 1000);
  }

  if (curtain && enterSoundBtn && enterQuietBtn) {
    if (reducedMotion || !(window.AudioContext || window.webkitAudioContext)) {
      // No strings to strum (or no audio support): a single plain Enter.
      enterSoundBtn.style.display = "none";
      enterQuietBtn.textContent = "Enter";
      enterQuietBtn.className = "curtain-enter";
    }
    enterSoundBtn.addEventListener("click", function () {
      enableAudio();
      liftCurtain();
      setTimeout(playArpeggio, 450);
    });
    enterQuietBtn.addEventListener("click", liftCurtain);
  }

  function lerpColor(t) {
    var seg = t < 0.5 ? 0 : 1;
    var lt = (t - seg * 0.5) / 0.5;
    var a = COLORS[seg], b = COLORS[seg + 1];
    return [
      Math.round(a[0] + (b[0] - a[0]) * lt),
      Math.round(a[1] + (b[1] - a[1]) * lt),
      Math.round(a[2] + (b[2] - a[2]) * lt)
    ];
  }

  function build() {
    var rect = hero.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width; H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    strings = [];
    // Strings occupy the vertical band of the hero, denser toward the middle.
    var top = H * 0.16, bottom = H * 0.9;
    for (var i = 0; i < STRING_COUNT; i++) {
      var t = i / (STRING_COUNT - 1);
      var col = lerpColor(t);
      strings.push({
        y: top + (bottom - top) * t,
        color: col,
        off: new Float32Array(POINTS),
        vel: new Float32Array(POINTS)
      });
    }
  }

  function pluck(s, idx, force) {
    var i0 = Math.max(1, idx - 2), i1 = Math.min(POINTS - 2, idx + 2);
    for (var i = i0; i <= i1; i++) {
      s.vel[i] += force * (1 - Math.abs(i - idx) / 3);
    }
  }

  // Occasional autonomous pluck so the hero is alive even without a cursor.
  var autoTimer = setInterval(function () {
    if (!strings.length || document.hidden || !heroVisible) return;
    var si = Math.floor(Math.random() * strings.length);
    pluck(strings[si], 6 + Math.floor(Math.random() * (POINTS - 12)), (Math.random() - 0.5) * 26);
    playNote(si, 0.12);
    wake();
  }, 2600);

  function step(now) {
    var t = (now || 0) * 0.001;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    var energy = 0;

    for (var si = 0; si < strings.length; si++) {
      var s = strings[si];
      var off = s.off, vel = s.vel;

      for (var i = 1; i < POINTS - 1; i++) {
        var force = -off[i] * SPRING
          + (off[i - 1] + off[i + 1] - 2 * off[i]) * COUPLING;
        vel[i] = (vel[i] + force) * DAMPING;
      }
      for (i = 1; i < POINTS - 1; i++) {
        off[i] += vel[i];
        var a = Math.abs(vel[i]);
        if (a > energy) energy = a;
      }

      // Ambient traveling wave (draw-time only, keeps the hero alive at rest).
      var phase = si * 0.9;
      var ambAmp = 2.6 + Math.sin(si * 1.7) * 0.8;

      // Draw
      var c = s.color;
      var amp = 0;
      for (i = 0; i < POINTS; i++) { var aa = Math.abs(off[i]); if (aa > amp) amp = aa; }
      var alpha = 0.18 + Math.min(amp / 26, 1) * 0.55;

      var stepX = W / (POINTS - 1);
      function yAt(i) {
        return s.y + off[i]
          + Math.sin(i * 0.11 + t * 0.9 + phase) * ambAmp
          + Math.sin(i * 0.031 - t * 0.45 + phase * 2.1) * ambAmp * 0.7;
      }

      ctx.beginPath();
      ctx.moveTo(0, yAt(0));
      for (i = 1; i < POINTS - 1; i++) {
        var xc = (i * stepX + (i + 1) * stepX) / 2;
        var yc = (yAt(i) + yAt(i + 1)) / 2;
        ctx.quadraticCurveTo(i * stepX, yAt(i), xc, yc);
      }
      ctx.lineTo(W, yAt(POINTS - 1));
      ctx.strokeStyle = "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + alpha.toFixed(3) + ")";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "source-over";

    if (!document.hidden && heroVisible) {
      requestAnimationFrame(step);
    } else {
      running = false;
    }
  }

  function wake() {
    if (!running) {
      running = true;
      requestAnimationFrame(step);
    }
  }

  function onMove(e) {
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    if (my < -40 || my > rect.height + 40) { lastMouse = null; return; }

    var stepX = W / (POINTS - 1);
    for (var si = 0; si < strings.length; si++) {
      var s = strings[si];
      var dy = my - s.y;

      // Strum: the cursor actually crossed this string since the last event.
      if (lastMouse) {
        var prevDy = lastMouse.y - s.y;
        if (prevDy !== 0 && prevDy * dy < 0) {
          var speed = Math.abs(my - lastMouse.y);
          playNote(si, speed / 90);
        }
      }

      if (Math.abs(dy) < MOUSE_RADIUS) {
        var strength = (1 - Math.abs(dy) / MOUSE_RADIUS) * MOUSE_PUSH;
        var idx = Math.round(mx / stepX);
        if (idx > 0 && idx < POINTS - 1) {
          // Push in the direction the cursor travels vertically.
          var dir = lastMouse ? (my - lastMouse.y) : 0;
          var f = dir !== 0 ? Math.max(-1, Math.min(1, dir)) * strength * 8
                            : strength * 5;
          pluck(s, idx, f);
        }
      }
    }
    lastMouse = { x: mx, y: my };
    wake();
  }

  if (!reducedMotion) {
    build();
    // Kick off with a gentle opening chord.
    strings.forEach(function (s, i) {
      setTimeout(function () {
        pluck(s, Math.floor(POINTS * (0.25 + Math.random() * 0.5)), 18);
        wake();
      }, 180 * i);
    });

    window.addEventListener("resize", function () { build(); wake(); }, { passive: true });
    hero.addEventListener("pointermove", onMove, { passive: true });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        heroVisible = entries[0].isIntersecting;
        if (heroVisible) wake();
      }).observe(hero);
    }
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) wake();
    });
  } else {
    clearInterval(autoTimer);
  }
})();
