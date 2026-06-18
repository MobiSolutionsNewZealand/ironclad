(function () {
  'use strict';

  // ── Utilities ──

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function formatTimer(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2000);
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ── Storage ──

  const KEYS = {
    program: 'ironlog:program',
    sessions: 'ironlog:sessions',
    selectedDay: 'ironlog:selectedDay',
    lastExportDate: 'ironlog:lastExportDate'
  };

  function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch { return fallback; }
  }

  function saveJSON(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  // ── Data migration ──

  function migrateProgram(prog) {
    if (!prog || !prog.days) return prog;
    prog.days.forEach(function (day) {
      day.exercises.forEach(function (ex) {
        if (ex.targetRestSeconds == null) ex.targetRestSeconds = 90;
      });
    });
    return prog;
  }

  // ── Seed data ──

  function defaultProgram() {
    return {
      days: [
        {
          id: 'day_mon', name: 'Monday', dayOfWeek: 1,
          exercises: [
            { id: 'ex_wcp', name: 'Warmup Chest Press', targetSets: 2, targetReps: 15, targetRestSeconds: 90, howTo: 'Same setup as Chest Press, but with a light weight focused purely on smooth, full-range reps to warm the shoulders and chest before working sets.' },
            { id: 'ex_cp', name: 'Chest Press', targetSets: 3, targetReps: 15, targetRestSeconds: 90, howTo: 'Sit with back flat against the pad, grips at chest height. Press handles forward until arms extend without locking elbows, then control the return. Keep shoulder blades pinned back throughout.' },
            { id: 'ex_cf', name: 'Chest Fly', targetSets: 3, targetReps: 15, targetRestSeconds: 90, howTo: 'Sit upright, arms slightly bent, palms facing in. Bring handles together in a wide arc in front of your chest, squeezing at the centre, then return slowly under control.' },
            { id: 'ex_sp', name: 'Shoulder Press', targetSets: 3, targetReps: 10, targetRestSeconds: 90, howTo: 'Sit with back supported, grips at shoulder height. Press straight overhead until arms are extended, then lower back to the start without flaring elbows too far forward or back.' },
            { id: 'ex_tpd', name: 'Triceps Push Downs', targetSets: 3, targetReps: 15, targetRestSeconds: 90, howTo: 'Stand facing the cable stack, elbows pinned to your sides. Push the bar/rope down until arms are fully extended, then let it return under control without letting elbows drift forward.' },
            { id: 'ex_rs', name: 'Rear Shoulder', targetSets: 3, targetReps: 10, targetRestSeconds: 90, howTo: 'Sit facing into the pad (or bend forward for a cable version), arms slightly bent. Pull handles back and out to the sides, squeezing shoulder blades together, then return slowly.' },
            { id: 'ex_lr', name: 'Lateral Raises', targetSets: 3, targetReps: 10, targetRestSeconds: 90, howTo: 'Stand with a slight bend in the elbows. Raise arms out to the sides to roughly shoulder height, leading with the elbows, then lower under control. Avoid swinging or shrugging the shoulders up.' }
          ]
        },
        {
          id: 'day_wed', name: 'Wednesday', dayOfWeek: 3,
          exercises: [
            { id: 'ex_lpd', name: 'Lat Pull Downs', targetSets: 4, targetReps: 12, targetRestSeconds: 90, howTo: 'Grip the bar wider than shoulder width, sit with thighs locked under the pad. Pull the bar down to upper chest, driving elbows down and back, then control the return to a full stretch overhead.' },
            { id: 'ex_br', name: 'Barbell Rows', targetSets: 4, targetReps: 10, targetRestSeconds: 90, howTo: 'Hinge at the hips with a flat back, grip the bar just outside shoulder width. Pull the bar up to your lower ribs, squeezing shoulder blades together, then lower with control without rounding the back.' },
            { id: 'ex_sr', name: 'Seated Rows', targetSets: 3, targetReps: 10, targetRestSeconds: 90, howTo: 'Sit with knees slightly bent, grip the handle, back upright. Pull the handle to your stomach, driving elbows back, then extend arms fully forward without letting shoulders round.' },
            { id: 'ex_srm', name: 'Seated Row Machine', targetSets: 3, targetReps: 10, targetRestSeconds: 90, howTo: 'Sit facing the machine, chest against the pad if available. Pull the handles back, leading with elbows, squeeze shoulder blades together, then return slowly to a full stretch.' },
            { id: 'ex_bac', name: 'Bicep Alternating Curls', targetSets: 4, targetReps: 10, targetRestSeconds: 90, howTo: 'Stand or sit with arms hanging at your sides. Curl one dumbbell up toward the shoulder, rotating the palm up as you go, then lower under control before alternating sides.' },
            { id: 'ex_hc', name: 'Hammer Curls', targetSets: 4, targetReps: 10, targetRestSeconds: 90, howTo: 'Same setup as alternating curls, but palms face each other throughout (neutral grip). Curl up, squeeze briefly, then lower slowly.' },
            { id: 'ex_ebc', name: 'Easy Bar Curls', targetSets: 3, targetReps: 10, targetRestSeconds: 90, howTo: 'Grip the EZ-bar at the angled sections, stand with elbows close to your sides. Curl the bar up toward your shoulders without swinging your hips, then lower under control.' }
          ]
        },
        {
          id: 'day_fri', name: 'Friday', dayOfWeek: 5,
          exercises: [
            { id: 'ex_le', name: 'Leg Extensions', targetSets: 5, targetReps: 15, targetRestSeconds: 90, howTo: 'Sit with the pad resting on your shins, back against the seat. Extend your legs until straight (without locking out hard), pause briefly, then lower under control.' },
            { id: 'ex_lc', name: 'Leg Curls', targetSets: 4, targetReps: 15, targetRestSeconds: 90, howTo: 'Pad positioned behind your ankles. Curl your heels toward your glutes, squeeze briefly, then extend back out under control.' },
            { id: 'ex_lp', name: 'Leg Press', targetSets: 4, targetReps: 20, targetRestSeconds: 90, howTo: 'Sit back in the machine with feet shoulder-width on the platform. Lower the platform by bending your knees toward your chest without rounding your lower back, then press back up without locking your knees out hard.' },
            { id: 'ex_ks', name: 'Kettlebell Swings', targetSets: 4, targetReps: 10, targetRestSeconds: 90, howTo: 'Stand with feet shoulder-width apart, kettlebell in front of you. Hinge at the hips to swing the bell back between your legs, then drive through your hips to swing it up to chest height, keeping your back flat throughout.' }
          ]
        }
      ]
    };
  }

  // ── State ──

  let program = loadJSON(KEYS.program, null);
  if (!program) {
    program = defaultProgram();
    saveJSON(KEYS.program, program);
  } else {
    program = migrateProgram(program);
    saveJSON(KEYS.program, program);
  }

  let sessions = loadJSON(KEYS.sessions, []);
  let selectedDayId = localStorage.getItem(KEYS.selectedDay) || null;
  let currentView = 'today';
  let focusExerciseId = null;

  // Timer state per exercise (ephemeral, not persisted)
  const timers = new Map();
  let timerTickId = null;

  function getTimer(exId) {
    if (!timers.has(exId)) {
      timers.set(exId, {
        status: 'idle',
        startTime: null,
        lastStopTime: null,
        restStartTime: null,
        pendingWeight: null,
        pendingReps: null
      });
    }
    return timers.get(exId);
  }

  // Heart rate state
  const hr = { device: null, server: null, characteristic: null, bpm: null, connected: false };

  // ── Confirm dialog ──

  let dialogResolve = null;

  function confirm(title, message, confirmLabel) {
    document.getElementById('dialogTitle').textContent = title;
    document.getElementById('dialogMessage').textContent = message;
    document.getElementById('dialogConfirm').textContent = confirmLabel || 'Delete';
    document.getElementById('dialogOverlay').classList.add('open');
    return new Promise(function (resolve) { dialogResolve = resolve; });
  }

  document.getElementById('dialogCancel').addEventListener('click', function () {
    document.getElementById('dialogOverlay').classList.remove('open');
    if (dialogResolve) dialogResolve(false);
  });

  document.getElementById('dialogConfirm').addEventListener('click', function () {
    document.getElementById('dialogOverlay').classList.remove('open');
    if (dialogResolve) dialogResolve(true);
  });

  document.getElementById('dialogOverlay').addEventListener('click', function (e) {
    if (e.target === e.currentTarget) {
      e.currentTarget.classList.remove('open');
      if (dialogResolve) dialogResolve(false);
    }
  });

  // ── Session helpers ──

  function todayISO() {
    return isoDate(new Date());
  }

  function getSession(dayId, date) {
    return sessions.find(function (s) { return s.dayId === dayId && s.date === date; });
  }

  function getOrCreateSession(dayId, date) {
    var sess = getSession(dayId, date);
    if (!sess) {
      var day = program.days.find(function (d) { return d.id === dayId; });
      sess = {
        id: 'sess_' + uid(),
        dayId: dayId,
        dayName: day ? day.name : 'Unknown',
        date: date,
        entries: []
      };
      sessions.push(sess);
      saveJSON(KEYS.sessions, sessions);
    }
    return sess;
  }

  // Matches by exerciseId — won't link across id changes (e.g. after program import). Intentional trade-off.
  function getLastWeight(exerciseId, excludeDate) {
    for (var i = sessions.length - 1; i >= 0; i--) {
      var s = sessions[i];
      if (excludeDate && s.date === excludeDate) continue;
      for (var j = s.entries.length - 1; j >= 0; j--) {
        if (s.entries[j].exerciseId === exerciseId && s.entries[j].weight != null) {
          return s.entries[j].weight;
        }
      }
    }
    return null;
  }

  function getExerciseEntriesForSession(session, exerciseId) {
    return session.entries.filter(function (e) { return e.exerciseId === exerciseId; });
  }

  // ── Heart rate via Web Bluetooth ──

  function updateHRDisplay() {
    var container = document.getElementById('hrStatus');
    if (hr.connected && hr.bpm != null) {
      container.innerHTML = '<span class="hr-bpm">&hearts; ' + hr.bpm + ' bpm</span>';
    } else if (hr.connected) {
      container.innerHTML = '<span class="hr-bpm">&hearts; --</span>';
    } else {
      container.innerHTML = '<button class="btn-hr-connect" id="btnHRConnect">&#9825; Connect HR</button>';
    }
  }

  function onHRReading(event) {
    var value = event.target.value;
    var flags = value.getUint8(0);
    hr.bpm = (flags & 1) ? value.getUint16(1, true) : value.getUint8(1);
    updateHRDisplay();
  }

  function onHRDisconnect() {
    hr.connected = false;
    hr.bpm = null;
    hr.characteristic = null;
    hr.server = null;
    updateHRDisplay();
    toast('HR monitor disconnected');
  }

  async function connectHR() {
    if (!navigator.bluetooth) {
      toast('Bluetooth not available');
      return;
    }
    try {
      hr.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }]
      });
      hr.device.addEventListener('gattserverdisconnected', onHRDisconnect);
      hr.server = await hr.device.gatt.connect();
      var service = await hr.server.getPrimaryService('heart_rate');
      hr.characteristic = await service.getCharacteristic('heart_rate_measurement');
      await hr.characteristic.startNotifications();
      hr.characteristic.addEventListener('characteristicvaluechanged', onHRReading);
      hr.connected = true;
      updateHRDisplay();
      toast('HR monitor connected');
    } catch (e) {
      if (e.name !== 'NotFoundError') {
        toast('HR connection failed');
      }
    }
  }

  document.getElementById('hrStatus').addEventListener('click', function (e) {
    if (e.target.closest('.btn-hr-connect')) {
      connectHR();
    }
  });

  // ── Timer tick (single interval for all active timers) ──

  function startTimerTick() {
    if (timerTickId) return;
    timerTickId = setInterval(updateTimerDisplays, 200);
  }

  function stopTimerTick() {
    if (!timerTickId) return;
    clearInterval(timerTickId);
    timerTickId = null;
  }

  function updateTimerDisplays() {
    var hasActive = false;
    var now = Date.now();

    timers.forEach(function (state, exId) {
      if (state.status === 'idle') return;
      hasActive = true;

      var displayEl = document.querySelector('[data-timer-display="' + exId + '"]');
      if (!displayEl) return;

      if (state.status === 'active') {
        var elapsed = Math.floor((now - state.startTime) / 1000);
        displayEl.textContent = formatTimer(elapsed);
      } else if (state.status === 'resting') {
        var restElapsed = Math.floor((now - state.restStartTime) / 1000);
        displayEl.textContent = formatTimer(restElapsed);

        var barEl = document.querySelector('[data-rest-bar="' + exId + '"]');
        var btnEl = document.querySelector('[data-timer-btn="' + exId + '"]');
        if (barEl) {
          var day = program.days.find(function (d) { return d.id === selectedDayId; });
          var ex = day && day.exercises.find(function (e) { return e.id === exId; });
          var target = (ex && ex.targetRestSeconds) || 90;
          var pct = Math.min(100, (restElapsed / target) * 100);
          barEl.style.width = pct + '%';
          var met = restElapsed >= target;
          barEl.classList.toggle('target-met', met);
          if (btnEl) btnEl.classList.toggle('target-met', met);
        }
      }
    });

    if (!hasActive) stopTimerTick();
  }

  // ── Timer state machine ──

  function handleTimerToggle(exId) {
    var timer = getTimer(exId);
    var now = Date.now();

    if (timer.status === 'idle' || timer.status === 'resting') {
      // Capture current input values before re-render
      var card = views.today.querySelector('[data-ex-id="' + exId + '"]');
      if (card) {
        var wIn = card.querySelector('input[data-field="weight"][data-ex="' + exId + '"]');
        var rIn = card.querySelector('input[data-field="reps"][data-ex="' + exId + '"]');
        if (wIn) timer.pendingWeight = parseFloat(wIn.value) || 0;
        if (rIn) timer.pendingReps = parseInt(rIn.value) || 0;
      }
      // Start a new set
      timer.status = 'active';
      timer.startTime = now;
      startTimerTick();
      renderToday();
    } else if (timer.status === 'active') {
      // Stop — log the set, enter resting
      var durationMs = now - timer.startTime;
      var durationSeconds = Math.round(durationMs / 1000);
      var restBeforeSeconds = timer.lastStopTime
        ? Math.round((timer.startTime - timer.lastStopTime) / 1000)
        : null;

      timer.lastStopTime = now;
      timer.restStartTime = now;
      timer.status = 'resting';
      timer.pendingWeight = null;
      timer.pendingReps = null;

      logSet(exId, durationSeconds, restBeforeSeconds);
      startTimerTick();
    }
  }

  // ── Navigation ──

  var tabs = document.querySelectorAll('.tab-btn');
  var views = {
    today: document.getElementById('viewToday'),
    history: document.getElementById('viewHistory'),
    program: document.getElementById('viewProgram')
  };

  function switchView(name) {
    currentView = name;
    tabs.forEach(function (t) { t.classList.toggle('active', t.dataset.view === name); });
    Object.keys(views).forEach(function (k) { views[k].classList.toggle('active', k === name); });
    document.querySelector('.day-chips').style.display = name === 'today' ? '' : 'none';

    if (name === 'today') renderToday();
    else if (name === 'history') renderHistory();
    else if (name === 'program') renderProgram();
  }

  tabs.forEach(function (t) { t.addEventListener('click', function () { switchView(t.dataset.view); }); });

  // ── Header date ──

  function updateHeaderDate() {
    document.getElementById('headerDate').textContent = formatDate(todayISO());
  }

  // ── Day chips ──

  function autoSelectDay() {
    var dow = new Date().getDay();
    var matchByDow = program.days.find(function (d) { return d.dayOfWeek === dow; });
    if (matchByDow) return matchByDow.id;
    if (selectedDayId && program.days.find(function (d) { return d.id === selectedDayId; })) return selectedDayId;
    return program.days.length > 0 ? program.days[0].id : null;
  }

  function renderDayChips() {
    var container = document.getElementById('dayChips');
    var todayDow = new Date().getDay();
    container.innerHTML = '';

    program.days.forEach(function (day) {
      var chip = document.createElement('button');
      chip.className = 'day-chip' + (day.id === selectedDayId ? ' active' : '');

      var html = day.name;
      if (day.dayOfWeek === todayDow) {
        html += '<span class="today-dot"></span>';
      }
      chip.innerHTML = html;

      chip.addEventListener('click', function () {
        selectedDayId = day.id;
        localStorage.setItem(KEYS.selectedDay, selectedDayId);
        focusExerciseId = null;
        renderDayChips();
        renderToday();
      });
      container.appendChild(chip);
    });
  }

  // ── Today view (hybrid focus mode) ──

  function getFirstIncompleteExId(day, session) {
    for (var i = 0; i < day.exercises.length; i++) {
      var ex = day.exercises[i];
      var logged = session ? getExerciseEntriesForSession(session, ex.id) : [];
      if (logged.length < ex.targetSets) return ex.id;
    }
    return day.exercises[0] ? day.exercises[0].id : null;
  }

  function renderToday() {
    var container = views.today;
    var day = program.days.find(function (d) { return d.id === selectedDayId; });

    if (!day || day.exercises.length === 0) {
      container.innerHTML =
        '<div class="empty-state">' +
        '<p>' + (day ? 'No exercises for this day yet.' : 'No program day selected.') + '</p>' +
        '<button class="btn-link" onclick="document.querySelector(\'[data-view=program]\').click()">' +
        'Set up your program</button></div>';
      return;
    }

    var date = todayISO();
    var session = getSession(day.id, date);

    if (!focusExerciseId || !day.exercises.find(function (e) { return e.id === focusExerciseId; })) {
      focusExerciseId = getFirstIncompleteExId(day, session);
    }

    var html = '';

    day.exercises.forEach(function (ex) {
      var logged = session ? getExerciseEntriesForSession(session, ex.id) : [];
      var filledCount = logged.length;
      var isDone = filledCount >= ex.targetSets;

      if (ex.id === focusExerciseId) {
        html += renderExpandedCard(ex, logged, isDone, date, session);
      } else {
        html += renderStripItem(ex, logged, isDone);
      }
    });

    container.innerHTML = html;
  }

  function renderExpandedCard(ex, logged, isDone, date, session) {
    var filledCount = logged.length;
    var lastWeight = getLastWeight(ex.id, date);
    var currentWeight = logged.length > 0
      ? logged[logged.length - 1].weight
      : (lastWeight != null ? lastWeight : 0);
    var currentReps = logged.length > 0
      ? logged[logged.length - 1].reps
      : ex.targetReps;

    var timer = getTimer(ex.id);
    if (timer.pendingWeight != null && (timer.status === 'active' || timer.status === 'resting')) {
      currentWeight = timer.pendingWeight;
    }
    if (timer.pendingReps != null && (timer.status === 'active' || timer.status === 'resting')) {
      currentReps = timer.pendingReps;
    }
    var h = '';

    h += '<div class="exercise-card' + (isDone ? ' done' : '') + '" data-ex-id="' + ex.id + '">';

    // Header
    h += '<div class="exercise-card-header">';
    h += '<span class="exercise-name">' + esc(ex.name) + '</span>';
    h += '<span class="exercise-target">' + ex.targetReps + ' &times; ' + ex.targetSets + '</span>';
    h += '</div>';

    if (ex.howTo) {
      var ytQuery = encodeURIComponent(ex.name + ' proper form');
      h += '<details class="howto-disclosure">';
      h += '<summary class="howto-toggle">ⓘ How to</summary>';
      h += '<div class="howto-body">' + esc(ex.howTo) + '</div>';
      h += '<a class="howto-demo-link" href="https://www.youtube.com/results?search_query=' + ytQuery + '" target="_blank" rel="noopener">Search a demo &rarr;</a>';
      h += '</details>';
    }

    if (lastWeight != null) {
      h += '<div class="exercise-last">last: ' + lastWeight + 'kg</div>';
    }

    // Set dots
    var totalDots = Math.max(ex.targetSets, filledCount);
    h += '<div class="set-dots">';
    for (var i = 0; i < totalDots; i++) {
      h += '<div class="set-dot' + (i < filledCount ? ' filled' : '') + '"></div>';
    }
    h += '</div>';

    // Timer area
    if (timer.status === 'active') {
      var elapsed = Math.floor((Date.now() - timer.startTime) / 1000);
      h += '<div class="timer-area">';
      h += '<div class="timer-label active">Set</div>';
      h += '<div class="timer-display" data-timer-display="' + ex.id + '">' + formatTimer(elapsed) + '</div>';
      h += '</div>';
    } else if (timer.status === 'resting') {
      var restElapsed = Math.floor((Date.now() - timer.restStartTime) / 1000);
      var target = ex.targetRestSeconds || 90;
      var pct = Math.min(100, (restElapsed / target) * 100);
      var met = restElapsed >= target;
      h += '<div class="timer-area">';
      h += '<div class="timer-label resting">Rest</div>';
      h += '<div class="timer-display" data-timer-display="' + ex.id + '">' + formatTimer(restElapsed) + '</div>';
      h += '<div class="rest-bar"><div class="rest-bar-fill' + (met ? ' target-met' : '') + '" data-rest-bar="' + ex.id + '" style="width:' + pct + '%"></div></div>';
      h += '</div>';
    }

    // Steppers
    h += '<div class="stepper-row">';
    h += '<div class="stepper-group"><div class="stepper-label">Weight</div>';
    h += '<div class="stepper">';
    h += '<button class="stepper-btn" data-action="weight-dec" data-ex="' + ex.id + '">&minus;</button>';
    h += '<input type="number" class="stepper-value" data-field="weight" data-ex="' + ex.id + '" value="' + currentWeight + '" step="2.5" min="0" inputmode="decimal">';
    h += '<span class="stepper-unit">kg</span>';
    h += '<button class="stepper-btn" data-action="weight-inc" data-ex="' + ex.id + '">&plus;</button>';
    h += '</div></div>';

    h += '<div class="stepper-group"><div class="stepper-label">Reps</div>';
    h += '<div class="stepper">';
    h += '<button class="stepper-btn" data-action="reps-dec" data-ex="' + ex.id + '">&minus;</button>';
    h += '<input type="number" class="stepper-value" data-field="reps" data-ex="' + ex.id + '" value="' + currentReps + '" step="1" min="0" inputmode="numeric">';
    h += '<button class="stepper-btn" data-action="reps-inc" data-ex="' + ex.id + '">&plus;</button>';
    h += '</div></div>';
    h += '</div>';

    // RPE
    h += '<div class="rpe-row"><div class="stepper-label">RPE</div>';
    h += '<div class="rpe-chips">';
    for (var r = 1; r <= 10; r++) {
      h += '<button class="rpe-chip" data-rpe="' + r + '" data-ex="' + ex.id + '">' + r + '</button>';
    }
    h += '</div></div>';

    // Notes
    h += '<input type="text" class="notes-input" data-field="notes" data-ex="' + ex.id + '" placeholder="optional note">';

    // Timer button
    var btnClass, btnLabel;
    if (timer.status === 'active') {
      btnClass = 'active';
      btnLabel = 'Stop';
    } else if (timer.status === 'resting') {
      var restNow = Math.floor((Date.now() - timer.restStartTime) / 1000);
      var targetMet = restNow >= (ex.targetRestSeconds || 90);
      btnClass = 'resting' + (targetMet ? ' target-met' : '');
      btnLabel = 'Start';
    } else {
      btnClass = 'idle';
      btnLabel = 'Start';
    }
    h += '<button class="btn-timer ' + btnClass + '" data-action="timer-toggle" data-ex="' + ex.id + '" data-timer-btn="' + ex.id + '">' + btnLabel + '</button>';

    // Logged sets
    if (logged.length > 0) {
      h += '<div class="logged-sets">';
      logged.forEach(function (entry, idx) {
        var text = 'Set ' + (idx + 1) + ' — <span>' + entry.weight + 'kg &times;' + entry.reps + '</span>';
        if (entry.rpe) text += ' @' + entry.rpe;
        if (entry.durationSeconds) text += ' ' + formatTimer(entry.durationSeconds);
        if (entry.heartRate) text += ' &hearts;' + entry.heartRate;
        if (entry.notes) text += ' — ' + esc(entry.notes);
        h += '<div class="logged-set">';
        h += '<div class="logged-set-text">' + text + '</div>';
        h += '<button class="btn-delete-set" data-action="delete-set" data-ex="' + ex.id + '" data-idx="' + idx + '">&times;</button>';
        h += '</div>';
      });
      h += '</div>';
    }

    h += '</div>';
    return h;
  }

  function renderStripItem(ex, logged, isDone) {
    var filledCount = logged.length;
    var totalDots = ex.targetSets;

    var h = '<div class="strip-item' + (isDone ? ' done' : '') + '" data-action="focus-exercise" data-ex-id="' + ex.id + '">';
    h += '<div class="strip-item-info">';
    h += '<span class="strip-item-name">' + esc(ex.name) + '</span>';
    h += '<span class="strip-item-target">' + ex.targetReps + ' &times; ' + ex.targetSets + '</span>';
    h += '</div>';

    h += '<div class="set-dots">';
    for (var i = 0; i < totalDots; i++) {
      h += '<div class="set-dot mini' + (i < filledCount ? ' filled' : '') + '"></div>';
    }
    h += '</div>';

    if (isDone) {
      h += '<span class="strip-item-check">&#10003;</span>';
    }

    h += '</div>';
    return h;
  }

  // ── Today view event handlers ──

  function handleTodayClick(e) {
    // Strip item tap → focus
    var strip = e.target.closest('[data-action="focus-exercise"]');
    if (strip) {
      focusExerciseId = strip.dataset.exId;
      renderToday();
      return;
    }

    // RPE chip
    var chip = e.target.closest('.rpe-chip');
    if (chip) {
      var chipExId = chip.dataset.ex;
      var card = chip.closest('.exercise-card');
      card.querySelectorAll('.rpe-chip[data-ex="' + chipExId + '"]').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      return;
    }

    var btn = e.target.closest('[data-action]');
    if (!btn) return;

    var action = btn.dataset.action;
    var exId = btn.dataset.ex;
    var cardEl = btn.closest('.exercise-card');

    if (action === 'weight-dec' || action === 'weight-inc') {
      var wInput = cardEl.querySelector('input[data-field="weight"][data-ex="' + exId + '"]');
      var wVal = parseFloat(wInput.value) || 0;
      wVal = action === 'weight-inc' ? wVal + 2.5 : Math.max(0, wVal - 2.5);
      wInput.value = wVal;
    }

    if (action === 'reps-dec' || action === 'reps-inc') {
      var rInput = cardEl.querySelector('input[data-field="reps"][data-ex="' + exId + '"]');
      var rVal = parseInt(rInput.value) || 0;
      rVal = action === 'reps-inc' ? rVal + 1 : Math.max(0, rVal - 1);
      rInput.value = rVal;
    }

    if (action === 'timer-toggle') {
      handleTimerToggle(exId);
    }

    if (action === 'delete-set') {
      deleteSet(exId, parseInt(btn.dataset.idx));
    }
  }

  views.today.addEventListener('click', handleTodayClick);

  function logSet(exId, durationSeconds, restBeforeSeconds) {
    var day = program.days.find(function (d) { return d.id === selectedDayId; });
    if (!day) return;
    var ex = day.exercises.find(function (e) { return e.id === exId; });
    if (!ex) return;

    var card = views.today.querySelector('[data-ex-id="' + exId + '"]');
    if (!card) return;

    var weight = parseFloat(card.querySelector('input[data-field="weight"][data-ex="' + exId + '"]').value) || 0;
    var reps = parseInt(card.querySelector('input[data-field="reps"][data-ex="' + exId + '"]').value) || 0;
    var notesInput = card.querySelector('input[data-field="notes"][data-ex="' + exId + '"]');
    var notes = notesInput.value.trim();

    var activeRpe = card.querySelector('.rpe-chip.active[data-ex="' + exId + '"]');
    var rpe = activeRpe ? parseInt(activeRpe.dataset.rpe) : null;

    var sess = getOrCreateSession(selectedDayId, todayISO());
    sess.entries.push({
      exerciseId: exId,
      exerciseName: ex.name,
      weight: weight,
      reps: reps,
      rpe: rpe,
      notes: notes || '',
      time: new Date().toISOString(),
      durationSeconds: durationSeconds || null,
      restBeforeSeconds: restBeforeSeconds,
      heartRate: hr.connected ? hr.bpm : null
    });
    saveJSON(KEYS.sessions, sessions);

    // Check for auto-advance
    var logged = getExerciseEntriesForSession(sess, exId);
    if (logged.length >= ex.targetSets) {
      var nextId = getFirstIncompleteExId(day, sess);
      if (nextId && nextId !== exId) {
        focusExerciseId = nextId;
      }
    }

    renderToday();

    // Animate the newly filled dot
    requestAnimationFrame(function () {
      var newCard = views.today.querySelector('[data-ex-id="' + exId + '"]');
      if (newCard) {
        var dots = newCard.querySelectorAll('.set-dot.filled');
        var lastDot = dots[dots.length - 1];
        if (lastDot) {
          lastDot.classList.add('pop');
          lastDot.addEventListener('animationend', function () { lastDot.classList.remove('pop'); }, { once: true });
        }
      }
    });
  }

  function deleteSet(exId, idx) {
    var session = getSession(selectedDayId, todayISO());
    if (!session) return;

    var exEntries = session.entries.filter(function (e) { return e.exerciseId === exId; });
    if (idx >= exEntries.length) return;

    var entryToRemove = exEntries[idx];
    var globalIdx = session.entries.indexOf(entryToRemove);
    if (globalIdx !== -1) {
      session.entries.splice(globalIdx, 1);
      if (session.entries.length === 0) {
        sessions.splice(sessions.indexOf(session), 1);
      }
      saveJSON(KEYS.sessions, sessions);
    }
    renderToday();
  }

  // ── History view ──

  function renderHistory() {
    var container = views.history;
    var html = '';

    var exerciseMap = new Map();
    sessions.forEach(function (s) {
      s.entries.forEach(function (e) {
        if (!exerciseMap.has(e.exerciseId)) {
          exerciseMap.set(e.exerciseId, { name: e.exerciseName, sessions: new Map() });
        }
        var exData = exerciseMap.get(e.exerciseId);
        exData.name = e.exerciseName;
        if (!exData.sessions.has(s.date)) exData.sessions.set(s.date, []);
        exData.sessions.get(s.date).push(e);
      });
    });

    if (exerciseMap.size > 0) {
      html += '<div class="history-section">';
      exerciseMap.forEach(function (data) {
        var dates = Array.from(data.sessions.keys()).sort();
        var topWeights = dates.map(function (d) {
          var entries = data.sessions.get(d);
          return Math.max.apply(null, entries.map(function (e) { return e.weight || 0; }));
        });

        var best = Math.max.apply(null, topWeights);
        var latest = topWeights[topWeights.length - 1];
        var prev = topWeights.length >= 2 ? topWeights[topWeights.length - 2] : latest;
        var trendClass = 'trend-flat';
        var trendSymbol = '—';
        if (latest > prev) { trendClass = 'trend-up'; trendSymbol = '▲'; }
        else if (latest < prev) { trendClass = 'trend-down'; trendSymbol = '▼'; }

        var sparkSvg = buildSparkline(topWeights);

        html += '<div class="history-exercise-card">';
        html += '<div class="history-exercise-name">' + esc(data.name) + '</div>';
        html += '<div class="sparkline-row">' + sparkSvg + '</div>';
        html += '<div class="history-stats">';
        html += '<span>Best: <span class="value">' + best + 'kg</span></span>';
        html += '<span>Latest: <span class="value">' + latest + 'kg</span></span>';
        html += '<span>Trend: <span class="' + trendClass + '">' + trendSymbol + '</span></span>';
        html += '</div></div>';
      });
      html += '</div>';
    }

    var sorted = sessions.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    if (sorted.length > 0) {
      html += '<div class="history-sessions-title">Sessions</div>';
      sorted.forEach(function (s) {
        var volume = s.entries.reduce(function (sum, e) { return sum + (e.weight || 0) * (e.reps || 0); }, 0);
        html += '<div class="session-card" data-sess-id="' + s.id + '">';
        html += '<div class="session-header">';
        html += '<div class="session-info">';
        html += '<span class="session-day-name">' + esc(s.dayName) + '</span>';
        html += '<span class="session-date">' + formatDate(s.date) + '</span>';
        html += '</div>';
        html += '<span class="session-volume">' + volume.toLocaleString() + 'kg vol</span>';
        html += '<span class="session-chevron">▶</span>';
        html += '</div>';
        html += '<div class="session-detail">';
        s.entries.forEach(function (e) {
          var detail = e.weight + 'kg × ' + e.reps;
          if (e.rpe) detail += ' @' + e.rpe;
          if (e.durationSeconds) detail += ' ' + formatTimer(e.durationSeconds);
          if (e.heartRate) detail += ' ♡' + e.heartRate;
          if (e.notes) detail += ' — ' + esc(e.notes);
          html += '<div class="session-entry">';
          html += '<span class="session-entry-name">' + esc(e.exerciseName) + '</span>';
          html += '<span>' + detail + '</span>';
          html += '</div>';
        });
        html += '</div></div>';
      });
    }

    if (!html) {
      html = '<div class="empty-state"><p>No sessions logged yet. Go crush a workout!</p></div>';
    }

    container.innerHTML = html;

    container.querySelectorAll('.session-header').forEach(function (hdr) {
      hdr.addEventListener('click', function () {
        hdr.closest('.session-card').classList.toggle('expanded');
      });
    });
  }

  function buildSparkline(values) {
    if (values.length < 2) {
      return '<svg viewBox="0 0 100 32" preserveAspectRatio="none"><line x1="0" y1="16" x2="100" y2="16" stroke="#3F3B38" stroke-width="1.5"/></svg>';
    }

    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var range = max - min || 1;
    var w = 100, h = 32, pad = 2;

    var points = values.map(function (v, i) {
      var x = (i / (values.length - 1)) * w;
      var y = pad + ((1 - (v - min) / range) * (h - pad * 2));
      return x.toFixed(1) + ',' + y.toFixed(1);
    });

    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      '<polyline points="' + points.join(' ') + '" fill="none" stroke="#C1622B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  // ── Program view ──

  var SETS_PRESETS = [1, 2, 3, 4, 5, 6, 8];
  var REPS_PRESETS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30];
  var REST_PRESETS = [
    { value: 30, label: '30 sec' }, { value: 45, label: '45 sec' },
    { value: 60, label: '60 sec' }, { value: 90, label: '90 sec' },
    { value: 120, label: '2 min' }, { value: 180, label: '3 min' },
    { value: 300, label: '5 min' }
  ];

  var customFields = new Set();

  function buildNumericSelect(presets, current, action, dayId, exId) {
    var inPreset = presets.indexOf(current) !== -1;
    var isCustom = !inPreset || customFields.has(exId + ':' + action);
    var h = '<div class="program-ex-field">';
    h += '<select class="program-ex-select" data-action="' + action + '" data-day="' + dayId + '" data-ex="' + exId + '">';
    presets.forEach(function (v) {
      h += '<option value="' + v + '"' + (v === current && !isCustom ? ' selected' : '') + '>' + v + '</option>';
    });
    h += '<option value="custom"' + (isCustom ? ' selected' : '') + '>Custom…</option>';
    h += '</select>';
    if (isCustom) {
      h += '<input type="number" class="program-ex-custom" data-action="' + action + '-custom" data-day="' + dayId + '" data-ex="' + exId + '" value="' + current + '" inputmode="numeric" min="1">';
    }
    h += '</div>';
    return h;
  }

  function buildRestSelect(current, dayId, exId) {
    var inPreset = REST_PRESETS.some(function (p) { return p.value === current; });
    var isCustom = !inPreset || customFields.has(exId + ':change-rest');
    var h = '<div class="program-ex-field">';
    h += '<select class="program-ex-select" data-action="change-rest" data-day="' + dayId + '" data-ex="' + exId + '">';
    REST_PRESETS.forEach(function (p) {
      h += '<option value="' + p.value + '"' + (p.value === current && !isCustom ? ' selected' : '') + '>' + p.label + '</option>';
    });
    h += '<option value="custom"' + (isCustom ? ' selected' : '') + '>Custom…</option>';
    h += '</select>';
    if (isCustom) {
      h += '<input type="number" class="program-ex-custom" data-action="change-rest-custom" data-day="' + dayId + '" data-ex="' + exId + '" value="' + current + '" inputmode="numeric" min="0">';
    }
    h += '</div>';
    return h;
  }

  function renderProgram() {
    var container = views.program;
    var dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var html = '';

    program.days.forEach(function (day) {
      html += '<div class="program-day" data-day-id="' + day.id + '">';
      html += '<div class="program-day-header">';
      html += '<input type="text" class="program-day-name" value="' + esc(day.name) + '" data-action="rename-day" data-day="' + day.id + '">';

      html += '<select class="program-dow-select" data-action="change-dow" data-day="' + day.id + '">';
      html += '<option value="-1"' + (day.dayOfWeek == null ? ' selected' : '') + '>None</option>';
      for (var i = 0; i < 7; i++) {
        html += '<option value="' + i + '"' + (day.dayOfWeek === i ? ' selected' : '') + '>' + dowNames[i] + '</option>';
      }
      html += '</select>';

      html += '<button class="btn-delete-day" data-action="delete-day" data-day="' + day.id + '">&times;</button>';
      html += '</div>';

      if (day.exercises.length > 0) {
        html += '<div class="program-ex-col-headers"><span>Sets</span><span>Reps</span><span>Rest</span></div>';
      }

      day.exercises.forEach(function (ex) {
        html += '<div class="program-exercise" data-ex-id="' + ex.id + '">';
        html += '<div class="program-ex-line1">';
        html += '<input type="text" class="program-ex-name" value="' + esc(ex.name) + '" data-action="rename-ex" data-day="' + day.id + '" data-ex="' + ex.id + '">';
        html += '<button class="btn-delete-ex" data-action="delete-ex" data-day="' + day.id + '" data-ex="' + ex.id + '">&times;</button>';
        html += '</div>';
        html += '<div class="program-ex-line2">';
        html += buildNumericSelect(SETS_PRESETS, ex.targetSets, 'change-sets', day.id, ex.id);
        html += buildNumericSelect(REPS_PRESETS, ex.targetReps, 'change-reps', day.id, ex.id);
        html += buildRestSelect(ex.targetRestSeconds || 90, day.id, ex.id);
        html += '</div>';
        html += '<details class="program-howto-details">';
        html += '<summary class="program-howto-toggle">' + (ex.howTo ? 'Edit how-to notes' : '+ Add how-to notes') + '</summary>';
        html += '<textarea class="program-howto-textarea" data-action="change-howto" data-day="' + day.id + '" data-ex="' + ex.id + '" rows="3" placeholder="Form cues, setup notes...">' + esc(ex.howTo || '') + '</textarea>';
        html += '</details>';
        html += '</div>';
      });

      html += '<button class="btn-add-exercise" data-action="add-ex" data-day="' + day.id + '">+ Add Exercise</button>';
      html += '</div>';
    });

    html += '<button class="btn-add-day" data-action="add-day">+ Add Day</button>';

    if (shouldShowBackupReminder()) {
      html += '<div class="backup-reminder" id="backupReminder">';
      html += '<span>Haven\'t backed up in a while — export your data?</span>';
      html += '<div class="backup-reminder-actions">';
      html += '<button class="btn-action" data-action="export" style="flex:1">Export Now</button>';
      html += '<button class="btn-reminder-dismiss" data-action="dismiss-reminder">&times;</button>';
      html += '</div></div>';
    }

    html += '<div class="data-actions">';
    html += '<button class="btn-action" data-action="share-program">Share Program</button>';
    html += '<button class="btn-action" data-action="import-program">Import Program</button>';
    html += '<button class="btn-action" data-action="export">Export All Data</button>';
    html += '<button class="btn-action" data-action="import">Import All Data</button>';
    html += '<button class="btn-action danger" data-action="clear-all">Clear All Data</button>';
    html += '</div>';

    container.innerHTML = html;

    container.removeEventListener('click', handleProgramClick);
    container.addEventListener('click', handleProgramClick);
    container.removeEventListener('change', handleProgramChange);
    container.addEventListener('change', handleProgramChange);
    container.removeEventListener('input', handleProgramChange);
    container.addEventListener('input', handleProgramChange);
  }

  function handleProgramClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;

    if (action === 'add-day') {
      program.days.push({
        id: 'day_' + uid(),
        name: 'New Day',
        dayOfWeek: null,
        exercises: []
      });
      saveAndRenderProgram();
    }

    if (action === 'delete-day') {
      confirm('Delete Day', 'Remove this day and all its exercises from your program?').then(function (ok) {
        if (!ok) return;
        program.days = program.days.filter(function (d) { return d.id !== btn.dataset.day; });
        saveAndRenderProgram();
        if (selectedDayId === btn.dataset.day) {
          selectedDayId = program.days.length > 0 ? program.days[0].id : null;
          localStorage.setItem(KEYS.selectedDay, selectedDayId || '');
          renderDayChips();
        }
      });
    }

    if (action === 'add-ex') {
      var day = program.days.find(function (d) { return d.id === btn.dataset.day; });
      if (day) {
        day.exercises.push({
          id: 'ex_' + uid(),
          name: 'New Exercise',
          targetSets: 3,
          targetReps: 10,
          targetRestSeconds: 90
        });
        saveAndRenderProgram();
      }
    }

    if (action === 'delete-ex') {
      confirm('Delete Exercise', 'Remove this exercise from this day?').then(function (ok) {
        if (!ok) return;
        var day2 = program.days.find(function (d) { return d.id === btn.dataset.day; });
        if (day2) {
          day2.exercises = day2.exercises.filter(function (ex) { return ex.id !== btn.dataset.ex; });
          saveAndRenderProgram();
        }
      });
    }

    if (action === 'dismiss-reminder') {
      reminderDismissed = true;
      var rem = document.getElementById('backupReminder');
      if (rem) rem.remove();
      return;
    }

    if (action === 'share-program') { shareProgram(); return; }
    if (action === 'import-program') { document.getElementById('importProgramInput').click(); return; }
    if (action === 'export') { exportData(); return; }
    if (action === 'import') { document.getElementById('importInput').click(); return; }
    if (action === 'clear-all') {
      confirm('Clear All Data', 'This will delete your entire program and all session history. This cannot be undone.', 'Clear All').then(function (ok) {
        if (!ok) return;
        localStorage.removeItem(KEYS.program);
        localStorage.removeItem(KEYS.sessions);
        localStorage.removeItem(KEYS.selectedDay);
        program = defaultProgram();
        saveJSON(KEYS.program, program);
        sessions = [];
        saveJSON(KEYS.sessions, sessions);
        selectedDayId = autoSelectDay();
        localStorage.setItem(KEYS.selectedDay, selectedDayId || '');
        focusExerciseId = null;
        timers.clear();
        stopTimerTick();
        renderDayChips();
        renderProgram();
        toast('Data cleared, defaults restored');
      });
    }
  }

  function findExercise(dayId, exId) {
    var day = program.days.find(function (d) { return d.id === dayId; });
    if (!day) return null;
    var ex = day.exercises.find(function (x) { return x.id === exId; });
    return ex || null;
  }

  function handleProgramChange(e) {
    var el = e.target;
    var action = el.dataset.action;
    if (!action) return;

    if (action === 'rename-day') {
      var day = program.days.find(function (d) { return d.id === el.dataset.day; });
      if (day) { day.name = el.value.trim() || day.name; saveAndRenderProgram(); }
      return;
    }

    if (action === 'change-dow') {
      var day2 = program.days.find(function (d) { return d.id === el.dataset.day; });
      if (day2) {
        var v = parseInt(el.value);
        day2.dayOfWeek = v === -1 ? null : v;
        saveAndRenderProgram();
      }
      return;
    }

    if (action === 'rename-ex') {
      var ex = findExercise(el.dataset.day, el.dataset.ex);
      if (ex) { ex.name = el.value.trim() || ex.name; saveProgram(); }
      return;
    }

    if (action === 'change-howto') {
      var exH = findExercise(el.dataset.day, el.dataset.ex);
      if (exH) { exH.howTo = el.value; saveProgram(); }
      return;
    }

    // Dropdown selects (sets/reps/rest)
    if (action === 'change-sets' || action === 'change-reps' || action === 'change-rest') {
      var key = el.dataset.ex + ':' + action;
      if (el.value === 'custom') {
        customFields.add(key);
        renderProgram();
        var customInput = views.program.querySelector('input[data-action="' + action + '-custom"][data-ex="' + el.dataset.ex + '"]');
        if (customInput) customInput.focus();
      } else {
        customFields.delete(key);
        var ex2 = findExercise(el.dataset.day, el.dataset.ex);
        if (ex2) {
          var val = parseInt(el.value);
          if (action === 'change-sets') ex2.targetSets = Math.max(1, val || 1);
          else if (action === 'change-reps') ex2.targetReps = Math.max(1, val || 1);
          else ex2.targetRestSeconds = Math.max(0, val || 0);
          saveProgram();
          renderProgram();
        }
      }
      return;
    }

    // Custom number inputs
    if (action === 'change-sets-custom' || action === 'change-reps-custom' || action === 'change-rest-custom') {
      var ex3 = findExercise(el.dataset.day, el.dataset.ex);
      if (ex3) {
        var cval = parseInt(el.value);
        if (action === 'change-sets-custom') ex3.targetSets = Math.max(1, cval || 1);
        else if (action === 'change-reps-custom') ex3.targetReps = Math.max(1, cval || 1);
        else ex3.targetRestSeconds = Math.max(0, cval || 0);
        saveProgram();
      }
      return;
    }
  }

  function saveProgram() {
    saveJSON(KEYS.program, program);
  }

  function saveAndRenderProgram() {
    saveProgram();
    renderProgram();
    renderDayChips();
  }

  // ── Import / Export ──

  var reminderDismissed = false;

  function markExported() {
    localStorage.setItem(KEYS.lastExportDate, todayISO());
  }

  function shouldShowBackupReminder() {
    if (reminderDismissed) return false;
    var last = localStorage.getItem(KEYS.lastExportDate);
    if (!last) return true;
    var diff = (new Date() - new Date(last + 'T00:00:00')) / (1000 * 60 * 60 * 24);
    return diff >= 14;
  }

  function exportData() {
    var data = {
      ironclad: true,
      ironlog: true,
      version: 2,
      exportedAt: new Date().toISOString(),
      program: program,
      sessions: sessions
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'ironclad-backup-' + todayISO() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    markExported();
    toast('Data exported');
  }

  function shareProgram() {
    var data = {
      ironclad: true,
      type: 'program',
      version: 2,
      exportedAt: new Date().toISOString(),
      program: program
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'ironclad-program-' + todayISO() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    markExported();
    toast('Program shared');
  }

  function importProgramFromFile(file) {
    var reader = new FileReader();
    reader.onload = function (evt) {
      try {
        var data = JSON.parse(evt.target.result);

        var prog = data.program || data;
        if (!prog.days || !Array.isArray(prog.days)) throw new Error('No valid program found');
        for (var i = 0; i < prog.days.length; i++) {
          if (!prog.days[i].exercises || !Array.isArray(prog.days[i].exercises)) {
            throw new Error('Invalid day structure');
          }
        }

        confirm(
          'Import Program',
          'This replaces your current program (days & exercises). Your logged history is not affected.',
          'Replace Program'
        ).then(function (ok) {
          if (!ok) return;
          var newProg = { days: [] };
          prog.days.forEach(function (day) {
            var newDay = {
              id: 'day_' + uid(),
              name: day.name || 'Imported Day',
              dayOfWeek: day.dayOfWeek != null ? day.dayOfWeek : null,
              exercises: []
            };
            (day.exercises || []).forEach(function (ex) {
              newDay.exercises.push({
                id: 'ex_' + uid(),
                name: ex.name || 'Exercise',
                targetSets: ex.targetSets || 3,
                targetReps: ex.targetReps || 10,
                targetRestSeconds: ex.targetRestSeconds != null ? ex.targetRestSeconds : 90,
                howTo: ex.howTo || ''
              });
            });
            newProg.days.push(newDay);
          });
          program = newProg;
          saveJSON(KEYS.program, program);
          selectedDayId = autoSelectDay();
          localStorage.setItem(KEYS.selectedDay, selectedDayId || '');
          focusExerciseId = null;
          renderDayChips();
          renderProgram();
          toast('Program imported');
        });
      } catch (err) {
        toast('Import failed: not a valid program file');
      }
    };
    reader.readAsText(file);
  }

  document.getElementById('importInput').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function (evt) {
      try {
        var data = JSON.parse(evt.target.result);
        if (!data.ironlog && !data.ironclad) throw new Error('Not an Ironclad file');

        if (data.program) {
          program = migrateProgram(data.program);
          saveJSON(KEYS.program, program);
        }

        if (data.sessions) {
          var existingIds = new Set(sessions.map(function (s) { return s.id; }));
          data.sessions.forEach(function (s) {
            if (!existingIds.has(s.id)) {
              sessions.push(s);
            } else {
              var idx = sessions.findIndex(function (x) { return x.id === s.id; });
              sessions[idx] = s;
            }
          });
          saveJSON(KEYS.sessions, sessions);
        }

        selectedDayId = autoSelectDay();
        localStorage.setItem(KEYS.selectedDay, selectedDayId || '');
        focusExerciseId = null;
        renderDayChips();
        switchView(currentView);
        toast('Data imported');
      } catch (err) {
        toast('Import failed: invalid file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('importProgramInput').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    importProgramFromFile(file);
    e.target.value = '';
  });

  // ── Init ──

  function init() {
    updateHeaderDate();
    updateHRDisplay();
    selectedDayId = autoSelectDay();
    if (selectedDayId) localStorage.setItem(KEYS.selectedDay, selectedDayId);
    renderDayChips();
    renderToday();
  }

  // ── Service Worker + update detection ──

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').then(function (reg) {
      function onNewWorkerInstalled(worker) {
        if (!navigator.serviceWorker.controller) return;
        showUpdateToast(worker);
      }

      if (reg.waiting) {
        onNewWorkerInstalled(reg.waiting);
      }

      reg.addEventListener('updatefound', function () {
        var newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', function () {
          if (newWorker.state === 'installed') {
            onNewWorkerInstalled(newWorker);
          }
        });
      });

      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
          reg.update();
        }
      });
    }).catch(function () {});

    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }

  function showUpdateToast(worker) {
    var el = document.getElementById('toast');
    el.textContent = 'New version available — tap to refresh.';
    el.classList.add('show');
    clearTimeout(toast._t);
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'pointer';
    el.onclick = function () {
      el.classList.remove('show');
      el.style.pointerEvents = '';
      el.style.cursor = '';
      el.onclick = null;
      worker.postMessage({ type: 'SKIP_WAITING' });
    };
  }

  init();
})();
