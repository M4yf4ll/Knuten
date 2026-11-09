/* Ungdomsgården Knuten – inskrivningssystem
 * Förnamnet sparas aldrig – det används bara för att hälsa besökaren välkommen.
 * Endast anonym, sammanräknad dagsstatistik lagras i localStorage.
 */
(function () {
    'use strict';

    // ---------- Inställningar ----------
    var RETENTION_DAYS = 92;               // Statistik sparas i 92 dagar, sedan raderas den automatiskt
    var KEY_PREFIX = 'knuten-v2-';         // Nyckelprefix för dagsstatistik
    var NAMES_PREFIX = 'knuten-names-';    // Förnamn sparas inte – äldre namnlistor städas bort
    var CONFIG_KEY = 'knuten-config';      // PIN-konfiguration
    var SESSION_KEY = 'knuten-staff-unlocked';
    var LAST_REG_KEY = 'knuten-last-reg';  // För "ångra senaste registrering"
    var DEFAULT_PIN = '1234';              // Byt direkt via "Ändra PIN-kod"!
    var DAY_MS = 24 * 60 * 60 * 1000;

    var ALLOWED_AGES = ['16', '17-18', '19-20'];
    var ALLOWED_GENDERS = ['Kille', 'Tjej', 'Annan'];
    var ALLOWED_MUNICIPALITIES = [
        'Brändö', 'Eckerö', 'Finström', 'Föglö', 'Geta', 'Hammarland',
        'Jomala', 'Kumlinge', 'Kökar', 'Lemland', 'Lumparland',
        'Mariehamn', 'Saltvik', 'Sottunga', 'Sund', 'Vårdö'
    ];
    var AGE_LABELS = { '16': '16 år', '17-18': '17–18 år', '19-20': '19–20 år' };
    var NAME_RE = /^[\p{L}][\p{L}\s'\-]{0,29}$/u;   // Bokstäver (även å/ä/ö), mellanslag, apostrof, bindestreck

    // ---------- Tillstånd ----------
    var todayKey = dateKey(new Date());
    var viewDate = todayKey;
    var stats = emptyStats();
    var lastRegistration = null;
    var storageOk = true;
    var pinMode = 'verify';
    var pinCallback = null;

    // ---------- Hjälpfunktioner ----------
    function dateKey(d) {
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return d.getFullYear() + '-' + m + '-' + day;
    }

    function emptyStats() {
        return { total: 0, genderCount: {}, ageGroups: {}, municipalityCount: {} };
    }

    function isValidStats(o) {
        if (!o || typeof o !== 'object') return false;
        if (typeof o.total !== 'number' || o.total < 0) return false;
        var groups = [o.genderCount, o.ageGroups, o.municipalityCount];
        for (var i = 0; i < groups.length; i++) {
            var g = groups[i];
            if (!g || typeof g !== 'object') return false;
            for (var k in g) {
                if (typeof g[k] !== 'number' || g[k] < 0) return false;
            }
        }
        return true;
    }

    function bump(obj, key) {
        var copy = Object.assign({}, obj);
        copy[key] = (copy[key] || 0) + 1;
        return copy;
    }

    function drop(obj, key) {
        var copy = Object.assign({}, obj);
        copy[key] = (copy[key] || 0) - 1;
        if (copy[key] <= 0) delete copy[key];
        return copy;
    }

    function val(id) {
        var el = document.getElementById(id);
        return el ? el.value : '';
    }

    function setText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function bind(id, fn) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    }

    // ---------- Lagring ----------
    function loadDay(key) {
        try {
            var raw = localStorage.getItem(KEY_PREFIX + key);
            if (!raw) return emptyStats();
            var parsed = JSON.parse(raw);
            return isValidStats(parsed) ? parsed : emptyStats();
        } catch (e) {
            return emptyStats();
        }
    }

    function saveDay(key, data) {
        localStorage.setItem(KEY_PREFIX + key, JSON.stringify(data));
    }

    function listDays() {
        var days = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf(KEY_PREFIX) === 0) {
                    days.push(k.substring(KEY_PREFIX.length));
                }
            }
        } catch (e) { /* ignorera */ }
        return days.sort();
    }

    // Flyttar över gammal dagsdata (knuten-stats-) till nya formatet och
    // raderar data som är äldre än RETENTION_DAYS. Dagens data rörs aldrig.
    function migrateAndPrune() {
        try {
            var legacyToday = localStorage.getItem('knuten-stats-' + todayKey);
            if (legacyToday && !localStorage.getItem(KEY_PREFIX + todayKey)) {
                var parsed = JSON.parse(legacyToday);
                if (isValidStats(parsed)) saveDay(todayKey, parsed);
            }
        } catch (e) { /* migrering är bästa möjliga */ }

        try {
            var toRemove = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k) continue;
                if (k.indexOf('knuten-stats-') === 0 || k.indexOf('knuten-entries-') === 0) {
                    toRemove.push(k);
                } else if (k.indexOf(NAMES_PREFIX) === 0) {
                    // Förnamn sparas inte längre – radera alla eventuella gamla namnlistor
                    toRemove.push(k);
                } else if (k.indexOf(KEY_PREFIX) === 0) {
                    var day = k.substring(KEY_PREFIX.length);
                    var ageMs = Date.now() - new Date(day + 'T00:00:00').getTime();
                    if (ageMs > RETENTION_DAYS * DAY_MS) toRemove.push(k);
                }
            }
            toRemove.forEach(function (key) { localStorage.removeItem(key); });
        } catch (e) { /* ignorera */ }
    }

    // ---------- PIN-kod ----------
    // Enkel hash (djb2) – avsedd som enkel spärr på kiosk-enhet,
    // inte som kryptografiskt skydd.
    function hashPin(pin, salt) {
        var s = salt + '|' + pin;
        var h = 5381;
        for (var i = 0; i < s.length; i++) {
            h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
        }
        return String(h);
    }

    function getConfig() {
        try {
            var raw = localStorage.getItem(CONFIG_KEY);
            if (raw) {
                var c = JSON.parse(raw);
                if (c && typeof c.salt === 'string' && typeof c.pinHash === 'string') return c;
            }
        } catch (e) { /* faller vidare till standard */ }
        var cfg = { salt: String(Math.floor(Math.random() * 1e9)), pinHash: '' };
        cfg.pinHash = hashPin(DEFAULT_PIN, cfg.salt);
        try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch (e) { /* ignorera */ }
        return cfg;
    }

    function checkPin(pin) {
        var cfg = getConfig();
        return hashPin(pin, cfg.salt) === cfg.pinHash;
    }

    function isUnlocked() {
        try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch (e) { return false; }
    }

    function setUnlocked(v) {
        try {
            if (v) sessionStorage.setItem(SESSION_KEY, '1');
            else sessionStorage.removeItem(SESSION_KEY);
        } catch (e) { /* ignorera */ }
    }

    // ---------- Toast ----------
    function toast(message, type) {
        var container = document.getElementById('toastContainer');
        if (!container) return;
        var el = document.createElement('div');
        el.className = 'toast ' + (type || 'info');
        el.textContent = message;
        container.appendChild(el);
        setTimeout(function () { el.classList.add('show'); }, 10);
        setTimeout(function () {
            el.classList.remove('show');
            setTimeout(function () { el.remove(); }, 300);
        }, 3500);
    }

    // ---------- PIN-dialog ----------
    function openPinModal(mode, message, callback) {
        pinMode = mode;
        pinCallback = callback || null;
        var modal = document.getElementById('pinModal');
        if (!modal) return;
        setText('pinTitle', mode === 'change' ? 'Ändra PIN-kod' : 'PIN-kod krävs');
        setText('pinMessage', message || '');
        setText('pinInputLabel', mode === 'change' ? 'Nuvarande PIN-kod' : 'PIN-kod');
        var newGroup = document.getElementById('pinNewGroup');
        if (newGroup) newGroup.classList.toggle('hidden', mode !== 'change');
        var input = document.getElementById('pinInput');
        var newInput = document.getElementById('pinNewInput');
        if (input) input.value = '';
        if (newInput) newInput.value = '';
        modal.classList.remove('hidden');
        if (input) input.focus();
    }

    function closePinModal() {
        var modal = document.getElementById('pinModal');
        if (modal) modal.classList.add('hidden');
        pinCallback = null;
    }

    function handlePinOk() {
        var input = document.getElementById('pinInput');
        if (!input) return;
        var pin = input.value;

        if (pinMode === 'verify') {
            if (!checkPin(pin)) {
                toast('Fel PIN-kod.', 'error');
                input.value = '';
                input.focus();
                return;
            }
            var cb = pinCallback;
            setUnlocked(true);
            closePinModal();
            toast('🔓 Personalvyn är upplåst.', 'success');
            render();
            if (cb) cb();
        } else {
            if (!checkPin(pin)) {
                toast('Nuvarande PIN-kod är fel.', 'error');
                input.value = '';
                input.focus();
                return;
            }
            var newInput = document.getElementById('pinNewInput');
            var newPin = newInput ? newInput.value : '';
            if (!/^\d{4,8}$/.test(newPin)) {
                toast('Ny PIN måste vara 4–8 siffror.', 'error');
                if (newInput) newInput.focus();
                return;
            }
            var cfg = getConfig();
            cfg.pinHash = hashPin(newPin, cfg.salt);
            try {
                localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
                closePinModal();
                toast('✅ PIN-koden har ändrats.', 'success');
            } catch (e) {
                toast('Kunde inte spara den nya PIN-koden.', 'error');
            }
        }
    }

    function handlePinKey(e) {
        if (e.key === 'Enter') handlePinOk();
        else if (e.key === 'Escape') closePinModal();
    }

    function handleStaffBtn() {
        if (!storageOk) {
            toast('Lagring fungerar inte i den här webbläsaren.', 'error');
            return;
        }
        if (isUnlocked()) {
            setUnlocked(false);
            render();
            toast('🔒 Personalvyn har låsts.', 'info');
        } else {
            openPinModal('verify', 'Ange PIN-kod för att öppna personalvyn.', null);
        }
    }

    // ---------- Valchips ----------
    function initChips(groupId, selectId) {
        var group = document.getElementById(groupId);
        var select = document.getElementById(selectId);
        if (!group || !select) return;
        group.addEventListener('click', function (e) {
            var chip = e.target && e.target.closest ? e.target.closest('.chip') : null;
            if (!chip) return;
            select.value = chip.getAttribute('data-value') || '';
            var chips = group.querySelectorAll('.chip');
            for (var i = 0; i < chips.length; i++) {
                chips[i].classList.remove('selected');
                chips[i].setAttribute('aria-checked', 'false');
            }
            chip.classList.add('selected');
            chip.setAttribute('aria-checked', 'true');
        });
    }

    function clearChips(groupId) {
        var group = document.getElementById(groupId);
        if (!group) return;
        var chips = group.querySelectorAll('.chip');
        for (var i = 0; i < chips.length; i++) {
            chips[i].classList.remove('selected');
            chips[i].setAttribute('aria-checked', 'false');
        }
    }

    // ---------- Konfetti ----------
    function confetti() {
        try {
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        } catch (e) { /* visar konfetti ändå */ }
        var colors = ['#9333ea', '#ec4899', '#fb923c', '#facc15', '#10b981', '#3b82f6'];
        for (var i = 0; i < 60; i++) {
            var el = document.createElement('div');
            el.className = 'confetti';
            var size = 6 + Math.random() * 8;
            el.style.left = (Math.random() * 100) + 'vw';
            el.style.width = size + 'px';
            el.style.height = size * (Math.random() > 0.5 ? 1 : 0.4) + 'px';
            el.style.background = colors[Math.floor(Math.random() * colors.length)];
            if (Math.random() > 0.5) el.style.borderRadius = '50%';
            el.style.animationDuration = (2.2 + Math.random() * 1.8) + 's';
            el.style.animationDelay = (Math.random() * 0.4) + 's';
            document.body.appendChild(el);
            (function (node) {
                setTimeout(function () { node.remove(); }, 4800);
            })(el);
        }
    }

    // ---------- Registrering ----------
    function handleSubmit() {
        if (!storageOk) {
            toast('Lagring fungerar inte – besöket kan inte registreras.', 'error');
            return;
        }

        var name = val('firstname').replace(/\s+/g, ' ').trim();
        var age = val('age');
        var gender = val('gender');
        var municipality = val('municipality');

        if (!name || !age || !gender || !municipality) {
            toast('Vänligen fyll i alla fält.', 'error');
            return;
        }

        if (!NAME_RE.test(name)) {
            toast('Förnamnet innehåller ogiltiga tecken (max 30 tecken).', 'error');
            return;
        }

        if (ALLOWED_AGES.indexOf(age) === -1 ||
            ALLOWED_GENDERS.indexOf(gender) === -1 ||
            ALLOWED_MUNICIPALITIES.indexOf(municipality) === -1) {
            toast('Ogiltiga värden i formuläret.', 'error');
            return;
        }

        var next = {
            total: stats.total + 1,
            genderCount: bump(stats.genderCount, gender),
            ageGroups: bump(stats.ageGroups, age),
            municipalityCount: bump(stats.municipalityCount, municipality)
        };

        try {
            saveDay(todayKey, next);
        } catch (e) {
            toast('Kunde inte spara – besöket registrerades inte.', 'error');
            return;
        }

        stats = next;
        // Förnamnet sparas aldrig – det används bara för hälsningen nedan
        lastRegistration = { age: age, gender: gender, municipality: municipality };
        try {
            localStorage.setItem(LAST_REG_KEY, JSON.stringify({ date: todayKey, reg: lastRegistration }));
        } catch (e) { /* ångra-funktionen fungerar då inte, men besöket är sparat */ }

        var nameEl = document.getElementById('firstname');
        var ageEl = document.getElementById('age');
        var genderEl = document.getElementById('gender');
        var munEl = document.getElementById('municipality');
        if (nameEl) nameEl.value = '';
        if (ageEl) ageEl.value = '';
        if (genderEl) genderEl.value = '';
        if (munEl) munEl.value = '';
        clearChips('ageChips');
        clearChips('genderChips');
        clearChips('municipalityChips');
        if (nameEl) nameEl.focus();

        confetti();
        toast('✅ Tack ' + name + '! Besöket har registrerats.', 'success');
        render();
    }

    function undoLast() {
        if (!lastRegistration || !storageOk) return;
        var reg = lastRegistration;

        var next = {
            total: Math.max(0, stats.total - 1),
            genderCount: drop(stats.genderCount, reg.gender),
            ageGroups: drop(stats.ageGroups, reg.age),
            municipalityCount: drop(stats.municipalityCount, reg.municipality)
        };

        try {
            saveDay(todayKey, next);
        } catch (e) {
            toast('Kunde inte ångra registreringen.', 'error');
            return;
        }

        stats = next;
        lastRegistration = null;
        try { localStorage.removeItem(LAST_REG_KEY); } catch (e) { /* ignorera */ }
        toast('↩️ Senaste registreringen har ångrats.', 'success');
        render();
    }

    function clearToday() {
        if (!storageOk) return;
        var ok = window.confirm('Vill du verkligen radera dagens statistik (' + stats.total + ' besök)?\n\nDetta kan inte ångras. Tips: exportera eller säkerhetskopiera först.');
        if (!ok) return;
        try {
            localStorage.removeItem(KEY_PREFIX + todayKey);
            localStorage.removeItem(NAMES_PREFIX + todayKey); // städar ev. gammal namnlista
            localStorage.removeItem(LAST_REG_KEY);
        } catch (e) { /* ignorera */ }
        stats = emptyStats();
        lastRegistration = null;
        viewDate = todayKey;
        toast('🗑️ Dagens statistik har raderats.', 'success');
        render();
    }

    // ---------- Export & säkerhetskopia ----------
    function csvCell(v) {
        v = String(v);
        if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
        return v;
    }

    function appendCounts(lines, counts, suffix) {
        Object.keys(counts)
            .sort(function (a, b) { return counts[b] - counts[a]; })
            .forEach(function (k) {
                lines.push(csvCell(k + (suffix || '')) + ',' + counts[k]);
            });
    }

    function exportDayCsv() {
        var data = viewDate === todayKey ? stats : loadDay(viewDate);
        if (data.total === 0) {
            toast('Ingen statistik att exportera för ' + viewDate + '.', 'error');
            return;
        }
        var lines = [];
        lines.push('STATISTIK FÖR ' + viewDate);
        lines.push('');
        lines.push('ÖVERSIKT');
        lines.push('Totalt besökare,' + data.total);
        lines.push('');
        lines.push('KÖNSFÖRDELNING');
        appendCounts(lines, data.genderCount);
        lines.push('');
        lines.push('ÅLDERSGRUPPER');
        appendCounts(lines, data.ageGroups, ' år');
        lines.push('');
        lines.push('KOMMUNER');
        appendCounts(lines, data.municipalityCount);
        download(lines.join('\n'), 'knuten-statistik-' + viewDate + '.csv', 'text/csv');
    }

    function exportAllCsv() {
        var days = listDays();
        if (!days.length) {
            toast('Det finns ingen sparad statistik.', 'error');
            return;
        }
        var header = ['Datum', 'Totalt']
            .concat(ALLOWED_GENDERS)
            .concat(ALLOWED_AGES.map(function (a) { return AGE_LABELS[a]; }))
            .concat(ALLOWED_MUNICIPALITIES);
        var lines = [header.map(csvCell).join(',')];
        days.forEach(function (d) {
            var s = loadDay(d);
            var row = [d, s.total];
            ALLOWED_GENDERS.forEach(function (g) { row.push(s.genderCount[g] || 0); });
            ALLOWED_AGES.forEach(function (a) { row.push(s.ageGroups[a] || 0); });
            ALLOWED_MUNICIPALITIES.forEach(function (m) { row.push(s.municipalityCount[m] || 0); });
            lines.push(row.map(csvCell).join(','));
        });
        download(lines.join('\n'), 'knuten-all-statistik-' + todayKey + '.csv', 'text/csv');
    }

    function backupJson() {
        var days = listDays();
        var data = {};
        days.forEach(function (d) { data[d] = loadDay(d); });
        var payload = {
            app: 'knuten',
            version: 2,
            exported: new Date().toISOString(),
            days: data
        };
        download(JSON.stringify(payload, null, 2), 'knuten-sakerhetskopia-' + todayKey + '.json', 'application/json');
    }

    function restoreJson(file) {
        var reader = new FileReader();
        reader.onload = function () {
            try {
                var payload = JSON.parse(reader.result);
                if (!payload || typeof payload !== 'object' || !payload.days || typeof payload.days !== 'object') {
                    throw new Error('invalid');
                }
                var imported = 0;
                for (var d in payload.days) {
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
                    if (!isValidStats(payload.days[d])) continue;
                    saveDay(d, payload.days[d]);
                    imported++;
                }
                if (imported === 0) throw new Error('empty');
                stats = loadDay(todayKey);
                toast('✅ Återställde statistik för ' + imported + ' dag(ar).', 'success');
                render();
            } catch (e) {
                toast('Kunde inte återställa – filen är ogiltig.', 'error');
            }
        };
        reader.onerror = function () {
            toast('Kunde inte läsa filen.', 'error');
        };
        reader.readAsText(file);
    }

    function download(content, filename, mime) {
        try {
            // BOM (0xFEFF) gör att svenska tecken visas rätt i Excel
            var blob = new Blob([String.fromCharCode(0xFEFF) + content], { type: (mime || 'text/plain') + ';charset=utf-8;' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
            toast('✅ Filen har laddats ner.', 'success');
        } catch (e) {
            toast('Kunde inte exportera filen.', 'error');
        }
    }

    // ---------- Rendering ----------
    function fillList(elementId, counts, colorClass, suffix) {
        var el = document.getElementById(elementId);
        if (!el) return;
        el.textContent = '';
        var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
        if (!keys.length) {
            var empty = document.createElement('div');
            empty.className = 'stat-item';
            empty.textContent = 'Inga registreringar ännu.';
            el.appendChild(empty);
            return;
        }
        keys.forEach(function (k) {
            var row = document.createElement('div');
            row.className = 'stat-item';
            row.appendChild(document.createTextNode(k + suffix + ': '));
            var value = document.createElement('span');
            value.className = 'stat-value ' + colorClass;
            value.textContent = counts[k];
            row.appendChild(value);
            el.appendChild(row);
        });
    }

    function renderHeader() {
        var dateEl = document.getElementById('currentDate');
        if (dateEl) {
            dateEl.textContent = new Date().toLocaleDateString('sv-SE', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });
        }
        setText('visitorCount', stats.total);
    }

    function renderStats() {
        var data = viewDate === todayKey ? stats : loadDay(viewDate);
        setText('statTotal', data.total);
        fillList('statGender', data.genderCount, 'pink', '');
        fillList('statAge', data.ageGroups, 'orange', ' år');
        fillList('statMunicipality', data.municipalityCount, 'blue', '');
        var notice = document.getElementById('viewNotice');
        if (notice) {
            if (viewDate !== todayKey) {
                notice.textContent = '🗓️ Visar statistik för ' + viewDate + ' (inte idag).';
                notice.classList.remove('hidden');
            } else {
                notice.classList.add('hidden');
            }
        }
    }

    function render() {
        renderHeader();
        renderStats();

        var unlocked = isUnlocked();
        var section = document.getElementById('staffSection');
        if (section) section.classList.toggle('hidden', !unlocked);
        setText('staffBtnIcon', unlocked ? '🔓' : '🔒');
        setText('staffBtnText', unlocked ? 'Lås personalvyn' : 'Personal – logga in');

        var undoBtn = document.getElementById('undoBtn');
        if (undoBtn) undoBtn.disabled = !lastRegistration || !storageOk;

        var hist = document.getElementById('historyDate');
        if (hist) {
            hist.max = todayKey;
            hist.value = viewDate;
        }

        var viewed = viewDate === todayKey ? stats : loadDay(viewDate);
        var exportDayBtn = document.getElementById('exportDayBtn');
        if (exportDayBtn) exportDayBtn.disabled = viewed.total === 0;

        var exportAllBtn = document.getElementById('exportAllBtn');
        if (exportAllBtn) exportAllBtn.disabled = !storageOk || listDays().length === 0;
    }

    // ---------- Ny dag vid midnatt ----------
    function checkNewDay() {
        var now = dateKey(new Date());
        if (now !== todayKey) {
            todayKey = now;
            viewDate = now;
            stats = loadDay(now);
            lastRegistration = null;
            try { localStorage.removeItem(LAST_REG_KEY); } catch (e) { /* ignorera */ }
            if (storageOk) migrateAndPrune();
            toast('🌅 Ny dag – räknaren har nollställts.', 'info');
            render();
        }
    }

    // ---------- Håll skärmen vaken (iPad-kiosk) ----------
    var wakeLock = null;

    function requestWakeLock() {
        if (!('wakeLock' in navigator)) return;
        try {
            navigator.wakeLock.request('screen').then(function (lock) {
                wakeLock = lock;
            }).catch(function () { /* stöds inte eller nekades */ });
        } catch (e) { /* ignorera */ }
    }

    // ---------- Init ----------
    function init() {
        try {
            localStorage.setItem('knuten-test', '1');
            localStorage.removeItem('knuten-test');
        } catch (e) {
            storageOk = false;
        }

        if (storageOk) {
            migrateAndPrune();
            stats = loadDay(todayKey);
            try {
                var lr = JSON.parse(localStorage.getItem(LAST_REG_KEY) || 'null');
                if (lr && lr.date === todayKey && lr.reg) lastRegistration = lr.reg;
            } catch (e) { /* ignorera */ }
        } else {
            var warn = document.getElementById('storageWarning');
            if (warn) warn.classList.remove('hidden');
        }

        var submitBtn = document.getElementById('submitBtn');
        if (submitBtn) {
            submitBtn.addEventListener('click', handleSubmit);
            submitBtn.disabled = !storageOk;
        }

        initChips('ageChips', 'age');
        initChips('genderChips', 'gender');
        initChips('municipalityChips', 'municipality');

        bind('staffBtn', handleStaffBtn);
        bind('undoBtn', undoLast);
        bind('exportDayBtn', exportDayCsv);
        bind('exportAllBtn', exportAllCsv);
        bind('backupBtn', backupJson);
        bind('restoreBtn', function () {
            var input = document.getElementById('restoreInput');
            if (input) input.click();
        });
        bind('changePinBtn', function () {
            openPinModal('change', 'Ange nuvarande PIN-kod och välj en ny (4–8 siffror).', null);
        });
        bind('clearBtn', clearToday);
        bind('todayBtn', function () { viewDate = todayKey; render(); });
        bind('pinOkBtn', handlePinOk);
        bind('pinCancelBtn', closePinModal);

        var hist = document.getElementById('historyDate');
        if (hist) {
            hist.addEventListener('change', function () {
                viewDate = hist.value || todayKey;
                render();
            });
        }

        var restore = document.getElementById('restoreInput');
        if (restore) {
            restore.addEventListener('change', function () {
                if (restore.files && restore.files[0]) restoreJson(restore.files[0]);
                restore.value = '';
            });
        }

        ['pinInput', 'pinNewInput'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('keydown', handlePinKey);
        });

        setInterval(checkNewDay, 30000);

        // Håll iPad-skärmen vaken – aktiveras vid första trycket, förnyas vid återkomst
        document.addEventListener('pointerdown', requestWakeLock, { once: true });
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') requestWakeLock();
        });

        render();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
