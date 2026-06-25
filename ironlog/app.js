(function () {
  'use strict';

  // ── Utilities ──

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isoDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function formatDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function formatTimer(totalSeconds) {
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 2000);
  }

  function esc(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ── Storage ──

  var KEYS = {
    program: 'ironlog:program',
    sessions: 'ironlog:sessions',
    selectedDay: 'ironlog:selectedDay',
    lastExportDate: 'ironlog:lastExportDate',
    exerciseLibrary: 'ironclad:exerciseLibrary'
  };

  function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (e) { return fallback; }
  }

  function saveJSON(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  // ── IndexedDB for images ──

  var IMAGE_DB_NAME = 'ironclad-images';
  var IMAGE_STORE = 'images';
  var imageDBInstance = null;

  function openImageDB() {
    if (imageDBInstance) return Promise.resolve(imageDBInstance);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IMAGE_DB_NAME, 1);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(IMAGE_STORE)) {
          db.createObjectStore(IMAGE_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function (e) {
        imageDBInstance = e.target.result;
        resolve(imageDBInstance);
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function saveImage(id, blob) {
    return openImageDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IMAGE_STORE, 'readwrite');
        tx.objectStore(IMAGE_STORE).put({ id: id, blob: blob });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function getImage(id) {
    return openImageDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IMAGE_STORE, 'readonly');
        var req = tx.objectStore(IMAGE_STORE).get(id);
        req.onsuccess = function () { resolve(req.result ? req.result.blob : null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function deleteImage(id) {
    return openImageDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IMAGE_STORE, 'readwrite');
        tx.objectStore(IMAGE_STORE).delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function getAllImages() {
    return openImageDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IMAGE_STORE, 'readonly');
        var req = tx.objectStore(IMAGE_STORE).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // ── Image resize/compress ──

  var MAX_IMAGE_EDGE = 1024;
  var JPEG_QUALITY = 0.75;

  function resizeImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var w = img.width;
          var h = img.height;
          var scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(w, h));
          var nw = Math.round(w * scale);
          var nh = Math.round(h * scale);
          var canvas = document.createElement('canvas');
          canvas.width = nw;
          canvas.height = nh;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, nw, nh);
          canvas.toBlob(function (blob) {
            if (!blob) { reject(new Error('Canvas toBlob failed')); return; }
            resolve(blob);
          }, 'image/jpeg', JPEG_QUALITY);
        };
        img.onerror = function () { reject(new Error('Image load failed')); };
        img.src = e.target.result;
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(file);
    });
  }

  // URL cache to avoid re-creating blob URLs
  var imageURLCache = new Map();

  function getImageURL(imageId) {
    if (imageURLCache.has(imageId)) return Promise.resolve(imageURLCache.get(imageId));
    return getImage(imageId).then(function (blob) {
      if (!blob) return null;
      var url = URL.createObjectURL(blob);
      imageURLCache.set(imageId, url);
      return url;
    });
  }

  // ── Body parts ──

  var BODY_PARTS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core', 'Full Body/Other'];

  // ── Data migration ──

  function migrateProgram(prog) {
    if (!prog || !prog.days) return prog;
    prog.days.forEach(function (day) {
      if (!day.exercises) return;
      day.exercises.forEach(function (ex) {
        if (ex.targetRestSeconds == null) ex.targetRestSeconds = 90;
      });
    });
    return prog;
  }

  function migrateToExerciseLibrary(prog) {
    if (!prog || !prog.days || prog.days.length === 0) return false;
    var firstDay = prog.days.find(function (d) { return d.exercises && d.exercises.length > 0; });
    if (!firstDay) return false;
    var firstEx = firstDay.exercises[0];
    // Already migrated if exercises use libraryExerciseId
    if (firstEx.libraryExerciseId) return false;
    // Old shape: exercises have name directly embedded
    if (!firstEx.name) return false;

    var library = loadJSON(KEYS.exerciseLibrary, []);
    var libraryIds = new Set(library.map(function (e) { return e.id; }));

    prog.days.forEach(function (day) {
      if (!day.exercises) return;
      day.exercises = day.exercises.map(function (ex) {
        if (!libraryIds.has(ex.id)) {
          library.push({
            id: ex.id,
            name: ex.name,
            bodyPart: '',
            videoUrl: '',
            description: ex.howTo || '',
            imageIds: []
          });
          libraryIds.add(ex.id);
        }
        return {
          libraryExerciseId: ex.id,
          targetSets: ex.targetSets || 3,
          targetReps: ex.targetReps || 10,
          targetRestSeconds: ex.targetRestSeconds != null ? ex.targetRestSeconds : 90
        };
      });
    });

    saveJSON(KEYS.exerciseLibrary, library);
    saveJSON(KEYS.program, prog);
    return true;
  }

  // ── Seed data ──

  function defaultExerciseLibrary() {
    return [
      { id: 'ex_wcp', name: 'Warmup Chest Press', bodyPart: 'Chest', videoUrl: '', description: 'Same setup as Chest Press, but with a light weight focused purely on smooth, full-range reps to warm the shoulders and chest before working sets.', imageIds: [] },
      { id: 'ex_cp', name: 'Chest Press', bodyPart: 'Chest', videoUrl: '', description: 'Sit with back flat against the pad, grips at chest height. Press handles forward until arms extend without locking elbows, then control the return. Keep shoulder blades pinned back throughout.', imageIds: [] },
      { id: 'ex_cf', name: 'Chest Fly', bodyPart: 'Chest', videoUrl: '', description: 'Sit upright, arms slightly bent, palms facing in. Bring handles together in a wide arc in front of your chest, squeezing at the centre, then return slowly under control.', imageIds: [] },
      { id: 'ex_sp', name: 'Shoulder Press', bodyPart: 'Shoulders', videoUrl: '', description: 'Sit with back supported, grips at shoulder height. Press straight overhead until arms are extended, then lower back to the start without flaring elbows too far forward or back.', imageIds: [] },
      { id: 'ex_tpd', name: 'Triceps Push Downs', bodyPart: 'Arms', videoUrl: '', description: 'Stand facing the cable stack, elbows pinned to your sides. Push the bar/rope down until arms are fully extended, then let it return under control without letting elbows drift forward.', imageIds: [] },
      { id: 'ex_rs', name: 'Rear Shoulder', bodyPart: 'Shoulders', videoUrl: '', description: 'Sit facing into the pad (or bend forward for a cable version), arms slightly bent. Pull handles back and out to the sides, squeezing shoulder blades together, then return slowly.', imageIds: [] },
      { id: 'ex_lr', name: 'Lateral Raises', bodyPart: 'Shoulders', videoUrl: '', description: 'Stand with a slight bend in the elbows. Raise arms out to the sides to roughly shoulder height, leading with the elbows, then lower under control. Avoid swinging or shrugging the shoulders up.', imageIds: [] },
      { id: 'ex_lpd', name: 'Lat Pull Downs', bodyPart: 'Back', videoUrl: '', description: 'Grip the bar wider than shoulder width, sit with thighs locked under the pad. Pull the bar down to upper chest, driving elbows down and back, then control the return to a full stretch overhead.', imageIds: [] },
      { id: 'ex_br', name: 'Barbell Rows', bodyPart: 'Back', videoUrl: '', description: 'Hinge at the hips with a flat back, grip the bar just outside shoulder width. Pull the bar up to your lower ribs, squeezing shoulder blades together, then lower with control without rounding the back.', imageIds: [] },
      { id: 'ex_sr', name: 'Seated Rows', bodyPart: 'Back', videoUrl: '', description: 'Sit with knees slightly bent, grip the handle, back upright. Pull the handle to your stomach, driving elbows back, then extend arms fully forward without letting shoulders round.', imageIds: [] },
      { id: 'ex_srm', name: 'Seated Row Machine', bodyPart: 'Back', videoUrl: '', description: 'Sit facing the machine, chest against the pad if available. Pull the handles back, leading with elbows, squeeze shoulder blades together, then return slowly to a full stretch.', imageIds: [] },
      { id: 'ex_bac', name: 'Bicep Alternating Curls', bodyPart: 'Arms', videoUrl: '', description: 'Stand or sit with arms hanging at your sides. Curl one dumbbell up toward the shoulder, rotating the palm up as you go, then lower under control before alternating sides.', imageIds: [] },
      { id: 'ex_hc', name: 'Hammer Curls', bodyPart: 'Arms', videoUrl: '', description: 'Same setup as alternating curls, but palms face each other throughout (neutral grip). Curl up, squeeze briefly, then lower slowly.', imageIds: [] },
      { id: 'ex_ebc', name: 'Easy Bar Curls', bodyPart: 'Arms', videoUrl: '', description: 'Grip the EZ-bar at the angled sections, stand with elbows close to your sides. Curl the bar up toward your shoulders without swinging your hips, then lower under control.', imageIds: [] },
      { id: 'ex_le', name: 'Leg Extensions', bodyPart: 'Legs', videoUrl: '', description: 'Sit with the pad resting on your shins, back against the seat. Extend your legs until straight (without locking out hard), pause briefly, then lower under control.', imageIds: [] },
      { id: 'ex_lc', name: 'Leg Curls', bodyPart: 'Legs', videoUrl: '', description: 'Pad positioned behind your ankles. Curl your heels toward your glutes, squeeze briefly, then extend back out under control.', imageIds: [] },
      { id: 'ex_lp', name: 'Leg Press', bodyPart: 'Legs', videoUrl: '', description: 'Sit back in the machine with feet shoulder-width on the platform. Lower the platform by bending your knees toward your chest without rounding your lower back, then press back up without locking your knees out hard.', imageIds: [] },
      { id: 'ex_ks', name: 'Kettlebell Swings', bodyPart: 'Full Body/Other', videoUrl: '', description: 'Stand with feet shoulder-width apart, kettlebell in front of you. Hinge at the hips to swing the bell back between your legs, then drive through your hips to swing it up to chest height, keeping your back flat throughout.', imageIds: [] }
    ];
  }

  function defaultProgram() {
    return {
      days: [
        {
          id: 'day_mon', name: 'Monday', dayOfWeek: 1,
          exercises: [
            { libraryExerciseId: 'ex_wcp', targetSets: 2, targetReps: 15, targetRestSeconds: 90 },
            { libraryExerciseId: 'ex_cp', targetSets: 3, targetReps: 15, targetRestSeconds: 90 },
            { libraryExerciseId: 'ex_cf', targetSets: 3, targetReps: 15, targetRestSeconds: 90 },
            { libraryExerciseId: 'ex_sp', targetSets: 3, targetReps: 10, targetRestSeconds: 90 },
            { libraryExerciseId: 'ex_tpd', targetSets: 3, targetReps: 15, targetRestSeconds: 90 },
            { libraryExerciseId: 'ex_rs', targetSets: 3, targetReps: 10, targetRestSeconds: 90 },
            { libraryExerciseId: 'ex_lr', targetSets: 3, targetReps: 10, targetRestSeconds: 90 }
          ]
        },
        {
          id: 'day_wed', name: 'Wednesday', dayOfWeek: 3,
          exercises: [
            { libraryExerciseId: 'ex_lpd', targetSets: 4, targetReps: 12, targetRestSeconds: 90 },
            { libraryExerciseId: 'ex_br', targetSets: 4, targetReps: 10, targetRestSeconds: 90 },
            { libraryExerciseId: 'ex_sr', targetSets: 3, targetReps: 10, targetRestSeconds: 90 },
            { libraryExerciseId: 'ex_srm', targetSets: 3, targetReps: 10, targetRestSeconds: 90 },
            { libraryExerciseId: 'ex_bac', targetSets: 4, targetReps: 10, targetRestSeconds: 90 },
            { libraryExerciseId: 'ex_hc', targetSets: 4, targetReps: 10, targetRestSeconds: 90 },
            { libraryExerciseId: 'ex_ebc', targetSets: 3, targetReps: 10, targetRestSeconds: 90 }
          ]
        },
        {
          id: 'day_fri', name: 'Friday', dayOfWeek: 5,
          exercises: [
            { libraryExerciseId: 'ex_le', targetSets: 5, targetReps: 15, targetRestSeconds: 90 },
            { libraryExerciseId: 'ex_lc', targetSets: 4, targetReps: 15, targetRestSeconds: 90 },
            { libraryExerciseId: 'ex_lp', targetSets: 4, targetReps: 20, targetRestSeconds: 90 },
            { libraryExerciseId: 'ex_ks', targetSets: 4, targetReps: 10, targetRestSeconds: 90 }
          ]
        }
      ]
    };
  }

  // ── State ──

  var exerciseLibrary = loadJSON(KEYS.exerciseLibrary, null);
  var program = loadJSON(KEYS.program, null);

  if (!program) {
    exerciseLibrary = defaultExerciseLibrary();
    saveJSON(KEYS.exerciseLibrary, exerciseLibrary);
    program = defaultProgram();
    saveJSON(KEYS.program, program);
  } else {
    program = migrateProgram(program);
    if (migrateToExerciseLibrary(program)) {
      exerciseLibrary = loadJSON(KEYS.exerciseLibrary, []);
    } else {
      if (!exerciseLibrary) {
        exerciseLibrary = [];
        saveJSON(KEYS.exerciseLibrary, exerciseLibrary);
      }
      saveJSON(KEYS.program, program);
    }
  }

  var sessions = loadJSON(KEYS.sessions, []);
  var selectedDayId = localStorage.getItem(KEYS.selectedDay) || null;
  var currentView = 'today';
  var focusExerciseId = null;

  // Timer state per exercise (ephemeral, not persisted)
  var timers = new Map();
  var timerTickId = null;

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
  var hr = { device: null, server: null, characteristic: null, bpm: null, connected: false };

  // Exercise library helpers
  function getLibraryExercise(id) {
    return exerciseLibrary.find(function (e) { return e.id === id; }) || null;
  }

  function getExerciseName(ref) {
    var lib = getLibraryExercise(ref.libraryExerciseId);
    return lib ? lib.name : 'Unknown Exercise';
  }

  function getExerciseId(ref) {
    return ref.libraryExerciseId;
  }

  // ── Confirm dialog ──

  var dialogResolve = null;

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
          var ref = day && day.exercises.find(function (e) { return getExerciseId(e) === exId; });
          var target = (ref && ref.targetRestSeconds) || 90;
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
      var card = views.today.querySelector('.exercise-card[data-ex-id="' + exId + '"]');
      if (card) {
        var wIn = card.querySelector('input[data-field="weight"][data-ex="' + exId + '"]');
        var rIn = card.querySelector('input[data-field="reps"][data-ex="' + exId + '"]');
        if (wIn) timer.pendingWeight = parseFloat(wIn.value) || 0;
        if (rIn) timer.pendingReps = parseInt(rIn.value) || 0;
      }
      timer.status = 'active';
      timer.startTime = now;
      startTimerTick();
      renderToday();
    } else if (timer.status === 'active') {
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
    program: document.getElementById('viewProgram'),
    exercises: document.getElementById('viewExercises'),
    settings: document.getElementById('viewSettings')
  };

  function switchView(name) {
    currentView = name;
    tabs.forEach(function (t) { t.classList.toggle('active', t.dataset.view === name); });
    Object.keys(views).forEach(function (k) { views[k].classList.toggle('active', k === name); });
    document.querySelector('.day-chips').style.display = name === 'today' ? '' : 'none';

    if (name === 'today') renderToday();
    else if (name === 'history') renderHistory();
    else if (name === 'program') renderProgram();
    else if (name === 'exercises') renderExercises();
    else if (name === 'settings') renderSettings();
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

  // ── Today view (master-detail layout) ──

  function getFirstIncompleteExId(day, session) {
    for (var i = 0; i < day.exercises.length; i++) {
      var ref = day.exercises[i];
      var exId = getExerciseId(ref);
      var logged = session ? getExerciseEntriesForSession(session, exId) : [];
      if (logged.length < ref.targetSets) return exId;
    }
    return day.exercises[0] ? getExerciseId(day.exercises[0]) : null;
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

    if (!focusExerciseId || !day.exercises.find(function (e) { return getExerciseId(e) === focusExerciseId; })) {
      focusExerciseId = getFirstIncompleteExId(day, session);
    }

    var html = '';

    // Detail panel first (primary content)
    var focusRef = day.exercises.find(function (e) { return getExerciseId(e) === focusExerciseId; });
    if (focusRef) {
      var focusLib = getLibraryExercise(focusExerciseId);
      var focusLogged = session ? getExerciseEntriesForSession(session, focusExerciseId) : [];
      var focusDone = focusLogged.length >= focusRef.targetSets;
      html += renderExpandedCard(focusRef, focusLib, focusLogged, focusDone, date, session);
    }

    // Tile grid below
    html += '<div class="exercise-grid">';
    day.exercises.forEach(function (ref) {
      var exId = getExerciseId(ref);
      var lib = getLibraryExercise(exId);
      var exName = lib ? lib.name : 'Unknown';
      var logged = session ? getExerciseEntriesForSession(session, exId) : [];
      var filledCount = logged.length;
      var isDone = filledCount >= ref.targetSets;
      var isActive = exId === focusExerciseId;

      html += '<button class="exercise-tile' + (isActive ? ' active' : '') + (isDone ? ' done' : '') + '" data-action="focus-exercise" data-ex-id="' + exId + '">';
      html += '<span class="exercise-tile-name">' + esc(exName) + '</span>';
      html += '<div class="set-dots">';
      for (var i = 0; i < ref.targetSets; i++) {
        html += '<div class="set-dot mini' + (i < filledCount ? ' filled' : '') + '"></div>';
      }
      html += '</div>';
      html += '</button>';
    });
    html += '</div>';

    container.innerHTML = html;
    loadTodayPhotos();
  }

  function renderExpandedCard(ref, lib, logged, isDone, date, session) {
    var exId = getExerciseId(ref);
    var exName = lib ? lib.name : 'Unknown Exercise';
    var filledCount = logged.length;
    var lastWeight = getLastWeight(exId, date);
    var currentWeight = logged.length > 0
      ? logged[logged.length - 1].weight
      : (lastWeight != null ? lastWeight : 0);
    var currentReps = logged.length > 0
      ? logged[logged.length - 1].reps
      : ref.targetReps;

    var timer = getTimer(exId);
    if (timer.pendingWeight != null && (timer.status === 'active' || timer.status === 'resting')) {
      currentWeight = timer.pendingWeight;
    }
    if (timer.pendingReps != null && (timer.status === 'active' || timer.status === 'resting')) {
      currentReps = timer.pendingReps;
    }
    var h = '';

    h += '<div class="exercise-card' + (isDone ? ' done' : '') + '" data-ex-id="' + exId + '">';

    // Header
    h += '<div class="exercise-card-header">';
    h += '<span class="exercise-name">' + esc(exName) + '</span>';
    h += '<span class="exercise-target">' + ref.targetReps + ' &times; ' + ref.targetSets + '</span>';
    h += '</div>';

    // How-to section sourced from library
    if (lib) {
      var hasDescription = lib.description && lib.description.trim();
      var hasVideo = lib.videoUrl && lib.videoUrl.trim();
      var hasPhotos = lib.imageIds && lib.imageIds.length > 0;
      if (hasDescription || hasVideo || hasPhotos) {
        h += '<details class="howto-disclosure">';
        h += '<summary class="howto-toggle">ⓘ How to</summary>';
        if (hasDescription) {
          h += '<div class="howto-body">' + esc(lib.description) + '</div>';
        }
        if (hasVideo) {
          h += '<a class="howto-video-link" href="' + esc(lib.videoUrl) + '" target="_blank" rel="noopener">▶ Watch video →</a>';
        } else {
          var ytQuery = encodeURIComponent(exName + ' proper form');
          h += '<a class="howto-demo-link" href="https://www.youtube.com/results?search_query=' + ytQuery + '" target="_blank" rel="noopener">Search a demo &rarr;</a>';
        }
        if (hasPhotos) {
          h += '<div class="howto-photos" data-photos-for="' + exId + '">';
          lib.imageIds.forEach(function (imgId) {
            h += '<img class="howto-photo-thumb" data-image-id="' + imgId + '" data-action="view-image" alt="" src="">';
          });
          h += '</div>';
        }
        h += '</details>';
      }
    }

    if (lastWeight != null) {
      h += '<div class="exercise-last">last: ' + lastWeight + 'kg</div>';
    }

    // Set dots
    var totalDots = Math.max(ref.targetSets, filledCount);
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
      h += '<div class="timer-display" data-timer-display="' + exId + '">' + formatTimer(elapsed) + '</div>';
      h += '</div>';
    } else if (timer.status === 'resting') {
      var restElapsed = Math.floor((Date.now() - timer.restStartTime) / 1000);
      var target = ref.targetRestSeconds || 90;
      var pct = Math.min(100, (restElapsed / target) * 100);
      var met = restElapsed >= target;
      h += '<div class="timer-area">';
      h += '<div class="timer-label resting">Rest</div>';
      h += '<div class="timer-display" data-timer-display="' + exId + '">' + formatTimer(restElapsed) + '</div>';
      h += '<div class="rest-bar"><div class="rest-bar-fill' + (met ? ' target-met' : '') + '" data-rest-bar="' + exId + '" style="width:' + pct + '%"></div></div>';
      h += '</div>';
    }

    // Steppers
    h += '<div class="stepper-row">';
    h += '<div class="stepper-group"><div class="stepper-label">Weight</div>';
    h += '<div class="stepper">';
    h += '<button class="stepper-btn" data-action="weight-dec" data-ex="' + exId + '">&minus;</button>';
    h += '<input type="number" class="stepper-value" data-field="weight" data-ex="' + exId + '" value="' + currentWeight + '" step="2.5" min="0" inputmode="decimal">';
    h += '<span class="stepper-unit">kg</span>';
    h += '<button class="stepper-btn" data-action="weight-inc" data-ex="' + exId + '">&plus;</button>';
    h += '</div></div>';

    h += '<div class="stepper-group"><div class="stepper-label">Reps</div>';
    h += '<div class="stepper">';
    h += '<button class="stepper-btn" data-action="reps-dec" data-ex="' + exId + '">&minus;</button>';
    h += '<input type="number" class="stepper-value" data-field="reps" data-ex="' + exId + '" value="' + currentReps + '" step="1" min="0" inputmode="numeric">';
    h += '<button class="stepper-btn" data-action="reps-inc" data-ex="' + exId + '">&plus;</button>';
    h += '</div></div>';
    h += '</div>';

    // RPE
    h += '<div class="rpe-row"><div class="stepper-label">RPE</div>';
    h += '<div class="rpe-chips">';
    for (var r = 1; r <= 10; r++) {
      h += '<button class="rpe-chip" data-rpe="' + r + '" data-ex="' + exId + '">' + r + '</button>';
    }
    h += '</div></div>';

    // Notes
    h += '<input type="text" class="notes-input" data-field="notes" data-ex="' + exId + '" placeholder="optional note">';

    // Timer button
    var btnClass, btnLabel;
    if (timer.status === 'active') {
      btnClass = 'active';
      btnLabel = 'Stop';
    } else if (timer.status === 'resting') {
      var restNow = Math.floor((Date.now() - timer.restStartTime) / 1000);
      var targetMet = restNow >= (ref.targetRestSeconds || 90);
      btnClass = 'resting' + (targetMet ? ' target-met' : '');
      btnLabel = 'Start';
    } else {
      btnClass = 'idle';
      btnLabel = 'Start';
    }
    h += '<button class="btn-timer ' + btnClass + '" data-action="timer-toggle" data-ex="' + exId + '" data-timer-btn="' + exId + '">' + btnLabel + '</button>';

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
        h += '<button class="btn-delete-set" data-action="delete-set" data-ex="' + exId + '" data-idx="' + idx + '">&times;</button>';
        h += '</div>';
      });
      h += '</div>';
    }

    h += '</div>';
    return h;
  }

  function loadTodayPhotos() {
    var photoEls = views.today.querySelectorAll('.howto-photo-thumb[data-image-id]');
    photoEls.forEach(function (el) {
      getImageURL(el.dataset.imageId).then(function (url) {
        if (url) el.src = url;
      });
    });
  }

  // ── Today view event handlers ──

  function handleTodayClick(e) {
    // Image viewer
    var imgThumb = e.target.closest('[data-action="view-image"]');
    if (imgThumb) {
      openImageViewer(imgThumb.dataset.imageId);
      return;
    }

    // Exercise chip tap → focus
    var chip = e.target.closest('[data-action="focus-exercise"]');
    if (chip) {
      focusExerciseId = chip.dataset.exId;
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
    var ref = day.exercises.find(function (e) { return getExerciseId(e) === exId; });
    if (!ref) return;
    var lib = getLibraryExercise(exId);
    var exName = lib ? lib.name : 'Unknown Exercise';

    var card = views.today.querySelector('.exercise-card[data-ex-id="' + exId + '"]');
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
      exerciseName: exName,
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
    if (logged.length >= ref.targetSets) {
      var nextId = getFirstIncompleteExId(day, sess);
      if (nextId && nextId !== exId) {
        focusExerciseId = nextId;
      }
    }

    renderToday();

    requestAnimationFrame(function () {
      var newCard = views.today.querySelector('.exercise-card[data-ex-id="' + exId + '"]');
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

  // ── Image viewer ──

  function openImageViewer(imageId) {
    getImageURL(imageId).then(function (url) {
      if (!url) return;
      document.getElementById('imageViewerImg').src = url;
      document.getElementById('imageViewerOverlay').classList.add('open');
    });
  }

  document.getElementById('imageViewerClose').addEventListener('click', function () {
    document.getElementById('imageViewerOverlay').classList.remove('open');
  });
  document.getElementById('imageViewerOverlay').addEventListener('click', function (e) {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
  });

  // ── History view ──

  // ── Progress view (formerly History) ──

  var progressExpandedExId = null;
  var progressMetric = 'weight'; // weight | volume | e1rm
  var balanceWindow = 30; // 7, 30, or 0 (all time)

  function buildExerciseSessionData() {
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
    return exerciseMap;
  }

  function computeSessionMetrics(entries) {
    var topWeight = 0;
    var volume = 0;
    var bestE1rm = 0;
    entries.forEach(function (e) {
      var w = e.weight || 0;
      var r = e.reps || 0;
      if (w > topWeight) topWeight = w;
      volume += w * r;
      if (w > 0 && r > 0) {
        var e1rm = w * (1 + r / 30);
        if (e1rm > bestE1rm) bestE1rm = e1rm;
      }
    });
    return { topWeight: topWeight, volume: volume, e1rm: Math.round(bestE1rm * 10) / 10 };
  }

  function renderHistory() {
    var container = views.history;
    var html = '';
    var exerciseMap = buildExerciseSessionData();

    // Section 1: Per-exercise charts
    if (exerciseMap.size > 0) {
      html += '<div class="progress-exercises-section">';
      html += '<div class="progress-section-title">Exercises</div>';
      exerciseMap.forEach(function (data, exId) {
        var dates = Array.from(data.sessions.keys()).sort();
        var sessionMetrics = dates.map(function (d) {
          return computeSessionMetrics(data.sessions.get(d));
        });

        var isExpanded = progressExpandedExId === exId;
        var topWeights = sessionMetrics.map(function (m) { return m.topWeight; });
        var volumes = sessionMetrics.map(function (m) { return m.volume; });
        var e1rms = sessionMetrics.map(function (m) { return m.e1rm; });

        var best = Math.max.apply(null, topWeights);
        var bestVolume = Math.max.apply(null, volumes);
        var latest = topWeights[topWeights.length - 1];
        var prev = topWeights.length >= 2 ? topWeights[topWeights.length - 2] : latest;
        var trendClass = 'trend-flat';
        var trendSymbol = '—';
        if (latest > prev) { trendClass = 'trend-up'; trendSymbol = '▲'; }
        else if (latest < prev) { trendClass = 'trend-down'; trendSymbol = '▼'; }

        // PR detection
        var latestWeight = topWeights[topWeights.length - 1];
        var latestVolume = volumes[volumes.length - 1];
        var isWeightPR = topWeights.length > 1 && latestWeight > 0 && latestWeight >= best;
        var isVolumePR = volumes.length > 1 && latestVolume > 0 && latestVolume >= bestVolume;

        html += '<div class="progress-exercise-card' + (isExpanded ? ' expanded' : '') + '" data-progress-ex="' + exId + '">';
        html += '<div class="progress-exercise-header">';
        html += '<span class="progress-exercise-name">' + esc(data.name) + '</span>';
        html += '<span class="progress-exercise-chevron">▶</span>';
        html += '</div>';

        if (!isExpanded) {
          html += '<div class="progress-sparkline">' + buildSparkline(topWeights) + '</div>';
        }

        // Stats line (always visible)
        html += '<div class="progress-stats">';
        html += '<span>Best: <span class="value">' + best + 'kg</span>';
        if (isWeightPR) html += '<span class="pr-badge">PR</span>';
        html += '</span>';
        html += '<span>Latest: <span class="value">' + latest + 'kg</span></span>';
        html += '<span>Trend: <span class="' + trendClass + '">' + trendSymbol + '</span></span>';
        if (isVolumePR) html += '<span>Vol: <span class="value">' + latestVolume.toLocaleString() + 'kg</span><span class="pr-badge">PR</span></span>';
        html += '</div>';

        // Expanded chart area
        html += '<div class="progress-chart-area">';
        html += '<div class="progress-metric-toggle">';
        html += '<button class="progress-metric-btn' + (progressMetric === 'weight' ? ' active' : '') + '" data-metric="weight">Weight</button>';
        html += '<button class="progress-metric-btn' + (progressMetric === 'volume' ? ' active' : '') + '" data-metric="volume">Volume</button>';
        html += '<button class="progress-metric-btn' + (progressMetric === 'e1rm' ? ' active' : '') + '" data-metric="e1rm">Est 1RM</button>';
        html += '</div>';

        var chartValues;
        var chartUnit;
        if (progressMetric === 'volume') { chartValues = volumes; chartUnit = 'kg'; }
        else if (progressMetric === 'e1rm') { chartValues = e1rms; chartUnit = 'kg'; }
        else { chartValues = topWeights; chartUnit = 'kg'; }

        // PR indices for chart markers
        var prIndices = computePRIndices(chartValues);

        html += '<div class="progress-chart">' + buildFullChart(chartValues, dates, chartUnit, prIndices) + '</div>';
        html += '</div>';

        html += '</div>';
      });
      html += '</div>';
    }

    // Section 2: Body-part balance
    html += renderBodyPartBalance();

    // Section 3: Session log (unchanged)
    var sorted = sessions.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    if (sorted.length > 0) {
      html += '<div class="progress-sessions-title">Sessions</div>';
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

    // Event delegation for the progress view
    container.removeEventListener('click', handleProgressClick);
    container.addEventListener('click', handleProgressClick);
  }

  function handleProgressClick(e) {
    // Session card expand
    var sessHdr = e.target.closest('.session-header');
    if (sessHdr) {
      sessHdr.closest('.session-card').classList.toggle('expanded');
      return;
    }

    // Metric toggle
    var metricBtn = e.target.closest('.progress-metric-btn');
    if (metricBtn) {
      progressMetric = metricBtn.dataset.metric;
      renderHistory();
      return;
    }

    // Balance window chips
    var windowChip = e.target.closest('.balance-window-chip');
    if (windowChip) {
      balanceWindow = parseInt(windowChip.dataset.window);
      renderHistory();
      return;
    }

    // Exercise card expand/collapse
    var exCard = e.target.closest('.progress-exercise-card');
    if (exCard && !e.target.closest('.progress-metric-btn') && !e.target.closest('.balance-window-chip')) {
      var exId = exCard.dataset.progressEx;
      if (progressExpandedExId === exId) {
        progressExpandedExId = null;
      } else {
        progressExpandedExId = exId;
      }
      renderHistory();
      return;
    }
  }

  function computePRIndices(values) {
    var prs = [];
    var best = -Infinity;
    for (var i = 0; i < values.length; i++) {
      if (values[i] > best && values[i] > 0) {
        best = values[i];
        prs.push(i);
      }
    }
    return prs;
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

  function buildFullChart(values, dates, unit, prIndices) {
    var w = 300, h = 120, padTop = 16, padBottom = 24, padLeft = 8, padRight = 8;
    var chartW = w - padLeft - padRight;
    var chartH = h - padTop - padBottom;

    if (values.length < 2) {
      return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet">' +
        '<text x="' + (w / 2) + '" y="' + (h / 2) + '" text-anchor="middle" fill="#A8A199" font-family="Inter, sans-serif" font-size="12">Not enough data</text></svg>';
    }

    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var range = max - min || 1;
    var prSet = new Set(prIndices || []);

    var points = values.map(function (v, i) {
      var x = padLeft + (i / (values.length - 1)) * chartW;
      var y = padTop + ((1 - (v - min) / range) * chartH);
      return { x: x, y: y, val: v };
    });

    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet">';

    // Y-axis grid lines
    var gridSteps = 4;
    for (var g = 0; g <= gridSteps; g++) {
      var gy = padTop + (g / gridSteps) * chartH;
      var gVal = max - (g / gridSteps) * range;
      svg += '<line x1="' + padLeft + '" y1="' + gy.toFixed(1) + '" x2="' + (w - padRight) + '" y2="' + gy.toFixed(1) + '" stroke="#3F3B38" stroke-width="0.5"/>';
      svg += '<text x="' + padLeft + '" y="' + (gy - 3).toFixed(1) + '" fill="#A8A199" font-family="\'IBM Plex Mono\', monospace" font-size="8">' + Math.round(gVal) + '</text>';
    }

    // Line
    var polyPoints = points.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
    svg += '<polyline points="' + polyPoints + '" fill="none" stroke="#C1622B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

    // Data points and PR markers
    points.forEach(function (p, i) {
      if (prSet.has(i)) {
        svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="5" fill="#8A9550" stroke="#1C1B1A" stroke-width="1.5"/>';
        svg += '<text x="' + p.x.toFixed(1) + '" y="' + (p.y - 8).toFixed(1) + '" text-anchor="middle" fill="#8A9550" font-family="\'Oswald\', sans-serif" font-size="7" font-weight="600">PR</text>';
      } else {
        svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3" fill="#C1622B"/>';
      }
    });

    // X-axis date labels (first, middle, last)
    if (dates.length >= 2) {
      var labelIndices = [0, dates.length - 1];
      if (dates.length >= 5) labelIndices = [0, Math.floor(dates.length / 2), dates.length - 1];
      labelIndices.forEach(function (li) {
        var lx = padLeft + (li / (dates.length - 1)) * chartW;
        var shortDate = dates[li].slice(5);
        svg += '<text x="' + lx.toFixed(1) + '" y="' + (h - 4) + '" text-anchor="middle" fill="#A8A199" font-family="\'IBM Plex Mono\', monospace" font-size="7">' + shortDate + '</text>';
      });
    }

    svg += '</svg>';
    return svg;
  }

  function renderBodyPartBalance() {
    if (sessions.length === 0) return '';

    var cutoff = null;
    if (balanceWindow > 0) {
      var d = new Date();
      d.setDate(d.getDate() - balanceWindow);
      cutoff = isoDate(d);
    }

    // Accumulate volume by body part
    var bpVolume = new Map();
    sessions.forEach(function (s) {
      if (cutoff && s.date < cutoff) return;
      s.entries.forEach(function (e) {
        var vol = (e.weight || 0) * (e.reps || 0);
        if (vol === 0) return;
        var lib = getLibraryExercise(e.exerciseId);
        var bp = (lib && lib.bodyPart) ? lib.bodyPart : 'Untagged';
        bpVolume.set(bp, (bpVolume.get(bp) || 0) + vol);
      });
    });

    if (bpVolume.size === 0) return '';

    var maxVol = 0;
    bpVolume.forEach(function (v) { if (v > maxVol) maxVol = v; });

    // Sort: tagged body parts in BODY_PARTS order, then Untagged last
    var sortedParts = [];
    BODY_PARTS.forEach(function (bp) {
      if (bpVolume.has(bp)) sortedParts.push(bp);
    });
    if (bpVolume.has('Untagged')) sortedParts.push('Untagged');

    var h = '<div class="balance-section">';
    h += '<div class="progress-section-title">Body Balance</div>';
    h += '<div class="balance-window-chips">';
    h += '<button class="balance-window-chip' + (balanceWindow === 7 ? ' active' : '') + '" data-window="7">7 days</button>';
    h += '<button class="balance-window-chip' + (balanceWindow === 30 ? ' active' : '') + '" data-window="30">30 days</button>';
    h += '<button class="balance-window-chip' + (balanceWindow === 0 ? ' active' : '') + '" data-window="0">All time</button>';
    h += '</div>';

    sortedParts.forEach(function (bp) {
      var vol = bpVolume.get(bp);
      var pct = maxVol > 0 ? (vol / maxVol) * 100 : 0;
      var fillClass = bp === 'Untagged' ? ' untagged' : '';
      h += '<div class="balance-bar-row">';
      h += '<span class="balance-bar-label">' + esc(bp) + '</span>';
      h += '<div class="balance-bar-track"><div class="balance-bar-fill' + fillClass + '" style="width:' + pct.toFixed(1) + '%"></div></div>';
      h += '<span class="balance-bar-value">' + vol.toLocaleString() + 'kg</span>';
      h += '</div>';
    });

    h += '</div>';
    return h;
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

      day.exercises.forEach(function (ref) {
        var exId = getExerciseId(ref);
        var lib = getLibraryExercise(exId);
        var exName = lib ? lib.name : 'Unknown Exercise';
        html += '<div class="program-exercise" data-ex-id="' + exId + '">';
        html += '<div class="program-ex-line1">';
        html += '<span class="program-ex-name-readonly" data-action="goto-library-ex" data-ex="' + exId + '">' + esc(exName) + '</span>';
        html += '<button class="btn-delete-ex" data-action="delete-ex" data-day="' + day.id + '" data-ex="' + exId + '">&times;</button>';
        html += '</div>';
        html += '<div class="program-ex-line2">';
        html += buildNumericSelect(SETS_PRESETS, ref.targetSets, 'change-sets', day.id, exId);
        html += buildNumericSelect(REPS_PRESETS, ref.targetReps, 'change-reps', day.id, exId);
        html += buildRestSelect(ref.targetRestSeconds || 90, day.id, exId);
        html += '</div>';
        html += '</div>';
      });

      html += '<button class="btn-add-exercise" data-action="add-ex" data-day="' + day.id + '">+ Add Exercise</button>';
      html += '</div>';
    });

    html += '<button class="btn-add-day" data-action="add-day">+ Add Day</button>';

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
      if (exerciseLibrary.length === 0) {
        toast('Add exercises in the Exercises tab first');
        return;
      }
      openExercisePicker(btn.dataset.day);
    }

    if (action === 'delete-ex') {
      confirm('Remove Exercise', 'Remove this exercise from this day? (The exercise stays in your library.)').then(function (ok) {
        if (!ok) return;
        var day2 = program.days.find(function (d) { return d.id === btn.dataset.day; });
        if (day2) {
          day2.exercises = day2.exercises.filter(function (ref) { return getExerciseId(ref) !== btn.dataset.ex; });
          saveAndRenderProgram();
        }
      });
    }

    if (action === 'goto-library-ex') {
      exerciseDetailId = btn.dataset.ex;
      switchView('exercises');
      return;
    }
  }

  function findExerciseRef(dayId, exId) {
    var day = program.days.find(function (d) { return d.id === dayId; });
    if (!day) return null;
    return day.exercises.find(function (ref) { return getExerciseId(ref) === exId; }) || null;
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
        var ref = findExerciseRef(el.dataset.day, el.dataset.ex);
        if (ref) {
          var val = parseInt(el.value);
          if (action === 'change-sets') ref.targetSets = Math.max(1, val || 1);
          else if (action === 'change-reps') ref.targetReps = Math.max(1, val || 1);
          else ref.targetRestSeconds = Math.max(0, val || 0);
          saveProgram();
          renderProgram();
        }
      }
      return;
    }

    // Custom number inputs
    if (action === 'change-sets-custom' || action === 'change-reps-custom' || action === 'change-rest-custom') {
      var ref2 = findExerciseRef(el.dataset.day, el.dataset.ex);
      if (ref2) {
        var cval = parseInt(el.value);
        if (action === 'change-sets-custom') ref2.targetSets = Math.max(1, cval || 1);
        else if (action === 'change-reps-custom') ref2.targetReps = Math.max(1, cval || 1);
        else ref2.targetRestSeconds = Math.max(0, cval || 0);
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

  // ── Exercise picker (overlay for adding exercise to a program day) ──

  var pickerTargetDayId = null;
  var pickerFilter = 'All';
  var pickerSearchTerm = '';

  function openExercisePicker(dayId) {
    pickerTargetDayId = dayId;
    pickerFilter = 'All';
    pickerSearchTerm = '';
    document.getElementById('pickerSearch').value = '';
    renderPickerFilters();
    renderPickerList();
    document.getElementById('exercisePickerOverlay').classList.add('open');
    document.getElementById('pickerSearch').focus();
  }

  function closeExercisePicker() {
    document.getElementById('exercisePickerOverlay').classList.remove('open');
    pickerTargetDayId = null;
  }

  function renderPickerFilters() {
    var container = document.getElementById('pickerFilters');
    var h = '<button class="bodypart-chip' + (pickerFilter === 'All' ? ' active' : '') + '" data-bp="All">All</button>';
    BODY_PARTS.forEach(function (bp) {
      h += '<button class="bodypart-chip' + (pickerFilter === bp ? ' active' : '') + '" data-bp="' + bp + '">' + esc(bp) + '</button>';
    });
    container.innerHTML = h;
  }

  function renderPickerList() {
    var container = document.getElementById('pickerList');
    var searchLower = pickerSearchTerm.toLowerCase();

    var day = program.days.find(function (d) { return d.id === pickerTargetDayId; });
    var alreadyAdded = new Set();
    if (day) {
      day.exercises.forEach(function (ref) { alreadyAdded.add(getExerciseId(ref)); });
    }

    var filtered = exerciseLibrary.filter(function (ex) {
      if (alreadyAdded.has(ex.id)) return false;
      if (pickerFilter !== 'All' && ex.bodyPart !== pickerFilter) return false;
      if (searchLower && ex.name.toLowerCase().indexOf(searchLower) === -1) return false;
      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = '<div class="picker-empty">' +
        (exerciseLibrary.length === 0 ? 'No exercises yet. Add some in the Exercises tab.' : 'No matching exercises.') +
        '</div>';
      return;
    }

    var h = '';
    filtered.forEach(function (ex) {
      h += '<div class="picker-item" data-pick-ex="' + ex.id + '">';
      h += '<div>';
      h += '<div class="picker-item-name">' + esc(ex.name) + '</div>';
      if (ex.bodyPart) h += '<div class="picker-item-bodypart">' + esc(ex.bodyPart) + '</div>';
      h += '</div>';
      h += '</div>';
    });
    container.innerHTML = h;
  }

  document.getElementById('pickerClose').addEventListener('click', closeExercisePicker);
  document.getElementById('exercisePickerOverlay').addEventListener('click', function (e) {
    if (e.target === e.currentTarget) closeExercisePicker();
  });

  document.getElementById('pickerSearch').addEventListener('input', function () {
    pickerSearchTerm = this.value;
    renderPickerList();
  });

  document.getElementById('pickerFilters').addEventListener('click', function (e) {
    var chip = e.target.closest('[data-bp]');
    if (!chip) return;
    pickerFilter = chip.dataset.bp;
    renderPickerFilters();
    renderPickerList();
  });

  document.getElementById('pickerList').addEventListener('click', function (e) {
    var item = e.target.closest('[data-pick-ex]');
    if (!item) return;
    var exId = item.dataset.pickEx;
    var day = program.days.find(function (d) { return d.id === pickerTargetDayId; });
    if (!day) return;
    day.exercises.push({
      libraryExerciseId: exId,
      targetSets: 3,
      targetReps: 10,
      targetRestSeconds: 90
    });
    saveAndRenderProgram();
    closeExercisePicker();
    toast('Exercise added to ' + day.name);
  });

  // ── Exercises tab ──

  var exerciseDetailId = null;
  var exercisesFilter = 'All';
  var exercisesSearchTerm = '';
  var editingPhotoExId = null;

  function renderExercises() {
    var container = views.exercises;

    if (exerciseDetailId) {
      var lib = getLibraryExercise(exerciseDetailId);
      if (lib) {
        renderExerciseDetail(container, lib);
        return;
      }
      exerciseDetailId = null;
    }

    renderExerciseList(container);
  }

  function renderExerciseList(container) {
    var searchLower = exercisesSearchTerm.toLowerCase();
    var filtered = exerciseLibrary.filter(function (ex) {
      if (exercisesFilter !== 'All' && ex.bodyPart !== exercisesFilter) return false;
      if (searchLower && ex.name.toLowerCase().indexOf(searchLower) === -1) return false;
      return true;
    });

    var h = '<div class="exercises-header">';
    h += '<input type="search" class="exercises-search" id="exercisesSearch" placeholder="Search exercises..." value="' + esc(exercisesSearchTerm) + '">';
    h += '<div class="bodypart-filters" id="exercisesFilters">';
    h += '<button class="bodypart-chip' + (exercisesFilter === 'All' ? ' active' : '') + '" data-bp="All">All</button>';
    BODY_PARTS.forEach(function (bp) {
      h += '<button class="bodypart-chip' + (exercisesFilter === bp ? ' active' : '') + '" data-bp="' + bp + '">' + esc(bp) + '</button>';
    });
    h += '</div></div>';

    if (filtered.length === 0) {
      h += '<div class="empty-state"><p>' + (exerciseLibrary.length === 0 ? 'No exercises yet.' : 'No matching exercises.') + '</p></div>';
    } else {
      filtered.forEach(function (ex) {
        h += '<div class="exercise-list-item" data-action="open-exercise" data-ex-id="' + ex.id + '">';
        if (ex.imageIds && ex.imageIds.length > 0) {
          h += '<img class="exercise-list-thumb" data-thumb-for="' + ex.id + '" data-first-image="' + ex.imageIds[0] + '" src="" alt="">';
        } else {
          h += '<div class="exercise-list-thumb-placeholder">🏋</div>';
        }
        h += '<div class="exercise-list-info">';
        h += '<div class="exercise-list-name">' + esc(ex.name) + '</div>';
        if (ex.bodyPart) h += '<div class="exercise-list-bodypart">' + esc(ex.bodyPart) + '</div>';
        h += '</div>';
        h += '<span class="exercise-list-chevron">▶</span>';
        h += '</div>';
      });
    }

    h += '<button class="btn-add-day" data-action="add-library-ex" style="margin-top:12px">+ Add Exercise</button>';

    container.innerHTML = h;
    attachExerciseListEvents(container);
    loadExerciseListThumbs(container);
  }

  function loadExerciseListThumbs(container) {
    container.querySelectorAll('[data-first-image]').forEach(function (el) {
      getImageURL(el.dataset.firstImage).then(function (url) {
        if (url) el.src = url;
      });
    });
  }

  function attachExerciseListEvents(container) {
    container.removeEventListener('click', handleExerciseListClick);
    container.addEventListener('click', handleExerciseListClick);

    var searchInput = document.getElementById('exercisesSearch');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        exercisesSearchTerm = this.value;
        renderExercises();
      });
    }
  }

  function handleExerciseListClick(e) {
    var chip = e.target.closest('[data-bp]');
    if (chip) {
      exercisesFilter = chip.dataset.bp;
      renderExercises();
      return;
    }

    var btn = e.target.closest('[data-action]');
    if (!btn) return;

    if (btn.dataset.action === 'open-exercise') {
      exerciseDetailId = btn.dataset.exId;
      renderExercises();
      return;
    }

    if (btn.dataset.action === 'add-library-ex') {
      var newEx = {
        id: 'ex_' + uid(),
        name: 'New Exercise',
        bodyPart: '',
        videoUrl: '',
        description: '',
        imageIds: []
      };
      exerciseLibrary.push(newEx);
      saveJSON(KEYS.exerciseLibrary, exerciseLibrary);
      exerciseDetailId = newEx.id;
      renderExercises();
      return;
    }
  }

  function renderExerciseDetail(container, lib) {
    var h = '';
    h += '<div class="exercise-detail">';
    h += '<button class="exercise-detail-back" data-action="back-to-list">◀ Back</button>';

    h += '<div class="exercise-detail-field">';
    h += '<div class="exercise-detail-label">Name</div>';
    h += '<input class="exercise-detail-input" data-field="name" value="' + esc(lib.name) + '">';
    h += '</div>';

    h += '<div class="exercise-detail-field">';
    h += '<div class="exercise-detail-label">Body Part</div>';
    h += '<select class="exercise-detail-select" data-field="bodyPart">';
    h += '<option value=""' + (!lib.bodyPart ? ' selected' : '') + '>Not set</option>';
    BODY_PARTS.forEach(function (bp) {
      h += '<option value="' + bp + '"' + (lib.bodyPart === bp ? ' selected' : '') + '>' + bp + '</option>';
    });
    h += '</select>';
    h += '</div>';

    h += '<div class="exercise-detail-field">';
    h += '<div class="exercise-detail-label">Video URL</div>';
    h += '<input class="exercise-detail-input" data-field="videoUrl" value="' + esc(lib.videoUrl || '') + '" placeholder="https://...">';
    h += '</div>';

    h += '<div class="exercise-detail-field">';
    h += '<div class="exercise-detail-label">Description</div>';
    h += '<textarea class="exercise-detail-textarea" data-field="description" rows="3" placeholder="Form cues, setup notes...">' + esc(lib.description || '') + '</textarea>';
    h += '</div>';

    h += '<div class="exercise-detail-field">';
    h += '<div class="exercise-detail-label">Photos</div>';
    h += '<div class="photo-strip" id="photoStrip">';
    (lib.imageIds || []).forEach(function (imgId) {
      h += '<div class="photo-thumb-wrap">';
      h += '<img class="photo-thumb" data-image-id="' + imgId + '" data-action="view-image" src="" alt="">';
      h += '<button class="photo-remove" data-action="remove-photo" data-image-id="' + imgId + '">&times;</button>';
      h += '</div>';
    });
    h += '<button class="btn-add-photo" data-action="add-photo">+</button>';
    h += '</div>';
    h += '</div>';

    h += '<button class="btn-delete-exercise" data-action="delete-library-ex" data-ex="' + lib.id + '">Delete Exercise</button>';
    h += '</div>';

    container.innerHTML = h;
    attachExerciseDetailEvents(container);
    loadDetailPhotos(container);
  }

  function loadDetailPhotos(container) {
    container.querySelectorAll('.photo-thumb[data-image-id]').forEach(function (el) {
      getImageURL(el.dataset.imageId).then(function (url) {
        if (url) el.src = url;
      });
    });
  }

  function attachExerciseDetailEvents(container) {
    container.removeEventListener('click', handleExerciseDetailClick);
    container.addEventListener('click', handleExerciseDetailClick);
    container.removeEventListener('change', handleExerciseDetailChange);
    container.addEventListener('change', handleExerciseDetailChange);
    container.removeEventListener('input', handleExerciseDetailInput);
    container.addEventListener('input', handleExerciseDetailInput);
  }

  function handleExerciseDetailClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;

    if (btn.dataset.action === 'back-to-list') {
      exerciseDetailId = null;
      renderExercises();
      return;
    }

    if (btn.dataset.action === 'view-image') {
      openImageViewer(btn.dataset.imageId);
      return;
    }

    if (btn.dataset.action === 'add-photo') {
      editingPhotoExId = exerciseDetailId;
      document.getElementById('exercisePhotoInput').click();
      return;
    }

    if (btn.dataset.action === 'remove-photo') {
      var imgId = btn.dataset.imageId;
      var lib = getLibraryExercise(exerciseDetailId);
      if (!lib) return;
      lib.imageIds = lib.imageIds.filter(function (id) { return id !== imgId; });
      saveJSON(KEYS.exerciseLibrary, exerciseLibrary);
      deleteImage(imgId);
      imageURLCache.delete(imgId);
      renderExercises();
      return;
    }

    if (btn.dataset.action === 'delete-library-ex') {
      var exId = btn.dataset.ex;
      // Check if referenced by any day
      var usedBy = [];
      program.days.forEach(function (day) {
        day.exercises.forEach(function (ref) {
          if (getExerciseId(ref) === exId) usedBy.push(day.name);
        });
      });
      if (usedBy.length > 0) {
        toast('Remove from ' + usedBy.join(', ') + ' first');
        return;
      }
      confirm('Delete Exercise', 'Permanently delete this exercise from your library?').then(function (ok) {
        if (!ok) return;
        var libEx = getLibraryExercise(exId);
        if (libEx && libEx.imageIds) {
          libEx.imageIds.forEach(function (imgId) {
            deleteImage(imgId);
            imageURLCache.delete(imgId);
          });
        }
        exerciseLibrary = exerciseLibrary.filter(function (e) { return e.id !== exId; });
        saveJSON(KEYS.exerciseLibrary, exerciseLibrary);
        exerciseDetailId = null;
        renderExercises();
        toast('Exercise deleted');
      });
      return;
    }
  }

  function handleExerciseDetailChange(e) {
    var field = e.target.dataset.field;
    if (!field) return;
    var lib = getLibraryExercise(exerciseDetailId);
    if (!lib) return;
    lib[field] = e.target.value;
    saveJSON(KEYS.exerciseLibrary, exerciseLibrary);
  }

  function handleExerciseDetailInput(e) {
    var field = e.target.dataset.field;
    if (!field) return;
    var lib = getLibraryExercise(exerciseDetailId);
    if (!lib) return;
    lib[field] = e.target.value;
    saveJSON(KEYS.exerciseLibrary, exerciseLibrary);
  }

  // Photo file input handler
  document.getElementById('exercisePhotoInput').addEventListener('change', function (e) {
    var files = Array.from(e.target.files);
    if (files.length === 0) return;
    var targetExId = editingPhotoExId;
    var lib = getLibraryExercise(targetExId);
    if (!lib) return;

    var pending = files.map(function (file) {
      return resizeImage(file).then(function (blob) {
        var imgId = 'img_' + uid();
        return saveImage(imgId, blob).then(function () {
          lib.imageIds = lib.imageIds || [];
          lib.imageIds.push(imgId);
          return imgId;
        });
      });
    });

    Promise.all(pending).then(function () {
      saveJSON(KEYS.exerciseLibrary, exerciseLibrary);
      if (exerciseDetailId === targetExId) renderExercises();
    }).catch(function () {
      toast('Failed to add photo');
    });

    e.target.value = '';
  });

  // ── Settings tab ──

  function renderSettings() {
    var container = views.settings;
    var html = '<div class="data-actions">';

    // Share section
    html += '<div class="section-label">Share</div>';
    html += '<button class="btn-action" data-action="share-app"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="5" height="5"/><rect x="10" y="1" width="5" height="5"/><rect x="1" y="10" width="5" height="5"/><rect x="10" y="10" width="2" height="2"/><line x1="15" y1="10" x2="15" y2="15"/><line x1="10" y1="15" x2="15" y2="15"/></svg> Share App</button>';

    // Program section
    html += '<div class="section-label">Program</div>';
    html += '<div class="button-row">';
    html += '<button class="btn-action" data-action="show-qr"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="5" height="5"/><rect x="10" y="1" width="5" height="5"/><rect x="1" y="10" width="5" height="5"/><rect x="10" y="10" width="2" height="2"/><line x1="15" y1="10" x2="15" y2="15"/><line x1="10" y1="15" x2="15" y2="15"/></svg> Show QR</button>';
    html += '<button class="btn-action" data-action="scan-qr"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,5 1,1 5,1"/><polyline points="11,1 15,1 15,5"/><polyline points="15,11 15,15 11,15"/><polyline points="5,15 1,15 1,11"/><circle cx="8" cy="8" r="2"/></svg> Scan QR</button>';
    html += '</div>';
    html += '<div class="button-row">';
    html += '<button class="btn-action" data-action="share-program"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10v4h12v-4"/><polyline points="8,2 8,11"/><polyline points="5,8 8,11 11,8"/></svg> Export File</button>';
    html += '<button class="btn-action" data-action="import-program"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10v4h12v-4"/><polyline points="8,11 8,2"/><polyline points="5,5 8,2 11,5"/></svg> Import File</button>';
    html += '</div>';

    // Data section
    html += '<div class="section-label">Data</div>';
    html += '<div class="button-row">';
    html += '<button class="btn-action" data-action="export"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="2"/><polyline points="8,5 8,11"/><polyline points="5.5,8.5 8,11 10.5,8.5"/></svg> Backup Data</button>';
    html += '<button class="btn-action" data-action="import"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="2"/><polyline points="8,11 8,5"/><polyline points="5.5,7.5 8,5 10.5,7.5"/></svg> Restore Data</button>';
    html += '</div>';
    html += '<button class="btn-action danger" data-action="clear-all"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,4 13,4"/><path d="M6,4V2.5h4V4"/><path d="M4,4v10.5h8V4"/><line x1="7" y1="7" x2="7" y2="12"/><line x1="9" y1="7" x2="9" y2="12"/></svg> Clear All Data</button>';
    html += '</div>';

    if (shouldShowBackupReminder()) {
      html += '<div class="backup-reminder" id="backupReminder">';
      html += '<span>Haven\'t backed up in a while — export your data?</span>';
      html += '<div class="backup-reminder-actions">';
      html += '<button class="btn-action" data-action="export" style="flex:1">Export Now</button>';
      html += '<button class="btn-reminder-dismiss" data-action="dismiss-reminder">&times;</button>';
      html += '</div></div>';
    }

    container.innerHTML = html;

    container.removeEventListener('click', handleSettingsClick);
    container.addEventListener('click', handleSettingsClick);
  }

  function showAppQR() {
    var appUrl = window.location.origin + window.location.pathname;
    var qr = QR.encode(appUrl);
    if (!qr) { toast('URL too long for QR code'); return; }

    var content = document.getElementById('qrContent');
    content.innerHTML = '';
    var canvas = document.createElement('canvas');
    QR.toCanvas(qr, canvas, 6);
    content.appendChild(canvas);

    var info = document.createElement('div');
    info.className = 'dialog-message';
    info.textContent = 'Scan to install Ironclad on another device.';
    content.appendChild(info);

    document.getElementById('qrTitle').textContent = 'Share App';
    document.getElementById('qrOverlay').classList.add('open');
  }

  function handleSettingsClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;

    if (action === 'share-app') { showAppQR(); return; }
    if (action === 'show-qr') { showProgramQR(); return; }
    if (action === 'scan-qr') { openScanner(); return; }
    if (action === 'share-program') { shareProgram(); return; }
    if (action === 'import-program') { document.getElementById('importProgramInput').click(); return; }
    if (action === 'export') { exportData(); return; }
    if (action === 'import') { document.getElementById('importInput').click(); return; }
    if (action === 'dismiss-reminder') {
      reminderDismissed = true;
      var rem = document.getElementById('backupReminder');
      if (rem) rem.remove();
      return;
    }
    if (action === 'clear-all') {
      confirm('Clear All Data', 'This will delete your entire program, exercise library, and all session history. This cannot be undone.', 'Clear All').then(function (ok) {
        if (!ok) return;
        localStorage.removeItem(KEYS.program);
        localStorage.removeItem(KEYS.sessions);
        localStorage.removeItem(KEYS.selectedDay);
        localStorage.removeItem(KEYS.exerciseLibrary);
        exerciseLibrary = defaultExerciseLibrary();
        saveJSON(KEYS.exerciseLibrary, exerciseLibrary);
        program = defaultProgram();
        saveJSON(KEYS.program, program);
        sessions = [];
        saveJSON(KEYS.sessions, sessions);
        selectedDayId = autoSelectDay();
        localStorage.setItem(KEYS.selectedDay, selectedDayId || '');
        focusExerciseId = null;
        timers.clear();
        stopTimerTick();
        openImageDB().then(function (db) {
          var tx = db.transaction(IMAGE_STORE, 'readwrite');
          tx.objectStore(IMAGE_STORE).clear();
        });
        imageURLCache.clear();
        renderDayChips();
        renderSettings();
        toast('Data cleared, defaults restored');
      });
    }
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

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result.split(',')[1]); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(b64, type) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: type || 'image/jpeg' });
  }

  function collectLibraryImages() {
    var allIds = new Set();
    exerciseLibrary.forEach(function (ex) {
      (ex.imageIds || []).forEach(function (id) { allIds.add(id); });
    });
    if (allIds.size === 0) return Promise.resolve({});
    return getAllImages().then(function (records) {
      var map = {};
      var promises = [];
      records.forEach(function (rec) {
        if (allIds.has(rec.id)) {
          promises.push(blobToBase64(rec.blob).then(function (b64) { map[rec.id] = b64; }));
        }
      });
      return Promise.all(promises).then(function () { return map; });
    });
  }

  function collectReferencedImages(libEntries) {
    var allIds = new Set();
    libEntries.forEach(function (ex) {
      (ex.imageIds || []).forEach(function (id) { allIds.add(id); });
    });
    if (allIds.size === 0) return Promise.resolve({});
    return getAllImages().then(function (records) {
      var map = {};
      var promises = [];
      records.forEach(function (rec) {
        if (allIds.has(rec.id)) {
          promises.push(blobToBase64(rec.blob).then(function (b64) { map[rec.id] = b64; }));
        }
      });
      return Promise.all(promises).then(function () { return map; });
    });
  }

  function exportData() {
    collectLibraryImages().then(function (images) {
      var data = {
        ironclad: true,
        ironlog: true,
        version: 3,
        exportedAt: new Date().toISOString(),
        program: program,
        sessions: sessions,
        exerciseLibrary: exerciseLibrary,
        images: images
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
    });
  }

  function shareProgram() {
    // Collect library entries referenced by this program
    var referencedIds = new Set();
    program.days.forEach(function (day) {
      day.exercises.forEach(function (ref) { referencedIds.add(getExerciseId(ref)); });
    });
    var referencedLib = exerciseLibrary.filter(function (ex) { return referencedIds.has(ex.id); });

    collectReferencedImages(referencedLib).then(function (images) {
      var data = {
        ironclad: true,
        type: 'program',
        version: 3,
        exportedAt: new Date().toISOString(),
        program: program,
        exerciseLibrary: referencedLib,
        images: images
      };
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'ironclad-program-' + todayISO() + '.json';
      a.click();
      URL.revokeObjectURL(url);
      markExported();
      toast('Program exported');
    });
  }

  function importProgramFromData(prog, importedLib, importedImages) {
    confirm(
      'Import Program',
      'This replaces your current program (days & exercises). Your logged history is not affected.',
      'Replace Program'
    ).then(function (ok) {
      if (!ok) return;

      // Import library entries (merge by id, add new ones)
      if (importedLib && importedLib.length > 0) {
        var existingIds = new Set(exerciseLibrary.map(function (e) { return e.id; }));
        importedLib.forEach(function (ex) {
          var normalized = {
            id: ex.id || 'ex_' + uid(),
            name: ex.name || 'Exercise',
            bodyPart: ex.bodyPart || '',
            videoUrl: ex.videoUrl || '',
            description: ex.description || ex.howTo || '',
            imageIds: ex.imageIds || []
          };
          if (existingIds.has(normalized.id)) {
            var idx = exerciseLibrary.findIndex(function (e) { return e.id === normalized.id; });
            exerciseLibrary[idx] = normalized;
          } else {
            exerciseLibrary.push(normalized);
          }
        });
        saveJSON(KEYS.exerciseLibrary, exerciseLibrary);
      }

      // Import images
      if (importedImages) {
        var imgPromises = Object.keys(importedImages).map(function (imgId) {
          var blob = base64ToBlob(importedImages[imgId]);
          return saveImage(imgId, blob);
        });
        Promise.all(imgPromises).catch(function () {});
      }

      // Build new program with references
      var newProg = { days: [] };
      prog.days.forEach(function (day) {
        var newDay = {
          id: 'day_' + uid(),
          name: day.name || 'Imported Day',
          dayOfWeek: day.dayOfWeek != null ? day.dayOfWeek : null,
          exercises: []
        };
        (day.exercises || []).forEach(function (ex) {
          if (ex.libraryExerciseId) {
            // Already in new format
            newDay.exercises.push({
              libraryExerciseId: ex.libraryExerciseId,
              targetSets: ex.targetSets || 3,
              targetReps: ex.targetReps || 10,
              targetRestSeconds: ex.targetRestSeconds != null ? ex.targetRestSeconds : 90
            });
          } else {
            // Old format — create library entry if not already imported
            var libExId = ex.id || 'ex_' + uid();
            if (!getLibraryExercise(libExId)) {
              exerciseLibrary.push({
                id: libExId,
                name: ex.name || 'Exercise',
                bodyPart: '',
                videoUrl: '',
                description: ex.howTo || '',
                imageIds: []
              });
            }
            newDay.exercises.push({
              libraryExerciseId: libExId,
              targetSets: ex.targetSets || 3,
              targetReps: ex.targetReps || 10,
              targetRestSeconds: ex.targetRestSeconds != null ? ex.targetRestSeconds : 90
            });
          }
        });
        newProg.days.push(newDay);
      });

      saveJSON(KEYS.exerciseLibrary, exerciseLibrary);
      program = newProg;
      saveJSON(KEYS.program, program);
      selectedDayId = autoSelectDay();
      localStorage.setItem(KEYS.selectedDay, selectedDayId || '');
      focusExerciseId = null;
      renderDayChips();
      renderProgram();
      toast('Program imported');
    });
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
        importProgramFromData(prog, data.exerciseLibrary || null, data.images || null);
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

        // Import exercise library if present
        if (data.exerciseLibrary && Array.isArray(data.exerciseLibrary)) {
          exerciseLibrary = data.exerciseLibrary.map(function (ex) {
            return {
              id: ex.id,
              name: ex.name || '',
              bodyPart: ex.bodyPart || '',
              videoUrl: ex.videoUrl || '',
              description: ex.description || '',
              imageIds: ex.imageIds || []
            };
          });
          saveJSON(KEYS.exerciseLibrary, exerciseLibrary);
        }

        // Import images if present
        if (data.images) {
          var imgPromises = Object.keys(data.images).map(function (imgId) {
            var blob = base64ToBlob(data.images[imgId]);
            return saveImage(imgId, blob);
          });
          Promise.all(imgPromises).catch(function () {});
        }

        if (data.program) {
          program = data.program;
          // Handle old-format programs in backup files
          if (program.days && program.days.length > 0) {
            var firstDay = program.days.find(function (d) { return d.exercises && d.exercises.length > 0; });
            if (firstDay && firstDay.exercises[0].name && !firstDay.exercises[0].libraryExerciseId) {
              migrateToExerciseLibrary(program);
              exerciseLibrary = loadJSON(KEYS.exerciseLibrary, []);
            }
          }
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

  // ── QR sharing ──

  function buildQRPayload() {
    return JSON.stringify({
      d: program.days.map(function (day) {
        return {
          n: day.name,
          w: day.dayOfWeek,
          e: day.exercises.map(function (ref) {
            var lib = getLibraryExercise(getExerciseId(ref));
            return { n: lib ? lib.name : 'Exercise', s: ref.targetSets, r: ref.targetReps, t: ref.targetRestSeconds || 90 };
          })
        };
      })
    });
  }

  function parseQRPayload(text) {
    var data = JSON.parse(text);
    if (!data.d || !Array.isArray(data.d)) return null;
    return {
      days: data.d.map(function (day) {
        if (!day.e || !Array.isArray(day.e)) throw new Error('Invalid');
        return {
          name: day.n || 'Day',
          dayOfWeek: day.w != null ? day.w : null,
          exercises: day.e.map(function (ex) {
            return {
              name: ex.n || 'Exercise',
              targetSets: ex.s || 3,
              targetReps: ex.r || 10,
              targetRestSeconds: ex.t != null ? ex.t : 90
            };
          })
        };
      })
    };
  }

  function showProgramQR() {
    var payload = buildQRPayload();
    var qr = QR.encode(payload);
    if (!qr) { toast('Program too large for QR code'); return; }

    var content = document.getElementById('qrContent');
    content.innerHTML = '';
    var canvas = document.createElement('canvas');
    QR.toCanvas(qr, canvas, 6);
    content.appendChild(canvas);

    var info = document.createElement('div');
    info.className = 'dialog-message';
    info.textContent = 'Scan this from another device to import your program.';
    content.appendChild(info);

    document.getElementById('qrOverlay').classList.add('open');
  }

  document.getElementById('qrClose').addEventListener('click', function () {
    document.getElementById('qrOverlay').classList.remove('open');
  });
  document.getElementById('qrOverlay').addEventListener('click', function (e) {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
  });

  // ── QR Scanner ──

  var scannerStream = null;
  var scannerInterval = null;

  function openScanner() {
    if (typeof BarcodeDetector === 'undefined') {
      toast('QR scanning not supported — use Import Program instead');
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(function (stream) {
        scannerStream = stream;
        var video = document.getElementById('scannerVideo');
        video.srcObject = stream;
        document.getElementById('scannerOverlay').classList.add('open');
        document.getElementById('scannerStatus').textContent = 'Point camera at a QR code';

        var detector = new BarcodeDetector({ formats: ['qr_code'] });
        scannerInterval = setInterval(function () {
          if (video.readyState < 2) return;
          detector.detect(video).then(function (barcodes) {
            if (barcodes.length > 0) {
              var text = barcodes[0].rawValue;
              closeScanner();
              handleScannedQR(text);
            }
          }).catch(function () {});
        }, 250);
      })
      .catch(function () {
        toast('Camera access denied — use Import Program instead');
      });
  }

  function closeScanner() {
    if (scannerInterval) { clearInterval(scannerInterval); scannerInterval = null; }
    if (scannerStream) { scannerStream.getTracks().forEach(function (t) { t.stop(); }); scannerStream = null; }
    document.getElementById('scannerVideo').srcObject = null;
    document.getElementById('scannerOverlay').classList.remove('open');
  }

  function handleScannedQR(text) {
    try {
      var prog = parseQRPayload(text);
      if (!prog) throw new Error('Invalid');

      var importData = { days: prog.days.map(function (d) { return { name: d.name, dayOfWeek: d.dayOfWeek, exercises: d.exercises }; }) };
      importProgramFromData(importData, null, null);
    } catch (e) {
      toast('Not a valid Ironclad QR code');
    }
  }

  document.getElementById('scannerClose').addEventListener('click', closeScanner);

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
