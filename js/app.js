/**
 * SpinPulse Table Tennis Trials - Tournament Management System
 * Theme: Refined, Pleasant Sports Design
 * Features:
 * - Separate Men's & Women's Table Allocation (Dedicated Tables)
 * - Multi-Day Continuation (Pause & Resume session, JSON Backup & Restore)
 * - Division Conclusion & Lifecycle (End Men's, Women's, or Both Divisions with Top 7 Certification)
 * - Late-Arrival Mid-Tournament Player Ingestion (Preserves all active tables & scores)
 * - Best of 3 Games (First to 2 wins) Live Scoring
 * - Standings with Top 7 Qualification Cutoffs
 * - Real-Time Match Activity Logs & Audit Trail
 * - Zero Emojis; Lightweight SVG Vector Icons
 * - LocalStorage Persistence & CSV / Print Export
 */

(function () {
  'use strict';

  // --- Sound Effects via Web Audio API (Offline & lightweight) ---
  const SoundFX = {
    audioCtx: null,
    muted: false,

    init() {
      if (!this.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.audioCtx = new AudioContext();
        }
      }
    },

    playTone(freq, type = 'sine', duration = 0.08, gainVal = 0.15) {
      if (this.muted) return;
      try {
        this.init();
        if (!this.audioCtx) return;
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume();
        }
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
        gain.gain.setValueAtTime(gainVal, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start();
        osc.stop(this.audioCtx.currentTime + duration);
      } catch (e) {
        console.warn('Audio playback not allowed or failed', e);
      }
    },

    ping() {
      this.playTone(880, 'sine', 0.06, 0.2);
    },

    win() {
      if (this.muted) return;
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        setTimeout(() => this.playTone(freq, 'triangle', 0.15, 0.25), idx * 90);
      });
    }
  };

  // --- Initial State (Empty Roster, Clean Start) ---
  const STORAGE_KEY = 'tt_trials_tournament_data_v4'; // Upgraded storage key to guarantee empty roster start
  const THEME_KEY = 'tt_trials_theme_v3';

  let state = {
    config: {
      tableAllocationMode: 'dedicated', // 'dedicated' (separate for men & women) or 'shared'
      tablesMale: 4,
      tablesFemale: 3,
      tableCount: 7,
      autoFlexEmptyTables: true, // Auto-distribute matches to idle tables once a gender finishes
      gamesToWin: 2,
      maxGames: 3,
      tournamentName: 'Official Table Tennis Selection Trials'
    },
    status: {
      isPaused: false,
      pausedDay: 0,
      pausedAt: null,
      maleConcluded: false,
      femaleConcluded: false
    },
    currentTab: 'tables', // Opens directly on Live Tables (first tab of website)
    players: [],
    matches: [],
    logs: [],
    tableAssignments: {},
    filters: {
      tablesDivision: 'all',
      fixturesRound: 'all',
      fixturesDivision: 'all',
      logsDivision: 'all',
      logsSearch: ''
    },
    ui: {
      showAllMales: false,
      showAllFemales: false
    }
  };

  // Helper: Guard actions when tournament is paused
  function checkPausedAction() {
    if (state.status.isPaused) {
      showToast(`Tournament Day ${state.status.pausedDay || 1} is paused. Click "Resume Day" to make changes or score matches.`, 'warning');
      return true;
    }
    return false;
  }

  // --- Theme Management ---
  function getTheme() {
    return localStorage.getItem(THEME_KEY) || 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);

    const toggleText = document.getElementById('themeToggleText');
    const themeIcon = document.getElementById('themeIcon');

    if (theme === 'dark') {
      if (toggleText) toggleText.textContent = 'Light Mode';
      if (themeIcon) {
        themeIcon.innerHTML = `<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>`;
      }
    } else {
      if (toggleText) toggleText.textContent = 'Dark Mode';
      if (themeIcon) {
        themeIcon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
      }
    }
  }

  window.toggleTheme = function () {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  };

  // --- State Persistence ---
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      updateSavedIndicator();
    } catch (e) {
      console.error('Failed to save tournament state', e);
    }
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Clean out legacy sample players if any exist
        if (parsed.players && parsed.players.some(p => p.id === 'p_1' && p.name === 'Marcus Chen')) {
          parsed.players = [];
          parsed.matches = [];
          parsed.tableAssignments = {};
          parsed.logs = [];
        }
        if (!parsed.status) {
          parsed.status = { isPaused: false, pausedDay: 0, pausedAt: null, maleConcluded: false, femaleConcluded: false };
        }
        // If tournament has not started or matches are empty, day must always be 0
        if (!parsed.matches || parsed.matches.length === 0) {
          parsed.status.pausedDay = 0;
          parsed.status.isPaused = false;
          parsed.status.pausedAt = null;
        }
        state = { ...state, ...parsed };
        return true;
      }
    } catch (e) {
      console.error('Failed to load state', e);
    }
    return false;
  }

  function updateSavedIndicator() {
    const el = document.getElementById('saveIndicator');
    if (el) {
      el.textContent = 'Auto-Saved';
      el.style.opacity = '1';
      setTimeout(() => {
        if (el) el.style.opacity = '0.7';
      }, 1500);
    }
  }

  // --- Toast Notifications ---
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';

    let iconSvg = '';
    if (type === 'success') {
      iconSvg = `<svg class="svg-icon svg-icon-sm" style="color:#22c55e" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'warning') {
      iconSvg = `<svg class="svg-icon svg-icon-sm" style="color:#f59e0b" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    } else {
      iconSvg = `<svg class="svg-icon svg-icon-sm" style="color:#38bdf8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }

    toast.innerHTML = `${iconSvg} <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  // --- Table Allocation Helper ---
  /**
   * Returns 'male', 'female', or 'shared' for a given table number
   */
  function getTableDivision(tableNum) {
    if (state.config.tableAllocationMode === 'dedicated') {
      const maleCutoff = parseInt(state.config.tablesMale, 10) || 4;
      return tableNum <= maleCutoff ? 'male' : 'female';
    }
    return 'shared';
  }

  // --- Multi-Day Continuation / Session Pause & Resume ---
  window.togglePauseDay = function () {
    if (!state.matches || state.matches.length === 0) {
      showToast('Generate a tournament schedule first before pausing.', 'warning');
      return;
    }
    if (state.status.isPaused) {
      window.resumeTournamentSession();
    } else {
      state.status.isPaused = true;
      state.status.pausedAt = new Date().toISOString();
      const currentDay = state.status.pausedDay || 1;

      logEvent({
        text: `Tournament Day ${currentDay} paused. Session safely saved for continuation on another day.`
      });

      saveState();
      renderAll();
      showToast(`Day ${currentDay} session paused. Ready to continue another day.`, 'info');
    }
  };

  window.resumeTournamentSession = function () {
    if (!state.matches || state.matches.length === 0) return;
    state.status.isPaused = false;
    state.status.pausedDay = (state.status.pausedDay || 1) + 1;

    logEvent({
      text: `Tournament resumed for Day ${state.status.pausedDay}. Tables open for live matches.`
    });

    autoFillEmptyTables();
    saveState();
    renderAll();
    showToast(`Tournament resumed for Day ${state.status.pausedDay}!`, 'success');
  };

  window.exportTournamentBackup = function () {
    const backupData = JSON.stringify(state, null, 2);
    const blob = new Blob([backupData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const day = (state.matches && state.matches.length > 0) ? (state.status.pausedDay || 1) : 0;
    link.href = url;
    link.download = `TT_Trials_Backup_Day${day}_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Downloaded Tournament Session Backup', 'success');
  };

  window.triggerImportBackup = function () {
    const fileInput = document.getElementById('importBackupInput');
    if (fileInput) fileInput.click();
  };

  window.handleImportBackup = function (event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const loadedState = JSON.parse(e.target.result);
        if (loadedState && loadedState.players && loadedState.matches) {
          state = { ...state, ...loadedState };
          saveState();
          renderAll();
          showToast('Tournament session restored successfully!', 'success');
        } else {
          showToast('Invalid tournament backup file.', 'warning');
        }
      } catch (err) {
        console.error('Failed to import backup', err);
        showToast('Error reading backup file.', 'warning');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  // --- Division Conclusion / Finalization Lifecycle ---
  window.openEndTournamentModal = function () {
    const modal = document.getElementById('endTournamentModal');
    if (!modal) return;
    const maleNote = document.getElementById('modalMaleStatusNote');
    const femaleNote = document.getElementById('modalFemaleStatusNote');
    if (maleNote) maleNote.textContent = state.status.maleConcluded ? 'Concluded' : 'Active';
    if (femaleNote) femaleNote.textContent = state.status.femaleConcluded ? 'Concluded' : 'Active';
    modal.classList.add('open');
  };

  window.closeEndTournamentModal = function () {
    const modal = document.getElementById('endTournamentModal');
    if (modal) modal.classList.remove('open');
  };

  window.confirmConcludeDivision = function (target) {
    if (target === 'male' || target === 'both') {
      state.status.maleConcluded = true;
      logEvent({
        division: 'male',
        text: `Official Notice: Men's division tournament has concluded. Top 7 qualifiers declared.`
      });
    }
    if (target === 'female' || target === 'both') {
      state.status.femaleConcluded = true;
      logEvent({
        division: 'female',
        text: `Official Notice: Women's division tournament has concluded. Top 7 qualifiers declared.`
      });
    }

    closeEndTournamentModal();
    saveState();
    renderAll();
    SoundFX.win();
    showToast(`Concluded ${target === 'both' ? 'entire tournament' : target + ' division'}! Top 7 finalized.`, 'success');
  };

  window.toggleConcludeDivision = function (division) {
    if (division === 'male') {
      state.status.maleConcluded = !state.status.maleConcluded;
      if (state.status.maleConcluded) {
        logEvent({ division: 'male', text: `Men's division concluded. Top 7 qualifiers finalized.` });
        SoundFX.win();
      } else {
        logEvent({ division: 'male', text: `Men's division re-opened for play.` });
      }
    } else {
      state.status.femaleConcluded = !state.status.femaleConcluded;
      if (state.status.femaleConcluded) {
        logEvent({ division: 'female', text: `Women's division concluded. Top 7 qualifiers finalized.` });
        SoundFX.win();
      } else {
        logEvent({ division: 'female', text: `Women's division re-opened for play.` });
      }
    }

    autoFillEmptyTables();
    saveState();
    renderAll();
  };

  // --- Round Robin Generator ---
  function generateDivisionRounds(playerList, division) {
    if (!playerList || playerList.length < 2) return [];

    const list = [...playerList];
    const isOdd = list.length % 2 !== 0;
    if (isOdd) {
      list.push({ id: '__BYE__', name: 'BYE', isBye: true, gender: division });
    }

    const n = list.length;
    const numRounds = n - 1;
    const half = n / 2;
    const pool = [...list];
    const divisionRounds = [];

    for (let r = 0; r < numRounds; r++) {
      const roundMatches = [];
      for (let i = 0; i < half; i++) {
        const p1 = pool[i];
        const p2 = pool[n - 1 - i];

        if (!p1.isBye && !p2.isBye) {
          roundMatches.push({
            p1Id: p1.id,
            p2Id: p2.id,
            division: division,
            divRound: r + 1
          });
        }
      }
      divisionRounds.push(roundMatches);

      const fixed = pool[0];
      const rest = pool.slice(1);
      const last = rest.pop();
      rest.unshift(last);
      pool.splice(0, pool.length, fixed, ...rest);
    }

    return divisionRounds;
  }

  function generateTournament() {
    const malePlayers = state.players.filter(p => p.gender === 'male');
    const femalePlayers = state.players.filter(p => p.gender === 'female');

    if (malePlayers.length < 2 && femalePlayers.length < 2) {
      showToast('Need at least 2 male or 2 female players to generate a tournament.', 'warning');
      return false;
    }

    const maleRounds = generateDivisionRounds(malePlayers, 'male');
    const femaleRounds = generateDivisionRounds(femalePlayers, 'female');

    const maxRounds = Math.max(maleRounds.length, femaleRounds.length);
    const newMatches = [];
    let matchCounter = 1;

    for (let r = 0; r < maxRounds; r++) {
      const roundNumber = r + 1;
      const mMatches = maleRounds[r] || [];
      const fMatches = femaleRounds[r] || [];

      const combinedRoundMatches = [];
      const maxLen = Math.max(mMatches.length, fMatches.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < mMatches.length) combinedRoundMatches.push(mMatches[i]);
        if (i < fMatches.length) combinedRoundMatches.push(fMatches[i]);
      }

      combinedRoundMatches.forEach((m) => {
        newMatches.push({
          id: `match_${matchCounter++}`,
          round: roundNumber,
          division: m.division,
          player1Id: m.p1Id,
          player2Id: m.p2Id,
          status: 'scheduled',
          table: null,
          games: [
            { p1: 0, p2: 0 },
            { p1: 0, p2: 0 },
            { p1: 0, p2: 0 }
          ],
          gamesWon: { p1: 0, p2: 0 },
          winnerId: null,
          completedAt: null
        });
      });
    }

    state.matches = newMatches;
    state.logs = [];
    state.tableAssignments = {};
    state.status.maleConcluded = false;
    state.status.femaleConcluded = false;
    state.status.isPaused = false;
    state.status.pausedDay = 1;
    state.status.pausedAt = null;

    const tableCount = parseInt(state.config.tableCount, 10) || 7;
    for (let t = 1; t <= tableCount; t++) {
      state.tableAssignments[t] = null;
    }

    autoFillEmptyTables();

    logEvent({
      text: `Tournament generated: ${state.players.length} athletes (${malePlayers.length} Male, ${femalePlayers.length} Female), ${state.matches.length} matches across ${tableCount} tables.`
    });

    saveState();
    renderAll();
    showToast(`Schedule generated! ${state.matches.length} matches across ${maxRounds} rounds. Starting Day 1.`, 'success');
    switchTab('tables');
    return true;
  }

  // --- Late Arrival Player Engine ---
  function addLatePlayerToTournament(name, gender) {
    if (!name || !name.trim()) {
      showToast('Please enter an athlete name.', 'warning');
      return false;
    }

    const trimmedName = name.trim();
    const newPlayer = {
      id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      name: trimmedName,
      gender: gender
    };

    state.players.push(newPlayer);

    if (!state.matches || state.matches.length === 0) {
      saveState();
      generateTournament();
      return true;
    }

    const opponents = state.players.filter(p => p.gender === gender && p.id !== newPlayer.id);

    if (opponents.length === 0) {
      saveState();
      renderAll();
      showToast(`Added ${newPlayer.name} (${gender}). No opponents in division yet.`, 'info');
      return true;
    }

    const divMatches = state.matches.filter(m => m.division === gender);
    let maxRound = divMatches.reduce((max, m) => Math.max(max, m.round), 0);
    if (maxRound === 0) maxRound = 1;

    const roundOccupied = {};
    divMatches.forEach(m => {
      if (!roundOccupied[m.round]) roundOccupied[m.round] = new Set();
      roundOccupied[m.round].add(m.player1Id);
      roundOccupied[m.round].add(m.player2Id);
    });

    const newMatchesCreated = [];
    opponents.forEach(opp => {
      let assignedRound = null;
      for (let r = 1; r <= maxRound; r++) {
        const occ = roundOccupied[r] || new Set();
        if (!occ.has(opp.id) && !occ.has(newPlayer.id)) {
          assignedRound = r;
          break;
        }
      }

      if (assignedRound === null) {
        maxRound++;
        assignedRound = maxRound;
      }

      if (!roundOccupied[assignedRound]) roundOccupied[assignedRound] = new Set();
      roundOccupied[assignedRound].add(opp.id);
      roundOccupied[assignedRound].add(newPlayer.id);

      const newMatch = {
        id: `match_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        round: assignedRound,
        division: gender,
        player1Id: newPlayer.id,
        player2Id: opp.id,
        status: 'scheduled',
        table: null,
        games: [
          { p1: 0, p2: 0 },
          { p1: 0, p2: 0 },
          { p1: 0, p2: 0 }
        ],
        gamesWon: { p1: 0, p2: 0 },
        winnerId: null,
        completedAt: null
      };

      newMatchesCreated.push(newMatch);
      state.matches.push(newMatch);
    });

    logEvent({
      division: gender,
      text: `Late Arrival: ${newPlayer.name} added to ${gender.toUpperCase()} division trials. ${newMatchesCreated.length} matches scheduled into active tournament.`
    });

    autoFillEmptyTables();
    saveState();
    renderAll();
    showToast(`Added ${newPlayer.name}! ${newMatchesCreated.length} matches scheduled into active tournament.`, 'success');
    return true;
  }

  window.openLatePlayerModal = function () {
    const modal = document.getElementById('latePlayerModal');
    if (modal) {
      modal.classList.add('open');
      const input = document.getElementById('latePlayerName');
      if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 50);
      }
    }
  };

  window.closeLatePlayerModal = function () {
    const modal = document.getElementById('latePlayerModal');
    if (modal) modal.classList.remove('open');
  };

  window.confirmAddLatePlayer = function () {
    const nameInput = document.getElementById('latePlayerName');
    const gender = document.querySelector('input[name="latePlayerGender"]:checked')?.value || 'male';

    if (!nameInput || !nameInput.value.trim()) {
      showToast('Please enter athlete full name.', 'warning');
      return;
    }

    const success = addLatePlayerToTournament(nameInput.value, gender);
    if (success) {
      closeLatePlayerModal();
    }
  };

  window.addLatePlayerFromSetup = function () {
    const nameInput = document.getElementById('newPlayerName');
    const gender = document.querySelector('input[name="newPlayerGender"]:checked')?.value || 'male';

    if (!nameInput || !nameInput.value.trim()) {
      showToast('Please enter athlete full name.', 'warning');
      return;
    }

    const success = addLatePlayerToTournament(nameInput.value, gender);
    if (success) {
      nameInput.value = '';
      nameInput.focus();
    }
  };

  // --- Auto-Dispatch Matches to Dedicated or Shared Tables ---
  function autoFillEmptyTables() {
    if (state.status.isPaused) return;

    const tableCount = parseInt(state.config.tableCount, 10) || 7;
    const activePlayerIds = new Set();

    // Identify players currently active on any live table
    for (let t = 1; t <= tableCount; t++) {
      const matchId = state.tableAssignments[t];
      if (matchId) {
        const match = state.matches.find(m => m.id === matchId);
        if (match) {
          activePlayerIds.add(match.player1Id);
          activePlayerIds.add(match.player2Id);
        }
      }
    }

    // PASS 1: Dedicated Division Dispatch
    for (let t = 1; t <= tableCount; t++) {
      if (!state.tableAssignments[t]) {
        const tableDiv = getTableDivision(t);

        // Check if division is concluded
        if (tableDiv === 'male' && state.status.maleConcluded) continue;
        if (tableDiv === 'female' && state.status.femaleConcluded) continue;

        const nextMatch = state.matches.find(m => {
          if (m.status !== 'scheduled') return false;

          // Division match check
          if (tableDiv !== 'shared' && m.division !== tableDiv) return false;
          if (m.division === 'male' && state.status.maleConcluded) return false;
          if (m.division === 'female' && state.status.femaleConcluded) return false;

          if (activePlayerIds.has(m.player1Id) || activePlayerIds.has(m.player2Id)) return false;
          return true;
        });

        if (nextMatch) {
          nextMatch.status = 'live';
          nextMatch.table = t;
          nextMatch.isFlex = false;
          state.tableAssignments[t] = nextMatch.id;
          activePlayerIds.add(nextMatch.player1Id);
          activePlayerIds.add(nextMatch.player2Id);
        }
      }
    }

    // PASS 2: Auto-Flex Overflow Dispatch
    // If enabled, empty tables whose assigned gender is done with their games (or concluded)
    // automatically host pending matches from the other active division!
    if (state.config.autoFlexEmptyTables !== false) {
      for (let t = 1; t <= tableCount; t++) {
        if (!state.tableAssignments[t]) {
          const tableDiv = getTableDivision(t);
          if (tableDiv === 'shared') continue;

          const isAssignedConcluded = tableDiv === 'male' ? state.status.maleConcluded : state.status.femaleConcluded;
          const assignedHasScheduled = state.matches.some(m => m.division === tableDiv && m.status === 'scheduled');

          // If the assigned gender has finished all scheduled games or division is concluded:
          if (isAssignedConcluded || !assignedHasScheduled) {
            const otherDiv = tableDiv === 'male' ? 'female' : 'male';
            const isOtherConcluded = otherDiv === 'male' ? state.status.maleConcluded : state.status.femaleConcluded;

            if (!isOtherConcluded) {
              const overflowMatch = state.matches.find(m => {
                if (m.status !== 'scheduled') return false;
                if (m.division !== otherDiv) return false;
                if (activePlayerIds.has(m.player1Id) || activePlayerIds.has(m.player2Id)) return false;
                return true;
              });

              if (overflowMatch) {
                overflowMatch.status = 'live';
                overflowMatch.table = t;
                overflowMatch.isFlex = true;
                state.tableAssignments[t] = overflowMatch.id;
                activePlayerIds.add(overflowMatch.player1Id);
                activePlayerIds.add(overflowMatch.player2Id);

                logEvent({
                  division: overflowMatch.division,
                  table: t,
                  text: `Auto-Flex: Table ${t} (${tableDiv === 'male' ? "Men's" : "Women's"} table) auto-assigned to ${otherDiv.toUpperCase()} Round ${overflowMatch.round} match as ${tableDiv} games are finished.`
                });
              }
            }
          }
        }
      }
    }
  }

  // --- Logging Engine ---
  function logEvent(item) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const logEntry = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      time: timeStr,
      timestamp: now.getTime(),
      ...item
    };
    state.logs.unshift(logEntry);
  }

  function getPlayer(id) {
    return state.players.find(p => p.id === id) || { name: 'Unknown', gender: 'unknown' };
  }

  // --- Match Score & Point Handling ---
  function syncMatchGameWins(match) {
    let p1Wins = 0;
    let p2Wins = 0;
    match.games.forEach(g => {
      const p1 = parseInt(g.p1, 10) || 0;
      const p2 = parseInt(g.p2, 10) || 0;
      if ((p1 >= 11 || p2 >= 11) && Math.abs(p1 - p2) >= 2) {
        if (p1 > p2) p1Wins++;
        else p2Wins++;
      }
    });

    if (p1Wins > 0 || p2Wins > 0) {
      match.gamesWon.p1 = p1Wins;
      match.gamesWon.p2 = p2Wins;
    }

    if (match.gamesWon.p1 >= state.config.gamesToWin) {
      match.winnerId = match.player1Id;
    } else if (match.gamesWon.p2 >= state.config.gamesToWin) {
      match.winnerId = match.player2Id;
    } else {
      match.winnerId = null;
    }
  }

  window.setActiveGame = function (tableNum, gameIdx) {
    if (checkPausedAction()) return;
    const matchId = state.tableAssignments[tableNum];
    if (!matchId) return;
    const match = state.matches.find(m => m.id === matchId);
    if (!match) return;

    match.activeGame = Math.max(0, Math.min(2, gameIdx));
    saveState();
    renderLiveTables();
  };

  window.changeGamePoint = function (tableNum, playerNum, delta) {
    if (checkPausedAction()) return;
    const matchId = state.tableAssignments[tableNum];
    if (!matchId) return;
    const match = state.matches.find(m => m.id === matchId);
    if (!match || match.status === 'completed') return;

    const curGameIdx = match.activeGame !== undefined ? match.activeGame : 0;
    if (!match.games[curGameIdx]) {
      match.games[curGameIdx] = { p1: 0, p2: 0 };
    }

    const g = match.games[curGameIdx];
    if (playerNum === 1) {
      g.p1 = Math.max(0, (parseInt(g.p1, 10) || 0) + delta);
    } else {
      g.p2 = Math.max(0, (parseInt(g.p2, 10) || 0) + delta);
    }

    SoundFX.ping();

    const p1 = getPlayer(match.player1Id);
    const p2 = getPlayer(match.player2Id);
    const isGameWon = (g.p1 >= 11 || g.p2 >= 11) && Math.abs(g.p1 - g.p2) >= 2;

    if (isGameWon && delta > 0) {
      const gameWinner = g.p1 > g.p2 ? p1 : p2;
      showToast(`${gameWinner.name} won Game ${curGameIdx + 1} (${g.p1}-${g.p2})!`, 'success');
      SoundFX.win();

      // Automatically advance active game tab to next game
      if (curGameIdx < 2) {
        match.activeGame = curGameIdx + 1;
      }
    }

    syncMatchGameWins(match);
    saveState();
    renderLiveTables();
    renderStandings();
  };

  window.setGameScorePreset = function (tableNum, gameIdx, p1Score, p2Score) {
    if (checkPausedAction()) return;
    const matchId = state.tableAssignments[tableNum];
    if (!matchId) return;
    const match = state.matches.find(m => m.id === matchId);
    if (!match || match.status === 'completed') return;

    if (!match.games[gameIdx]) {
      match.games[gameIdx] = { p1: 0, p2: 0 };
    }

    match.games[gameIdx].p1 = Math.max(0, p1Score);
    match.games[gameIdx].p2 = Math.max(0, p2Score);

    const p1 = getPlayer(match.player1Id);
    const p2 = getPlayer(match.player2Id);
    const isGameWon = (p1Score >= 11 || p2Score >= 11) && Math.abs(p1Score - p2Score) >= 2;

    if (isGameWon) {
      const gameWinner = p1Score > p2Score ? p1 : p2;
      showToast(`${gameWinner.name} won Game ${gameIdx + 1} (${p1Score}-${p2Score})!`, 'success');
      SoundFX.win();
      if (gameIdx < 2) {
        match.activeGame = gameIdx + 1;
      }
    }

    syncMatchGameWins(match);
    saveState();
    renderLiveTables();
    renderStandings();
  };

  window.incrementGame = function (tableNum, playerNum) {
    if (checkPausedAction()) return;
    const matchId = state.tableAssignments[tableNum];
    if (!matchId) return;
    const match = state.matches.find(m => m.id === matchId);
    if (!match || match.status === 'completed') return;

    SoundFX.ping();

    if (playerNum === 1) {
      if (match.gamesWon.p1 < state.config.gamesToWin) {
        match.gamesWon.p1++;
      }
    } else {
      if (match.gamesWon.p2 < state.config.gamesToWin) {
        match.gamesWon.p2++;
      }
    }

    if (match.gamesWon.p1 >= state.config.gamesToWin) {
      match.winnerId = match.player1Id;
      SoundFX.win();
    } else if (match.gamesWon.p2 >= state.config.gamesToWin) {
      match.winnerId = match.player2Id;
      SoundFX.win();
    } else {
      match.winnerId = null;
    }

    saveState();
    renderLiveTables();
    renderStandings();
  };

  window.decrementGame = function (tableNum, playerNum) {
    if (checkPausedAction()) return;
    const matchId = state.tableAssignments[tableNum];
    if (!matchId) return;
    const match = state.matches.find(m => m.id === matchId);
    if (!match || match.status === 'completed') return;

    if (playerNum === 1 && match.gamesWon.p1 > 0) {
      match.gamesWon.p1--;
    } else if (playerNum === 2 && match.gamesWon.p2 > 0) {
      match.gamesWon.p2--;
    }

    if (match.gamesWon.p1 >= state.config.gamesToWin) {
      match.winnerId = match.player1Id;
    } else if (match.gamesWon.p2 >= state.config.gamesToWin) {
      match.winnerId = match.player2Id;
    } else {
      match.winnerId = null;
    }

    saveState();
    renderLiveTables();
    renderStandings();
  };

  window.updateGamePoints = function (tableNum, gameIdx, p1Pts, p2Pts) {
    if (checkPausedAction()) return;
    const matchId = state.tableAssignments[tableNum];
    if (!matchId) return;
    const match = state.matches.find(m => m.id === matchId);
    if (!match) return;

    if (!match.games[gameIdx]) {
      match.games[gameIdx] = { p1: 0, p2: 0 };
    }

    const p1Score = parseInt(p1Pts, 10) || 0;
    const p2Score = parseInt(p2Pts, 10) || 0;
    match.games[gameIdx].p1 = Math.max(0, p1Score);
    match.games[gameIdx].p2 = Math.max(0, p2Score);

    syncMatchGameWins(match);

    saveState();
    renderLiveTables();
    renderStandings();
  };

  window.completeMatch = function (tableNum) {
    if (checkPausedAction()) return;
    const matchId = state.tableAssignments[tableNum];
    if (!matchId) return;
    const match = state.matches.find(m => m.id === matchId);
    if (!match) return;

    if (!match.winnerId) {
      showToast('Match is not decided yet. A player must win 2 games.', 'warning');
      return;
    }

    match.status = 'completed';
    match.completedAt = new Date().toISOString();

    const p1 = getPlayer(match.player1Id);
    const p2 = getPlayer(match.player2Id);
    const winner = match.winnerId === match.player1Id ? p1 : p2;
    const loser = match.winnerId === match.player1Id ? p2 : p1;

    const scoreBreakdown = `${match.gamesWon.p1} - ${match.gamesWon.p2}`;
    const ptsList = match.games
      .filter(g => g.p1 > 0 || g.p2 > 0)
      .map(g => `${g.p1}-${g.p2}`)
      .join(', ');

    logEvent({
      matchId: match.id,
      division: match.division,
      table: tableNum,
      round: match.round,
      p1Name: p1.name,
      p2Name: p2.name,
      winnerName: winner.name,
      loserName: loser.name,
      scoreStr: `${scoreBreakdown} ${ptsList ? `(${ptsList})` : ''}`,
      text: `Table ${tableNum} • Round ${match.round} [${match.division.toUpperCase()}]: ${winner.name} defeated ${loser.name} ${scoreBreakdown} ${ptsList ? `(${ptsList})` : ''}`
    });

    SoundFX.win();
    showToast(`Table ${tableNum} Completed: ${winner.name} won ${scoreBreakdown}`, 'success');

    state.tableAssignments[tableNum] = null;
    autoFillEmptyTables();

    saveState();
    renderAll();
  };

  window.callMatchToTable = function (tableNum, matchId) {
    if (checkPausedAction()) return;
    if (!matchId) return;
    const match = state.matches.find(m => m.id === matchId);
    if (!match) return;

    for (let t in state.tableAssignments) {
      if (t != tableNum && state.tableAssignments[t]) {
        const activeM = state.matches.find(m => m.id === state.tableAssignments[t]);
        if (activeM) {
          if (
            activeM.player1Id === match.player1Id ||
            activeM.player2Id === match.player1Id ||
            activeM.player1Id === match.player2Id ||
            activeM.player2Id === match.player2Id
          ) {
            showToast('Cannot assign: One of these players is currently active on Table ' + t, 'warning');
            return;
          }
        }
      }
    }

    match.status = 'live';
    match.table = parseInt(tableNum, 10);
    state.tableAssignments[tableNum] = match.id;

    saveState();
    renderAll();
    showToast(`Assigned match to Table ${tableNum}`, 'success');
  };

  window.releaseTable = function (tableNum) {
    if (checkPausedAction()) return;
    const matchId = state.tableAssignments[tableNum];
    if (!matchId) return;
    const match = state.matches.find(m => m.id === matchId);
    if (match && match.status !== 'completed') {
      match.status = 'scheduled';
      match.table = null;
    }
    state.tableAssignments[tableNum] = null;
    saveState();
    renderAll();
    showToast(`Table ${tableNum} returned to queue`, 'info');
  };

  window.autoCallNextToTable = function (tableNum) {
    if (checkPausedAction()) return;
    const activePlayerIds = new Set();
    const tableCount = parseInt(state.config.tableCount, 10) || 7;

    for (let t = 1; t <= tableCount; t++) {
      const matchId = state.tableAssignments[t];
      if (matchId) {
        const match = state.matches.find(m => m.id === matchId);
        if (match) {
          activePlayerIds.add(match.player1Id);
          activePlayerIds.add(match.player2Id);
        }
      }
    }

    const tableDiv = getTableDivision(tableNum);
    let nextMatch = state.matches.find(m => {
      if (m.status !== 'scheduled') return false;
      if (tableDiv !== 'shared' && m.division !== tableDiv) return false;
      if (m.division === 'male' && state.status.maleConcluded) return false;
      if (m.division === 'female' && state.status.femaleConcluded) return false;
      if (activePlayerIds.has(m.player1Id) || activePlayerIds.has(m.player2Id)) return false;
      return true;
    });

    // If no match in assigned division, check if autoFlex is enabled and find other division match
    if (!nextMatch && state.config.autoFlexEmptyTables !== false && tableDiv !== 'shared') {
      const otherDiv = tableDiv === 'male' ? 'female' : 'male';
      const isOtherConcluded = otherDiv === 'male' ? state.status.maleConcluded : state.status.femaleConcluded;
      if (!isOtherConcluded) {
        nextMatch = state.matches.find(m => {
          if (m.status !== 'scheduled') return false;
          if (m.division !== otherDiv) return false;
          if (activePlayerIds.has(m.player1Id) || activePlayerIds.has(m.player2Id)) return false;
          return true;
        });
      }
    }

    if (nextMatch) {
      nextMatch.status = 'live';
      nextMatch.table = tableNum;
      if (tableDiv !== 'shared' && nextMatch.division !== tableDiv) {
        nextMatch.isFlex = true;
      }
      state.tableAssignments[tableNum] = nextMatch.id;
      saveState();
      renderAll();
      showToast(`Called Round ${nextMatch.round} match to Table ${tableNum}`, 'success');
    } else {
      showToast('No eligible scheduled matches available for this table.', 'warning');
    }
  };

  // --- Auto-Flex Controls ---
  window.toggleFlexTables = function () {
    state.config.autoFlexEmptyTables = state.config.autoFlexEmptyTables === false ? true : false;
    autoFillEmptyTables();
    saveState();
    renderAll();
    showToast(
      state.config.autoFlexEmptyTables
        ? 'Auto-Flex Tables Enabled: Idle tables will auto-fill from other division when one finishes.'
        : 'Auto-Flex Tables Disabled: Tables strictly stick to assigned division.',
      'info'
    );
  };

  window.updateAutoFlexTables = function (enabled) {
    state.config.autoFlexEmptyTables = !!enabled;
    autoFillEmptyTables();
    saveState();
    renderAll();
    showToast(
      state.config.autoFlexEmptyTables
        ? 'Auto-Flex Tables Enabled: Idle tables will auto-fill from other division.'
        : 'Auto-Flex Tables Disabled: Tables strictly stick to assigned division.',
      'info'
    );
  };

  // --- Dedicated Table Configuration in Setup ---
  window.updateTableAllocationMode = function (mode) {
    state.config.tableAllocationMode = mode;
    saveState();
    renderAll();
  };

  window.updateDedicatedTables = function () {
    const mInput = document.getElementById('configTablesMale');
    const fInput = document.getElementById('configTablesFemale');
    const mCount = Math.max(1, parseInt(mInput?.value, 10) || 4);
    const fCount = Math.max(1, parseInt(fInput?.value, 10) || 3);

    state.config.tablesMale = mCount;
    state.config.tablesFemale = fCount;
    state.config.tableCount = mCount + fCount;

    for (let t = 1; t <= state.config.tableCount; t++) {
      if (state.tableAssignments[t] === undefined) {
        state.tableAssignments[t] = null;
      }
    }

    const mLabel = document.getElementById('menTablesRangeLabel');
    const fLabel = document.getElementById('womenTablesRangeLabel');
    if (mLabel) mLabel.textContent = `Tables 1 to ${mCount}`;
    if (fLabel) fLabel.textContent = `Tables ${mCount + 1} to ${mCount + fCount}`;

    saveState();
    renderAll();
    showToast(`Updated: ${mCount} Men's Tables, ${fCount} Women's Tables (${state.config.tableCount} Total)`, 'info');
  };

  // --- Standings & Leaderboard Calculation ---
  function calculateStandings(division) {
    const divPlayers = state.players.filter(p => p.gender === division);
    const divMatches = state.matches.filter(m => m.division === division && m.status === 'completed');

    const stats = {};
    divPlayers.forEach(p => {
      stats[p.id] = {
        player: p,
        played: 0,
        won: 0,
        lost: 0,
        gamesWon: 0,
        gamesLost: 0,
        gameDiff: 0,
        pointsWon: 0,
        pointsLost: 0,
        pointDiff: 0,
        winPct: 0,
        recentForm: []
      };
    });

    const sortedMatches = [...divMatches].sort((a, b) => {
      const tA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const tB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return tA - tB;
    });

    sortedMatches.forEach(m => {
      const s1 = stats[m.player1Id];
      const s2 = stats[m.player2Id];
      if (!s1 || !s2) return;

      s1.played++;
      s2.played++;

      s1.gamesWon += m.gamesWon.p1;
      s1.gamesLost += m.gamesWon.p2;

      s2.gamesWon += m.gamesWon.p2;
      s2.gamesLost += m.gamesWon.p1;

      m.games.forEach(g => {
        s1.pointsWon += g.p1;
        s1.pointsLost += g.p2;
        s2.pointsWon += g.p2;
        s2.pointsLost += g.p1;
      });

      if (m.winnerId === m.player1Id) {
        s1.won++;
        s2.lost++;
        s1.recentForm.push('W');
        s2.recentForm.push('L');
      } else if (m.winnerId === m.player2Id) {
        s2.won++;
        s1.lost++;
        s2.recentForm.push('W');
        s1.recentForm.push('L');
      }
    });

    const standings = Object.values(stats).map(s => {
      s.gameDiff = s.gamesWon - s.gamesLost;
      s.pointDiff = s.pointsWon - s.pointsLost;
      s.winPct = s.played > 0 ? ((s.won / s.played) * 100).toFixed(1) : '0.0';
      s.recentForm = s.recentForm.slice(-4);
      return s;
    });

    standings.sort((a, b) => {
      if (b.won !== a.won) return b.won - a.won;
      if (parseFloat(b.winPct) !== parseFloat(a.winPct)) return parseFloat(b.winPct) - parseFloat(a.winPct);
      if (b.gameDiff !== a.gameDiff) return b.gameDiff - a.gameDiff;
      if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
      return b.gamesWon - a.gamesWon;
    });

    return standings;
  }

  // --- Rendering Functions ---

  function renderHeaderStats() {
    const totalMatches = state.matches.length;
    const completedMatches = state.matches.filter(m => m.status === 'completed').length;
    const liveMatches = state.matches.filter(m => m.status === 'live').length;
    const progressPct = totalMatches > 0 ? Math.round((completedMatches / totalMatches) * 100) : 0;

    const maleCount = state.players.filter(p => p.gender === 'male').length;
    const femaleCount = state.players.filter(p => p.gender === 'female').length;

    const statTotalEl = document.getElementById('statTotalMatches');
    const statCompletedEl = document.getElementById('statCompletedMatches');
    const statLiveEl = document.getElementById('statLiveMatches');
    const statPlayersEl = document.getElementById('statTotalPlayers');
    const statProgressEl = document.getElementById('statProgress');
    const rosterBadge = document.getElementById('rosterBadgeCount');
    const pauseBtnText = document.getElementById('pauseBtnText');
    const btnPauseDay = document.getElementById('btnPauseDay');
    const headerDayBadge = document.getElementById('headerDayBadge');
    const statDayEl = document.getElementById('statTournamentDay');
    const pausedBanner = document.getElementById('pausedSessionBanner');
    const pausedSessionText = document.getElementById('pausedSessionText');
    const tableNotice = document.getElementById('tablesAllocationNotice');

    if (statTotalEl) statTotalEl.textContent = totalMatches;
    if (statCompletedEl) statCompletedEl.textContent = `${completedMatches} (${progressPct}%)`;

    const mTables = state.config.tablesMale || 4;
    const fTables = state.config.tablesFemale || 3;
    if (statLiveEl) {
      statLiveEl.textContent = state.config.tableAllocationMode === 'dedicated'
        ? `${state.config.tableCount} (${mTables}M / ${fTables}F)`
        : `${state.config.tableCount} (Shared)`;
    }

    if (statPlayersEl) statPlayersEl.textContent = `${state.players.length} (${maleCount}M / ${femaleCount}F)`;
    if (statProgressEl) statProgressEl.textContent = `${progressPct}%`;
    if (rosterBadge) rosterBadge.textContent = `${state.players.length} Athletes`;

    // Multi-Day Paused UI & Day Counter
    if (totalMatches === 0) {
      state.status.pausedDay = 0;
      if (headerDayBadge) headerDayBadge.textContent = 'Day 0';
      if (statDayEl) statDayEl.textContent = 'Day 0';
      if (btnPauseDay) {
        btnPauseDay.disabled = true;
        btnPauseDay.title = 'Start or generate a tournament to enable session pausing';
      }
      if (pauseBtnText) pauseBtnText.textContent = 'Pause Day';
      if (pausedBanner) pausedBanner.style.display = 'none';
    } else {
      const activeDay = state.status.pausedDay || 1;
      if (headerDayBadge) headerDayBadge.textContent = `Day ${activeDay}`;
      if (statDayEl) statDayEl.textContent = `Day ${activeDay}`;
      if (btnPauseDay) {
        btnPauseDay.disabled = false;
        btnPauseDay.title = state.status.isPaused ? `Resume tournament for Day ${activeDay + 1}` : `Pause today's session (Day ${activeDay})`;
      }
      if (pauseBtnText) {
        pauseBtnText.textContent = state.status.isPaused ? `Resume Day ${activeDay + 1}` : `Pause Day ${activeDay}`;
      }
      if (pausedBanner) {
        pausedBanner.style.display = state.status.isPaused ? 'flex' : 'none';
        if (pausedSessionText) {
          pausedSessionText.textContent = `Tournament Day ${activeDay} Paused. All matches, scores, and tables are preserved safely.`;
        }
      }
    }

    if (tableNotice) {
      tableNotice.textContent = state.config.tableAllocationMode === 'dedicated'
        ? `Dedicated: Tables 1-${mTables} for Men, Tables ${mTables + 1}-${mTables + fTables} for Women`
        : `Shared Pool: Tables 1-${state.config.tableCount} host any division`;
    }

    // Auto-Flex status indicators in header toolbar and config
    const flexStatusText = document.getElementById('flexTablesStatusText');
    const btnToggleFlex = document.getElementById('btnToggleFlexTables');
    const configCheckbox = document.getElementById('configAutoFlexTables');

    const isFlexOn = state.config.autoFlexEmptyTables !== false;
    if (flexStatusText) {
      flexStatusText.textContent = isFlexOn ? 'Auto-Flex: ON' : 'Auto-Flex: OFF';
    }
    if (btnToggleFlex) {
      btnToggleFlex.classList.toggle('active', isFlexOn);
    }
    if (configCheckbox) {
      configCheckbox.checked = isFlexOn;
    }
  }

  function renderLiveTables() {
    const container = document.getElementById('tablesGrid');
    if (!container) return;

    // Empty state when tournament hasn't been generated yet
    if (!state.matches || state.matches.length === 0) {
      container.innerHTML = `
        <div class="empty-roster-banner" style="grid-column: 1 / -1;">
          <svg class="svg-icon" style="width: 44px; height: 44px; color: var(--accent-primary); margin-bottom: 12px;" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          <h3 style="font-size: 1.2rem; font-weight: 800; margin-bottom: 6px; color: var(--text-main);">No Tournament Matches Active</h3>
          <p style="color: var(--text-muted); font-size: 0.9rem; max-width: 520px; margin: 0 auto 16px auto; line-height: 1.5;">
            Your roster is clean. Go to <strong>Setup & Tables</strong> to add your athletes, then click <strong>"Generate Fresh Schedule & Start Trials"</strong>.
          </p>
          <button class="btn btn-primary" onclick="switchTab('setup')">
            Go to Setup & Register Athletes
          </button>
        </div>
      `;
      return;
    }

    const tableCount = parseInt(state.config.tableCount, 10) || 7;
    const divisionFilter = state.filters.tablesDivision;
    const isPaused = state.status.isPaused;

    let html = '';

    for (let t = 1; t <= tableCount; t++) {
      const matchId = state.tableAssignments[t];
      const match = matchId ? state.matches.find(m => m.id === matchId) : null;
      const tableDiv = getTableDivision(t);
      const isMenDedicated = tableDiv === 'male';
      const isWomenDedicated = tableDiv === 'female';

      // Division filter
      if (divisionFilter === 'male' && tableDiv === 'female') continue;
      if (divisionFilter === 'female' && tableDiv === 'male') continue;
      if (match && divisionFilter !== 'all' && match.division !== divisionFilter) continue;

      const isDivConcluded = (tableDiv === 'male' && state.status.maleConcluded) || (tableDiv === 'female' && state.status.femaleConcluded);

      if (!match) {
        let waitingMatches = state.matches.filter(m => {
          if (m.status !== 'scheduled') return false;
          if (tableDiv !== 'shared' && m.division !== tableDiv) return false;
          return true;
        });

        const isAssignedEmpty = tableDiv !== 'shared' && waitingMatches.length === 0;
        const otherDiv = tableDiv === 'male' ? 'female' : 'male';
        const isOtherConcluded = otherDiv === 'male' ? state.status.maleConcluded : state.status.femaleConcluded;
        let isFlexReady = false;

        // Auto-Flex: If assigned division has no pending matches, pull waiting matches from other division
        if (isAssignedEmpty && state.config.autoFlexEmptyTables !== false && !isOtherConcluded) {
          const flexMatches = state.matches.filter(m => m.status === 'scheduled' && m.division === otherDiv);
          if (flexMatches.length > 0) {
            waitingMatches = flexMatches;
            isFlexReady = true;
          }
        }

        let optionsHtml = waitingMatches
          .map(m => {
            const p1 = getPlayer(m.player1Id);
            const p2 = getPlayer(m.player2Id);
            const flexPrefix = isFlexReady ? `[Flex ${m.division === 'male' ? 'M' : 'F'}] ` : `[${m.division === 'male' ? 'M' : 'F'}] `;
            return `<option value="${m.id}">R${m.round} ${flexPrefix}${p1.name} vs ${p2.name}</option>`;
          })
          .join('');

        const tagClass = isMenDedicated ? 'male' : isWomenDedicated ? 'female' : '';
        const tagLabel = isMenDedicated ? "Men's Table" : isWomenDedicated ? "Women's Table" : "Shared Table";
        const flexPill = isFlexReady ? `<span class="dedicated-table-tag flex" title="Dynamic overflow enabled">Flex Ready</span>` : '';

        html += `
          <div class="table-card ${isMenDedicated ? 'dedicated-male' : isWomenDedicated ? 'dedicated-female' : ''} ${isFlexReady ? 'is-flex-active' : ''} ${isPaused ? 'is-paused-mode' : ''}">
            <div class="table-card-header">
              <div class="table-badge">
                <span class="table-indicator"></span>
                <span class="table-num">TABLE ${t}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span class="dedicated-table-tag ${tagClass}">${tagLabel}</span>
                ${flexPill}
                <span class="round-wave-pill">${isDivConcluded ? 'CONCLUDED' : (isFlexReady ? 'FLEX OPEN' : 'AVAILABLE')}</span>
              </div>
            </div>

            ${isPaused ? `
              <div class="paused-card-overlay">
                <svg class="svg-icon svg-icon-sm" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                <span>Tournament Paused</span>
              </div>
            ` : ''}

            <div class="empty-table-state">
              <svg class="empty-table-graphic" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" stroke="currentColor" fill="none" stroke-width="2"></rect><line x1="12" y1="7" x2="12" y2="21" stroke="currentColor" stroke-width="2"></line><line x1="2" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2"></line></svg>
              <p style="font-weight: 700; color: var(--text-main);">
                ${isDivConcluded ? `${tableDiv.toUpperCase()} TRIALS CONCLUDED` : (isFlexReady ? `Table Available (Auto-Flex to ${otherDiv.toUpperCase()})` : 'Table Available')}
              </p>
              <p style="font-size: 0.8rem; margin-top: 4px;">
                ${isDivConcluded ? (isFlexReady ? `Division finalized; overflow ${otherDiv} matches can play here.` : 'Division finalized. Top 7 qualifiers confirmed.') : (isFlexReady ? `${tableDiv} games finished. Open to overflow ${otherDiv} matches.` : `Assign next scheduled ${tableDiv !== 'shared' ? tableDiv : ''} match`)}
              </p>
            </div>
            <div class="table-card-footer" style="margin-top: auto;">
              ${waitingMatches.length > 0 ? `
                <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                  <select class="form-select" id="select_table_${t}" style="font-size: 0.82rem; padding: 7px 10px;" ${isPaused ? 'disabled' : ''}>
                    <option value="">-- Choose Match --</option>
                    ${optionsHtml}
                  </select>
                  <button class="btn btn-secondary btn-sm" onclick="callMatchToTable(${t}, document.getElementById('select_table_${t}').value)" ${isPaused ? 'disabled' : ''}>Assign</button>
                </div>
                <button class="btn btn-primary" style="width: 100%;" onclick="autoCallNextToTable(${t})" ${isPaused ? 'disabled' : ''}>Call Next in Queue</button>
              ` : `
                <p style="text-align: center; font-size: 0.82rem; color: var(--text-dim);">
                  ${isDivConcluded ? 'No further matches needed.' : 'No scheduled matches in queue.'}
                </p>
              `}
            </div>
          </div>
        `;
      } else {
        const p1 = getPlayer(match.player1Id);
        const p2 = getPlayer(match.player2Id);
        const isMatchWon = match.winnerId !== null;
        const winner = isMatchWon ? getPlayer(match.winnerId) : null;
        const divClass = match.division === 'male' ? 'male' : 'female';
        const divLabel = match.division === 'male' ? "MEN'S 1V1" : "WOMEN'S 1V1";
        const tagClass = isMenDedicated ? 'male' : isWomenDedicated ? 'female' : '';
        const tagLabel = isMenDedicated ? "Men's Table" : isWomenDedicated ? "Women's Table" : "Shared Table";
        const isFlexMatch = tableDiv !== 'shared' && match.division !== tableDiv;
        const flexPill = isFlexMatch ? `<span class="dedicated-table-tag flex" title="Dynamic flex overflow">Flex Table</span>` : '';

        // Determine currently active game index (0, 1, or 2)
        const curGameIdx = match.activeGame !== undefined ? match.activeGame : 0;
        const curGame = match.games[curGameIdx] || { p1: 0, p2: 0 };

        html += `
          <div class="table-card is-live ${isMenDedicated ? 'dedicated-male' : isWomenDedicated ? 'dedicated-female' : ''} ${isFlexMatch ? 'is-flex-active' : ''} ${isMatchWon ? 'is-match-won' : ''} ${isPaused ? 'is-paused-mode' : ''}">
            <div class="table-card-header">
              <div class="table-badge">
                <span class="table-indicator live"></span>
                <span class="table-num">TABLE ${t}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span class="dedicated-table-tag ${tagClass}">${tagLabel}</span>
                ${flexPill}
                <span class="gender-pill ${divClass}">${divLabel}</span>
                <span class="round-wave-pill">R${match.round}</span>
              </div>
            </div>

            ${isPaused ? `
              <div class="paused-card-overlay">
                <svg class="svg-icon svg-icon-sm" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                <span>Tournament Paused • Resume Session to Score</span>
              </div>
            ` : ''}

            <div class="matchup-container">
              <div class="players-vs-row">
                <div class="player-side p1">
                  <span class="player-side-name" title="${p1.name}">${p1.name}</span>
                </div>
                <div class="vs-divider">
                  <span class="vs-badge">VS</span>
                </div>
                <div class="player-side p2">
                  <span class="player-side-name" title="${p2.name}">${p2.name}</span>
                </div>
              </div>

              <div class="games-score-banner">
                <div class="game-score-box ${match.winnerId === match.player1Id ? 'winner' : ''}">${match.gamesWon.p1}</div>
                <div style="text-align: center;">
                  <div style="font-size: 1.1rem; font-weight: 800; color: var(--text-dim);">-</div>
                  <div class="match-format-info">Games (First to 2)</div>
                </div>
                <div class="game-score-box ${match.winnerId === match.player2Id ? 'winner' : ''}">${match.gamesWon.p2}</div>
              </div>
            </div>

            <!-- Game Selector Tabs (G1, G2, G3) -->
            <div style="font-size: 0.7rem; text-transform: uppercase; color: var(--text-dim); font-weight: 800; margin-bottom: 4px; display: flex; justify-content: space-between;">
              <span>Scoreboard Games</span>
              <span style="color: var(--accent-primary);">Active: Game ${curGameIdx + 1}</span>
            </div>
            <div class="game-selector-row">
              ${[0, 1, 2].map(gIdx => {
                const g = match.games[gIdx] || { p1: 0, p2: 0 };
                const isWon = (g.p1 >= 11 || g.p2 >= 11) && Math.abs(g.p1 - g.p2) >= 2;
                const isActive = gIdx === curGameIdx;
                return `
                  <button type="button" class="game-tab-pill ${isActive ? 'active' : ''} ${isWon ? 'completed' : ''}" 
                    onclick="setActiveGame(${t}, ${gIdx})" ${isPaused ? 'disabled' : ''}>
                    <span>Game ${gIdx + 1}</span>
                    <span class="game-tab-score">${g.p1} - ${g.p2}</span>
                  </button>
                `;
              }).join('')}
            </div>

            <!-- Active Game Point Incrementer Strip -->
            <div class="active-game-control-strip">
              <div class="player-pt-control p1">
                <div class="pt-control-name">${p1.name.split(' ')[0]}</div>
                <div class="pt-control-buttons">
                  <button type="button" class="btn-pt-sub" onclick="changeGamePoint(${t}, 1, -1)" title="Minus 1 point" ${isPaused ? 'disabled' : ''}>-</button>
                  <input type="number" min="0" max="99" class="pt-control-input" value="${curGame.p1}" 
                    onchange="updateGamePoints(${t}, ${curGameIdx}, this.value, ${curGame.p2})" ${isPaused ? 'disabled' : ''}>
                  <button type="button" class="btn-pt-add" onclick="changeGamePoint(${t}, 1, 1)" title="Add 1 point (+1 Pt)" ${isPaused ? 'disabled' : ''}>+1 Pt</button>
                </div>
              </div>

              <div class="pt-control-vs">
                <span class="pt-control-gametag">G${curGameIdx + 1}</span>
                <span class="pt-control-score">${curGame.p1} : ${curGame.p2}</span>
              </div>

              <div class="player-pt-control p2">
                <div class="pt-control-name">${p2.name.split(' ')[0]}</div>
                <div class="pt-control-buttons">
                  <button type="button" class="btn-pt-add" onclick="changeGamePoint(${t}, 2, 1)" title="Add 1 point (+1 Pt)" ${isPaused ? 'disabled' : ''}>+1 Pt</button>
                  <input type="number" min="0" max="99" class="pt-control-input" value="${curGame.p2}" 
                    onchange="updateGamePoints(${t}, ${curGameIdx}, ${curGame.p1}, this.value)" ${isPaused ? 'disabled' : ''}>
                  <button type="button" class="btn-pt-sub" onclick="changeGamePoint(${t}, 2, -1)" title="Minus 1 point" ${isPaused ? 'disabled' : ''}>-</button>
                </div>
              </div>
            </div>

            <!-- Quick Game Score Presets -->
            <div class="quick-score-presets">
              <span class="preset-label">Quick Score:</span>
              <button type="button" class="btn-preset p1" onclick="setGameScorePreset(${t}, ${curGameIdx}, 11, 9)" title="11-9 for ${p1.name}" ${isPaused ? 'disabled' : ''}>11-9 ${p1.name.split(' ')[0]}</button>
              <button type="button" class="btn-preset p1" onclick="setGameScorePreset(${t}, ${curGameIdx}, 11, 7)" title="11-7 for ${p1.name}" ${isPaused ? 'disabled' : ''}>11-7 ${p1.name.split(' ')[0]}</button>
              <button type="button" class="btn-preset p2" onclick="setGameScorePreset(${t}, ${curGameIdx}, 7, 11)" title="11-7 for ${p2.name}" ${isPaused ? 'disabled' : ''}>${p2.name.split(' ')[0]} 11-7</button>
              <button type="button" class="btn-preset p2" onclick="setGameScorePreset(${t}, ${curGameIdx}, 9, 11)" title="11-9 for ${p2.name}" ${isPaused ? 'disabled' : ''}>${p2.name.split(' ')[0]} 11-9</button>
              <button type="button" class="btn-preset reset" onclick="setGameScorePreset(${t}, ${curGameIdx}, 0, 0)" title="Reset G${curGameIdx + 1}" ${isPaused ? 'disabled' : ''}>Reset</button>
            </div>

            <!-- Quick +1 Game Buttons -->
            <div class="quick-game-controls">
              <button class="quick-game-btn p1" onclick="incrementGame(${t}, 1)" ${isPaused ? 'disabled' : ''}>
                <span>+1 Game</span> <strong>${p1.name.split(' ')[0]}</strong>
              </button>
              <button class="quick-game-btn p2" onclick="incrementGame(${t}, 2)" ${isPaused ? 'disabled' : ''}>
                <span>+1 Game</span> <strong>${p2.name.split(' ')[0]}</strong>
              </button>
            </div>

            ${isMatchWon ? `
              <div class="winner-callout">
                Winner: ${winner.name} (${match.gamesWon.p1}-${match.gamesWon.p2})
              </div>
            ` : ''}

            <div class="table-card-footer" style="margin-top: auto; display: flex; flex-direction: column; gap: 8px;">
              ${isMatchWon ? `
                <button class="btn btn-primary" onclick="completeMatch(${t})" ${isPaused ? 'disabled' : ''}>
                  Submit & Complete Match
                </button>
              ` : `
                <button class="btn btn-secondary" style="opacity: 0.65; cursor: not-allowed;" title="Requires 2 game wins to complete">
                  Playing (First to 2 wins)
                </button>
              `}
              <div style="display: flex; gap: 8px; justify-content: space-between;">
                <button class="btn btn-secondary btn-sm" onclick="releaseTable(${t})" title="Release match back to queue" ${isPaused ? 'disabled' : ''}>
                  Return to Queue
                </button>
                <div style="display: flex; gap: 4px;">
                  <button class="btn btn-secondary btn-sm" onclick="decrementGame(${t}, 1)" title="Undo 1 game from ${p1.name}" ${isPaused ? 'disabled' : ''}>-1 P1</button>
                  <button class="btn btn-secondary btn-sm" onclick="decrementGame(${t}, 2)" title="Undo 1 game from ${p2.name}" ${isPaused ? 'disabled' : ''}>-1 P2</button>
                </div>
              </div>
            </div>
          </div>
        `;
      }
    }

    container.innerHTML = html;
  }

  function renderStandings() {
    renderDivisionStandings('male', 'standingsMaleContainer', state.ui.showAllMales);
    renderDivisionStandings('female', 'standingsFemaleContainer', state.ui.showAllFemales);
    renderDivisionConclusionBanners();
  }

  function renderDivisionConclusionBanners() {
    const maleBanner = document.getElementById('maleConcludedBanner');
    const femaleBanner = document.getElementById('femaleConcludedBanner');
    const btnMale = document.getElementById('btnToggleConcludeMale');
    const btnFemale = document.getElementById('btnToggleConcludeFemale');

    if (maleBanner) {
      maleBanner.innerHTML = state.status.maleConcluded ? `
        <div class="division-concluded-banner">
          <div>
            <div style="font-weight: 900; font-size: 0.95rem;">MEN'S DIVISION CONCLUDED</div>
            <div style="font-size: 0.78rem; font-weight: 600;">Official Top 7 Qualifiers have been finalized.</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="toggleConcludeDivision('male')">Re-open Trials</button>
        </div>
      ` : '';
    }

    if (femaleBanner) {
      femaleBanner.innerHTML = state.status.femaleConcluded ? `
        <div class="division-concluded-banner">
          <div>
            <div style="font-weight: 900; font-size: 0.95rem;">WOMEN'S DIVISION CONCLUDED</div>
            <div style="font-size: 0.78rem; font-weight: 600;">Official Top 7 Qualifiers have been finalized.</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="toggleConcludeDivision('female')">Re-open Trials</button>
        </div>
      ` : '';
    }

    if (btnMale) btnMale.textContent = state.status.maleConcluded ? 'Re-open' : "End Men's Trials";
    if (btnFemale) btnFemale.textContent = state.status.femaleConcluded ? 'Re-open' : "End Women's Trials";
  }

  function renderDivisionStandings(division, containerId, showAll) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const list = calculateStandings(division);
    const totalCount = list.length;
    const displayList = showAll ? list : list.slice(0, 7);

    let rowsHtml = '';

    displayList.forEach((item, index) => {
      const rank = index + 1;
      let rankBadgeClass = 'rank-other';
      if (rank === 1) rankBadgeClass = 'rank-1';
      else if (rank === 2) rankBadgeClass = 'rank-2';
      else if (rank === 3) rankBadgeClass = 'rank-3';
      else if (rank <= 7) rankBadgeClass = 'rank-top7';

      const isTop7 = rank <= 7;
      const isCutoffRow = rank === 7 && totalCount > 7 && showAll;

      const initials = item.player.name
        .split(' ')
        .map(n => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();

      const formDots = item.recentForm
        .map(f => `<span class="form-dot ${f.toLowerCase()}"></span>`)
        .join('');

      rowsHtml += `
        <tr class="${isTop7 ? 'top-7-row' : ''} ${isCutoffRow ? 'top-7-cutoff' : ''}">
          <td>
            <span class="rank-badge ${rankBadgeClass}">${rank}</span>
          </td>
          <td class="td-left">
            <div class="player-name-cell">
              <span class="player-initials">${initials}</span>
              <span>${item.player.name}</span>
              ${isTop7 ? '<span style="font-size: 0.65rem; color: var(--accent-amber-text); font-weight: 800; background: var(--accent-amber-bg); padding: 1px 6px; border-radius: 4px; border: 1px solid var(--accent-amber-border);">TOP 7</span>' : ''}
            </div>
          </td>
          <td>${item.played}</td>
          <td style="color: var(--accent-primary); font-weight: 900;">${item.won}</td>
          <td style="color: var(--text-dim);">${item.lost}</td>
          <td>${item.winPct}%</td>
          <td style="font-weight: 800; color: ${item.gameDiff > 0 ? 'var(--accent-primary)' : 'var(--text-dim)'}">
            ${item.gameDiff > 0 ? '+' : ''}${item.gameDiff}
          </td>
          <td style="color: ${item.pointDiff > 0 ? 'var(--accent-primary)' : 'var(--text-dim)'}">
            ${item.pointDiff > 0 ? '+' : ''}${item.pointDiff}
          </td>
          <td>
            <div class="form-dots">${formDots || '<span style="color: var(--text-dim);">-</span>'}</div>
          </td>
        </tr>
      `;
    });

    if (displayList.length === 0) {
      rowsHtml = `<tr><td colspan="9" style="text-align: center; padding: 24px; color: var(--text-dim);">No athletes registered in this division.</td></tr>`;
    }

    const toggleBtnText = showAll ? 'Show Top 7 Only' : `View All (${totalCount}) Athletes`;
    const toggleVisible = totalCount > 7;

    container.innerHTML = `
      <div class="standings-table-wrap">
        <table class="standings-table">
          <thead>
            <tr>
              <th style="width: 48px;">Rank</th>
              <th class="th-left">Athlete</th>
              <th title="Matches Played">MP</th>
              <th title="Matches Won">W</th>
              <th title="Matches Lost">L</th>
              <th title="Win Percentage">Win%</th>
              <th title="Game Difference (Games Won - Games Lost)">GD</th>
              <th title="Point Difference (Points Won - Points Lost)">PD</th>
              <th title="Recent Match Form">Form</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>

      ${toggleVisible ? `
        <div style="margin-top: 12px; display: flex; justify-content: flex-end;">
          <button class="btn btn-secondary btn-sm" onclick="toggleDivisionExpand('${division}')">
            ${toggleBtnText}
          </button>
        </div>
      ` : ''}
    `;
  }

  window.toggleDivisionExpand = function (division) {
    if (division === 'male') {
      state.ui.showAllMales = !state.ui.showAllMales;
    } else {
      state.ui.showAllFemales = !state.ui.showAllFemales;
    }
    renderStandings();
  };

  function renderFixtures() {
    const container = document.getElementById('fixturesContainer');
    if (!container) return;

    const roundFilter = state.filters.fixturesRound;
    const divisionFilter = state.filters.fixturesDivision;

    const roundsMap = {};
    state.matches.forEach(m => {
      if (divisionFilter !== 'all' && m.division !== divisionFilter) return;
      if (roundFilter !== 'all' && m.round.toString() !== roundFilter) return;

      if (!roundsMap[m.round]) roundsMap[m.round] = [];
      roundsMap[m.round].push(m);
    });

    const roundNumbers = Object.keys(roundsMap).map(Number).sort((a, b) => a - b);

    if (roundNumbers.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-dim); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px solid var(--border-subtle);">
          <p style="font-weight: 700;">No fixtures found matching current filters.</p>
        </div>
      `;
      return;
    }

    let html = '';

    roundNumbers.forEach(roundNum => {
      const matchesInRound = roundsMap[roundNum];
      const completedCount = matchesInRound.filter(m => m.status === 'completed').length;
      const roundProgress = Math.round((completedCount / matchesInRound.length) * 100);

      html += `
        <div class="round-section">
          <div class="round-section-header">
            <div class="round-section-title">
              <span>ROUND ${roundNum}</span>
              <span class="badge-tag-gold">${matchesInRound.length} Matches</span>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); font-family: var(--font-mono); font-weight: 700;">
              ${completedCount}/${matchesInRound.length} Completed (${roundProgress}%)
            </div>
          </div>

          <div class="matches-list-grid">
            ${matchesInRound.map(m => {
              const p1 = getPlayer(m.player1Id);
              const p2 = getPlayer(m.player2Id);
              const isCompleted = m.status === 'completed';
              const isLive = m.status === 'live';

              return `
                <div class="fixture-card ${isLive ? 'is-live' : ''}">
                  <div class="fixture-top">
                    <span class="gender-pill ${m.division === 'male' ? 'male' : 'female'}">
                      ${m.division.toUpperCase()}
                    </span>
                    ${m.table ? `
                      <span class="fixture-table-badge">TABLE ${m.table}</span>
                    ` : `
                      <span style="font-size: 0.75rem; color: var(--text-dim);">Queue</span>
                    `}
                  </div>

                  <div class="fixture-matchup">
                    <div class="fixture-player ${m.winnerId === m.player1Id ? 'winner' : ''}">
                      <span>${p1.name}</span>
                    </div>
                    <span style="font-size: 0.75rem; color: var(--text-dim); font-weight: 800;">vs</span>
                    <div class="fixture-player ${m.winnerId === m.player2Id ? 'winner' : ''}">
                      <span>${p2.name}</span>
                    </div>
                  </div>

                  <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--border-subtle);">
                    <div style="font-size: 0.75rem; font-weight: 800;">
                      ${isCompleted ? `
                        <span style="color: var(--accent-primary);">Finished</span>
                      ` : isLive ? `
                        <span style="color: var(--accent-primary);">Live on Table ${m.table}</span>
                      ` : `
                        <span style="color: var(--text-dim);">Scheduled</span>
                      `}
                    </div>

                    <div class="fixture-score-badge ${isCompleted ? 'completed' : ''}">
                      ${isCompleted || isLive ? `${m.gamesWon.p1} - ${m.gamesWon.p2}` : 'Best of 3'}
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  function renderLogs() {
    const container = document.getElementById('logsTimeline');
    if (!container) return;

    const divisionFilter = state.filters.logsDivision;
    const searchFilter = state.filters.logsSearch.toLowerCase().trim();

    const filteredLogs = state.logs.filter(log => {
      if (divisionFilter !== 'all' && log.division && log.division !== divisionFilter) return false;
      if (searchFilter) {
        const text = (log.text || '').toLowerCase();
        const p1 = (log.p1Name || '').toLowerCase();
        const p2 = (log.p2Name || '').toLowerCase();
        if (!text.includes(searchFilter) && !p1.includes(searchFilter) && !p2.includes(searchFilter)) {
          return false;
        }
      }
      return true;
    });

    if (filteredLogs.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-dim); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px solid var(--border-subtle);">
          <p style="font-weight: 700;">No match activity logs recorded yet.</p>
          <p style="font-size: 0.8rem; margin-top: 4px;">Completed matches, late entries, and session events appear here automatically.</p>
        </div>
      `;
      return;
    }

    let html = '';
    filteredLogs.forEach(log => {
      const divBadge = log.division
        ? `<span class="gender-pill ${log.division === 'male' ? 'male' : 'female'}">${log.division.toUpperCase()}</span>`
        : '';

      html += `
        <div class="log-item">
          <div class="log-main-info">
            <span class="log-time">${log.time}</span>
            ${divBadge}
            <div class="log-result-text">
              ${log.text}
            </div>
          </div>
          ${log.scoreStr ? `
            <div class="log-score-breakdown">
              ${log.scoreStr}
            </div>
          ` : ''}
        </div>
      `;
    });

    container.innerHTML = html;
  }

  function renderSetupView() {
    const mInput = document.getElementById('configTablesMale');
    const fInput = document.getElementById('configTablesFemale');
    if (mInput && document.activeElement !== mInput) mInput.value = state.config.tablesMale || 4;
    if (fInput && document.activeElement !== fInput) fInput.value = state.config.tablesFemale || 3;

    const mLabel = document.getElementById('menTablesRangeLabel');
    const fLabel = document.getElementById('womenTablesRangeLabel');
    const mCount = state.config.tablesMale || 4;
    const fCount = state.config.tablesFemale || 3;
    if (mLabel) mLabel.textContent = `Tables 1 to ${mCount}`;
    if (fLabel) fLabel.textContent = `Tables ${mCount + 1} to ${mCount + fCount}`;

    // Table Mode Radios
    const modeRadios = document.querySelectorAll('input[name="tableAllocMode"]');
    modeRadios.forEach(r => {
      r.checked = r.value === state.config.tableAllocationMode;
    });

    const rosterBody = document.getElementById('rosterTableBody');
    if (!rosterBody) return;

    let html = '';
    state.players.forEach((p, idx) => {
      html += `
        <tr>
          <td style="font-family: var(--font-mono); color: var(--text-dim); font-weight: 700;">${idx + 1}</td>
          <td style="font-weight: 700;">${p.name}</td>
          <td>
            <span class="gender-pill ${p.gender}">
              ${p.gender === 'male' ? 'Male' : 'Female'}
            </span>
          </td>
          <td style="text-align: right;">
            <button class="btn btn-secondary btn-sm" onclick="togglePlayerGender('${p.id}')" title="Switch Gender">
              Switch
            </button>
            <button class="btn btn-danger btn-sm" onclick="removePlayer('${p.id}')" title="Remove Athlete">
              Remove
            </button>
          </td>
        </tr>
      `;
    });

    if (state.players.length === 0) {
      html = `<tr><td colspan="4" style="text-align: center; padding: 26px 16px; color: var(--text-muted); font-size: 0.9rem;">No athletes registered yet. Enter athlete names above or click <strong>Bulk Paste Athletes</strong> to add your roster.</td></tr>`;
    }

    rosterBody.innerHTML = html;

    const maleCount = state.players.filter(p => p.gender === 'male').length;
    const femaleCount = state.players.filter(p => p.gender === 'female').length;
    const maleMatches = (maleCount * (maleCount - 1)) / 2;
    const femaleMatches = (femaleCount * (femaleCount - 1)) / 2;
    const totalEstMatches = maleMatches + femaleMatches;

    const calcEl = document.getElementById('rosterCalculationSummary');
    if (calcEl) {
      calcEl.innerHTML = `
        <strong>${state.players.length} Athletes</strong> (${maleCount} Male, ${femaleCount} Female)<br>
        • Men's 1v1 Matches: <strong>${maleMatches}</strong> (running on ${mCount} Men's Tables)<br>
        • Women's 1v1 Matches: <strong>${femaleMatches}</strong> (running on ${fCount} Women's Tables)<br>
        • Total Matches: <strong>${totalEstMatches}</strong> across <strong>${state.config.tableCount} tables</strong>
      `;
    }
  }

  // --- Setup Actions ---
  window.addPlayer = function () {
    if (checkPausedAction()) return;
    const nameInput = document.getElementById('newPlayerName');
    const gender = document.querySelector('input[name="newPlayerGender"]:checked')?.value || 'male';

    if (!nameInput || !nameInput.value.trim()) {
      showToast('Please enter an athlete name.', 'warning');
      return;
    }

    const newPlayer = {
      id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      name: nameInput.value.trim(),
      gender: gender
    };

    state.players.push(newPlayer);
    nameInput.value = '';
    nameInput.focus();

    saveState();
    renderSetupView();
    renderHeaderStats();
    showToast(`Added ${newPlayer.name} to roster`, 'success');
  };

  window.removePlayer = function (id) {
    if (checkPausedAction()) return;
    state.players = state.players.filter(p => p.id !== id);
    saveState();
    renderSetupView();
    renderHeaderStats();
    showToast('Athlete removed', 'info');
  };

  window.togglePlayerGender = function (id) {
    if (checkPausedAction()) return;
    const player = state.players.find(p => p.id === id);
    if (player) {
      player.gender = player.gender === 'male' ? 'female' : 'male';
      saveState();
      renderSetupView();
      renderHeaderStats();
    }
  };

  window.toggleBulkAdd = function () {
    const panel = document.getElementById('bulkAddPanel');
    if (!panel) return;
    const isHidden = panel.style.display === 'none';
    panel.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
      const textarea = document.getElementById('bulkPlayerNames');
      if (textarea) textarea.focus();
    }
  };

  window.submitBulkPlayers = function () {
    if (checkPausedAction()) return;
    const textarea = document.getElementById('bulkPlayerNames');
    if (!textarea || !textarea.value.trim()) {
      showToast('Please enter athlete names, one per line.', 'warning');
      return;
    }

    const gender = document.querySelector('input[name="bulkGender"]:checked')?.value || 'male';
    const lines = textarea.value.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length === 0) {
      showToast('No valid athlete names found.', 'warning');
      return;
    }

    let addedCount = 0;
    lines.forEach(name => {
      state.players.push({
        id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        name: name,
        gender: gender
      });
      addedCount++;
    });

    textarea.value = '';
    window.toggleBulkAdd();
    saveState();
    renderSetupView();
    renderHeaderStats();
    showToast(`Added ${addedCount} ${gender} athletes to roster!`, 'success');
  };

  window.clearAllPlayers = function () {
    if (confirm('Are you sure you want to clear the entire athlete roster and reset all matches to start fresh?')) {
      state.players = [];
      state.matches = [];
      state.tableAssignments = {};
      state.logs = [];
      state.status.maleConcluded = false;
      state.status.femaleConcluded = false;
      state.status.isPaused = false;
      state.status.pausedDay = 0;
      state.status.pausedAt = null;
      saveState();
      renderAll();
      showToast('Athlete roster and all matches cleared. Day reset to 0.', 'info');
    }
  };

  window.promptResetTournament = function () {
    const modal = document.getElementById('resetModal');
    if (modal) modal.classList.add('open');
  };

  window.closeResetModal = function () {
    const modal = document.getElementById('resetModal');
    if (modal) modal.classList.remove('open');
  };

  window.confirmResetTournament = function () {
    state.matches = [];
    state.logs = [];
    state.tableAssignments = {};
    state.status.maleConcluded = false;
    state.status.femaleConcluded = false;
    state.status.isPaused = false;
    state.status.pausedDay = 0;
    state.status.pausedAt = null;
    saveState();
    closeResetModal();
    renderAll();
    showToast('Tournament reset. Day reset to 0.', 'info');
  };

  window.exportStandingsCSV = function () {
    const maleStandings = calculateStandings('male');
    const femaleStandings = calculateStandings('female');

    let csv = 'DIVISION,RANK,PLAYER,MATCHES_PLAYED,WON,LOST,WIN_PCT,GAME_DIFF,POINT_DIFF\n';

    maleStandings.forEach((s, idx) => {
      csv += `Men,${idx + 1},"${s.player.name}",${s.played},${s.won},${s.lost},${s.winPct}%,${s.gameDiff},${s.pointDiff}\n`;
    });

    femaleStandings.forEach((s, idx) => {
      csv += `Women,${idx + 1},"${s.player.name}",${s.played},${s.won},${s.lost},${s.winPct}%,${s.gameDiff},${s.pointDiff}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `TT_Trials_Standings_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Exported Standings CSV', 'success');
  };

  window.printReport = function () {
    window.print();
  };

  window.switchTab = function (tabName) {
    state.currentTab = tabName;

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    const views = ['tables', 'standings', 'fixtures', 'logs', 'setup'];
    views.forEach(v => {
      const el = document.getElementById(`view_${v}`);
      if (el) {
        el.style.display = v === tabName ? 'block' : 'none';
      }
    });

    if (tabName === 'fixtures') {
      populateFixturesRoundFilter();
    }

    renderAll();
  };

  function populateFixturesRoundFilter() {
    const select = document.getElementById('fixturesRoundFilter');
    if (!select) return;

    const roundSet = new Set(state.matches.map(m => m.round));
    const rounds = Array.from(roundSet).sort((a, b) => a - b);

    let html = '<option value="all">All Rounds</option>';
    rounds.forEach(r => {
      html += `<option value="${r}" ${state.filters.fixturesRound === r.toString() ? 'selected' : ''}>Round ${r}</option>`;
    });
    select.innerHTML = html;
  }

  function renderAll() {
    renderHeaderStats();
    if (state.currentTab === 'tables') renderLiveTables();
    if (state.currentTab === 'standings') renderStandings();
    if (state.currentTab === 'fixtures') renderFixtures();
    if (state.currentTab === 'logs') renderLogs();
    if (state.currentTab === 'setup') renderSetupView();
  }

  window.toggleSound = function () {
    SoundFX.muted = !SoundFX.muted;
    const textEl = document.getElementById('soundToggleText');
    const iconEl = document.getElementById('soundIcon');
    if (textEl) {
      textEl.textContent = SoundFX.muted ? 'Muted' : 'Sound';
    }
    if (iconEl) {
      if (SoundFX.muted) {
        iconEl.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>`;
      } else {
        iconEl.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>`;
      }
    }
  };

  // --- Init ---
  document.addEventListener('DOMContentLoaded', () => {
    const initialTheme = getTheme();
    applyTheme(initialTheme);

    loadState();

    // Default landing page is always the first page of the website (Live Tables)
    switchTab('tables');

    const playerInput = document.getElementById('newPlayerName');
    if (playerInput) {
      playerInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') addPlayer();
      });
    }

    const latePlayerInput = document.getElementById('latePlayerName');
    if (latePlayerInput) {
      latePlayerInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') confirmAddLatePlayer();
      });
    }

    document.querySelectorAll('.tables-div-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.tables-div-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.filters.tablesDivision = chip.dataset.div;
        renderLiveTables();
      });
    });

    const roundSelect = document.getElementById('fixturesRoundFilter');
    if (roundSelect) {
      roundSelect.addEventListener('change', e => {
        state.filters.fixturesRound = e.target.value;
        renderFixtures();
      });
    }

    const divSelect = document.getElementById('fixturesDivFilter');
    if (divSelect) {
      divSelect.addEventListener('change', e => {
        state.filters.fixturesDivision = e.target.value;
        renderFixtures();
      });
    }

    const logDivSelect = document.getElementById('logsDivFilter');
    if (logDivSelect) {
      logDivSelect.addEventListener('change', e => {
        state.filters.logsDivision = e.target.value;
        renderLogs();
      });
    }

    const logSearchInput = document.getElementById('logsSearchInput');
    if (logSearchInput) {
      logSearchInput.addEventListener('input', e => {
        state.filters.logsSearch = e.target.value;
        renderLogs();
      });
    }

    renderAll();
  });

  window.generateTournament = generateTournament;
  window.addLatePlayerToTournament = addLatePlayerToTournament;

})();
