/**
 * Table Tennis Trials - Tournament Management System
 * Features:
 * - Dynamic Player & Table Configuration
 * - Gender-segregated Round Robin Scheduler (Male vs Male, Female vs Female)
 * - Multi-Table Simultaneous Wave Allocation (Tables 1..T)
 * - Best of 3 Games (First to 2 wins) Live Scoring
 * - Live Standings with Top 7 Qualification Cutoffs
 * - Real-time Match Logs & Audit Trail with Undo/Edit
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

  // --- Initial Default State (15 Players, 7 Tables as requested) ---
  const DEFAULT_PLAYERS = [
    { id: 'p_1', name: 'Marcus Chen', gender: 'male' },
    { id: 'p_2', name: 'David Zhang', gender: 'male' },
    { id: 'p_3', name: 'Alexander Wong', gender: 'male' },
    { id: 'p_4', name: 'Ethan Miller', gender: 'male' },
    { id: 'p_5', name: 'Lucas Vance', gender: 'male' },
    { id: 'p_6', name: 'Kenji Sato', gender: 'male' },
    { id: 'p_7', name: 'Daniel Silva', gender: 'male' },
    { id: 'p_8', name: 'Vikram Patel', gender: 'male' },
    { id: 'p_9', name: 'Timo Becker', gender: 'male' },
    { id: 'p_10', name: 'Leo Fontaine', gender: 'male' },
    { id: 'p_11', name: 'Elena Rostova', gender: 'female' },
    { id: 'p_12', name: 'Chloe Dubois', gender: 'female' },
    { id: 'p_13', name: 'Yuki Tanaka', gender: 'female' },
    { id: 'p_14', name: 'Maya Lin', gender: 'female' },
    { id: 'p_15', name: 'Sophie Taylor', gender: 'female' }
  ];

  // --- App State ---
  const STORAGE_KEY = 'tt_trials_tournament_data_v1';

  let state = {
    config: {
      tableCount: 7,
      gamesToWin: 2, // Best of 3 (first to two)
      maxGames: 3,
      tournamentName: 'Official Table Tennis Selection Trials'
    },
    currentTab: 'tables', // 'tables', 'standings', 'fixtures', 'logs', 'setup'
    players: [...DEFAULT_PLAYERS],
    matches: [],
    logs: [],
    // Active table mapping: tableNumber (1..N) -> matchId or null
    tableAssignments: {},
    filters: {
      tablesDivision: 'all', // 'all', 'male', 'female'
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

  // --- LocalStorage Persistence ---
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      updateSavedIndicator();
    } catch (e) {
      console.error('Failed to save tournament state to localStorage', e);
    }
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
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
        if (el) el.style.opacity = '0.6';
      }, 1500);
    }
  }

  // --- Toast Notification Helper ---
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    const icon = type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  // --- Round Robin Tournament Scheduler ---
  /**
   * Circle Method for Round-Robin Tournament
   * Ensures every player plays every other player in their division exactly once.
   * If odd count, adds a dummy BYE player so each round has pairs.
   */
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

        // Skip byes
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

      // Rotate players keeping index 0 fixed
      const fixed = pool[0];
      const rest = pool.slice(1);
      const last = rest.pop();
      rest.unshift(last);
      pool.splice(0, pool.length, fixed, ...rest);
    }

    return divisionRounds;
  }

  /**
   * Master Schedule Generator
   * Pairs Male vs Male only, Female vs Female only.
   * Interleaves rounds into Master Tournament Rounds and schedules across T tables.
   */
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

      // Interleave matches nicely (Men and Women)
      const combinedRoundMatches = [];
      const maxLen = Math.max(mMatches.length, fMatches.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < mMatches.length) combinedRoundMatches.push(mMatches[i]);
        if (i < fMatches.length) combinedRoundMatches.push(fMatches[i]);
      }

      // Schedule round matches
      combinedRoundMatches.forEach((m, idx) => {
        newMatches.push({
          id: `match_${matchCounter++}`,
          round: roundNumber,
          division: m.division,
          player1Id: m.p1Id,
          player2Id: m.p2Id,
          status: 'scheduled', // 'scheduled', 'live', 'completed'
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

    // Initialize tables 1 to T
    const tableCount = parseInt(state.config.tableCount, 10) || 7;
    for (let t = 1; t <= tableCount; t++) {
      state.tableAssignments[t] = null;
    }

    // Auto-dispatch initial matches to available tables
    autoFillEmptyTables();

    // Log start event
    logEvent({
      text: `Tournament generated: ${state.players.length} players (${malePlayers.length} Male, ${femalePlayers.length} Female), ${state.matches.length} total matches across ${tableCount} tables.`
    });

    saveState();
    renderAll();
    showToast(`Schedule generated! ${state.matches.length} matches across ${maxRounds} rounds.`, 'success');
    return true;
  }

  // --- Auto-Dispatch Matches to Empty Tables ---
  function autoFillEmptyTables() {
    const tableCount = parseInt(state.config.tableCount, 10) || 7;
    const activePlayerIds = new Set();

    // Find which players are already live on a table
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

    // Assign next eligible scheduled match to each open table
    for (let t = 1; t <= tableCount; t++) {
      if (!state.tableAssignments[t]) {
        const nextMatch = state.matches.find(m => {
          if (m.status !== 'scheduled') return false;
          // Ensure neither player is currently playing on another table
          if (activePlayerIds.has(m.player1Id) || activePlayerIds.has(m.player2Id)) return false;
          return true;
        });

        if (nextMatch) {
          nextMatch.status = 'live';
          nextMatch.table = t;
          state.tableAssignments[t] = nextMatch.id;
          activePlayerIds.add(nextMatch.player1Id);
          activePlayerIds.add(nextMatch.player2Id);
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

  // --- Match Score Handling ---
  function getPlayer(id) {
    return state.players.find(p => p.id === id) || { name: 'Unknown', gender: 'unknown' };
  }

  /**
   * Increment game win for player 1 or player 2
   */
  window.incrementGame = function (tableNum, playerNum) {
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

    // Check winner
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

  /**
   * Decrement game win (for corrections)
   */
  window.decrementGame = function (tableNum, playerNum) {
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

  /**
   * Update point inputs for detailed game scoring
   */
  window.updateGamePoints = function (tableNum, gameIdx, p1Pts, p2Pts) {
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

    // Auto-calculate games won if user used points
    let p1Wins = 0;
    let p2Wins = 0;
    match.games.forEach(g => {
      if ((g.p1 >= 11 || g.p2 >= 11) && Math.abs(g.p1 - g.p2) >= 2) {
        if (g.p1 > g.p2) p1Wins++;
        else p2Wins++;
      }
    });

    if (p1Wins > 0 || p2Wins > 0) {
      match.gamesWon.p1 = p1Wins;
      match.gamesWon.p2 = p2Wins;
      if (p1Wins >= state.config.gamesToWin) {
        match.winnerId = match.player1Id;
      } else if (p2Wins >= state.config.gamesToWin) {
        match.winnerId = match.player2Id;
      } else {
        match.winnerId = null;
      }
    }

    saveState();
    renderLiveTables();
    renderStandings();
  };

  /**
   * Preset Score filler (e.g. 11-8, 11-9)
   */
  window.applyPresetScore = function (tableNum, gameIdx, p1, p2) {
    updateGamePoints(tableNum, gameIdx, p1, p2);
  };

  /**
   * Complete Match on Table
   */
  window.completeMatch = function (tableNum) {
    const matchId = state.tableAssignments[tableNum];
    if (!matchId) return;
    const match = state.matches.find(m => m.id === matchId);
    if (!match) return;

    if (!match.winnerId) {
      showToast('Match is not decided yet! A player must win 2 games.', 'warning');
      return;
    }

    match.status = 'completed';
    match.completedAt = new Date().toISOString();

    const p1 = getPlayer(match.player1Id);
    const p2 = getPlayer(match.player2Id);
    const winner = match.winnerId === match.player1Id ? p1 : p2;
    const loser = match.winnerId === match.player1Id ? p2 : p1;

    // Detailed scores summary
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
    showToast(`Table ${tableNum} Match Completed! ${winner.name} won.`, 'success');

    // Free the table
    state.tableAssignments[tableNum] = null;

    // Auto dispatch next eligible match
    autoFillEmptyTables();

    saveState();
    renderAll();
  };

  /**
   * Manual Match Call to Table
   */
  window.callMatchToTable = function (tableNum, matchId) {
    if (!matchId) return;
    const match = state.matches.find(m => m.id === matchId);
    if (!match) return;

    // Verify neither player is already active on another table
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
            showToast('Cannot assign: One of these players is currently playing on Table ' + t, 'warning');
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

  /**
   * Release match from table back to queue
   */
  window.releaseTable = function (tableNum) {
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
    showToast(`Table ${tableNum} cleared`, 'info');
  };

  // --- Standings & Leaderboard Calculation ---
  /**
   * Calculates standings for a given division:
   * Rank criteria:
   * 1. Matches Won (W)
   * 2. Win Percentage
   * 3. Game Differential (GW - GL)
   * 4. Point Differential (PW - PL)
   * 5. Total Games Won
   */
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
        recentForm: [] // array of 'W' or 'L'
      };
    });

    // Sort matches chronologically to track form
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

      // Sum points if recorded
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

    // Compute differentials and percentages
    const standings = Object.values(stats).map(s => {
      s.gameDiff = s.gamesWon - s.gamesLost;
      s.pointDiff = s.pointsWon - s.pointsLost;
      s.winPct = s.played > 0 ? ((s.won / s.played) * 100).toFixed(1) : '0.0';
      s.recentForm = s.recentForm.slice(-4); // keep last 4
      return s;
    });

    // Sort leaderboard
    standings.sort((a, b) => {
      if (b.won !== a.won) return b.won - a.won;
      if (parseFloat(b.winPct) !== parseFloat(a.winPct)) return parseFloat(b.winPct) - parseFloat(a.winPct);
      if (b.gameDiff !== a.gameDiff) return b.gameDiff - a.gameDiff;
      if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
      return b.gamesWon - a.gamesWon;
    });

    return standings;
  }

  // --- Render Functions ---

  function renderHeaderStats() {
    const totalMatches = state.matches.length;
    const completedMatches = state.matches.filter(m => m.status === 'completed').length;
    const liveMatches = state.matches.filter(m => m.status === 'live').length;
    const scheduledMatches = state.matches.filter(m => m.status === 'scheduled').length;
    const progressPct = totalMatches > 0 ? Math.round((completedMatches / totalMatches) * 100) : 0;

    const maleCount = state.players.filter(p => p.gender === 'male').length;
    const femaleCount = state.players.filter(p => p.gender === 'female').length;

    const statTotalEl = document.getElementById('statTotalMatches');
    const statCompletedEl = document.getElementById('statCompletedMatches');
    const statLiveEl = document.getElementById('statLiveMatches');
    const statPlayersEl = document.getElementById('statTotalPlayers');
    const statProgressEl = document.getElementById('statProgress');

    if (statTotalEl) statTotalEl.textContent = totalMatches;
    if (statCompletedEl) statCompletedEl.textContent = `${completedMatches} (${progressPct}%)`;
    if (statLiveEl) statLiveEl.textContent = liveMatches;
    if (statPlayersEl) statPlayersEl.textContent = `${state.players.length} (${maleCount}M / ${femaleCount}F)`;
    if (statProgressEl) statProgressEl.textContent = `${progressPct}%`;
  }

  function renderLiveTables() {
    const container = document.getElementById('tablesGrid');
    if (!container) return;

    const tableCount = parseInt(state.config.tableCount, 10) || 7;
    const divisionFilter = state.filters.tablesDivision;

    let html = '';

    for (let t = 1; t <= tableCount; t++) {
      const matchId = state.tableAssignments[t];
      const match = matchId ? state.matches.find(m => m.id === matchId) : null;

      // Filter check
      if (match && divisionFilter !== 'all' && match.division !== divisionFilter) {
        continue;
      }

      if (!match) {
        // Table is ready / idle
        const waitingMatches = state.matches.filter(m => m.status === 'scheduled');
        let optionsHtml = waitingMatches
          .map(m => {
            const p1 = getPlayer(m.player1Id);
            const p2 = getPlayer(m.player2Id);
            return `<option value="${m.id}">Round ${m.round} [${m.division[0].toUpperCase()}]: ${p1.name} vs ${p2.name}</option>`;
          })
          .join('');

        html += `
          <div class="table-card">
            <div class="table-card-header">
              <div class="table-badge">
                <span class="table-indicator"></span>
                <span class="table-num">TABLE ${t}</span>
              </div>
              <span class="round-wave-pill">READY FOR CALL</span>
            </div>
            <div class="empty-table-state">
              <div class="empty-table-icon">🏓</div>
              <p style="font-weight: 600; color: var(--text-main);">Table Available</p>
              <p style="font-size: 0.8rem; margin-top: 4px;">Assign the next scheduled match or select a pair below</p>
            </div>
            <div class="table-card-footer">
              ${waitingMatches.length > 0 ? `
                <div style="display: flex; gap: 8px;">
                  <select class="form-select" id="select_table_${t}" style="font-size: 0.82rem; padding: 7px 10px;">
                    <option value="">-- Choose Match --</option>
                    ${optionsHtml}
                  </select>
                  <button class="btn btn-secondary btn-sm" onclick="callMatchToTable(${t}, document.getElementById('select_table_${t}').value)">Assign</button>
                </div>
                <button class="btn btn-primary" onclick="autoCallNextToTable(${t})">⚡ Call Next in Queue</button>
              ` : `
                <p style="text-align: center; font-size: 0.82rem; color: var(--text-dim);">No scheduled matches in queue.</p>
              `}
            </div>
          </div>
        `;
      } else {
        // Live match in progress
        const p1 = getPlayer(match.player1Id);
        const p2 = getPlayer(match.player2Id);
        const isMatchWon = match.winnerId !== null;
        const winner = isMatchWon ? getPlayer(match.winnerId) : null;
        const divClass = match.division === 'male' ? 'male' : 'female';
        const divLabel = match.division === 'male' ? 'MEN\'S 1V1' : 'WOMEN\'S 1V1';

        html += `
          <div class="table-card is-live ${isMatchWon ? 'is-match-won' : ''}">
            <div class="table-card-header">
              <div class="table-badge">
                <span class="table-indicator live"></span>
                <span class="table-num">TABLE ${t}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="gender-pill ${divClass}">${divLabel}</span>
                <span class="round-wave-pill">R${match.round}</span>
              </div>
            </div>

            <div class="matchup-container">
              <div class="players-vs-row">
                <div class="player-side p1">
                  <span class="player-side-name" title="${p1.name}">${p1.name}</span>
                  <span class="player-side-gender ${match.division}">${match.division === 'male' ? 'Male' : 'Female'}</span>
                </div>
                <div class="vs-divider">
                  <span class="vs-badge">VS</span>
                </div>
                <div class="player-side p2">
                  <span class="player-side-name" title="${p2.name}">${p2.name}</span>
                  <span class="player-side-gender ${match.division}">${match.division === 'male' ? 'Male' : 'Female'}</span>
                </div>
              </div>

              <!-- Big Games Won Scoreboard -->
              <div class="games-score-banner">
                <div class="game-score-box ${match.winnerId === match.player1Id ? 'winner' : ''}">${match.gamesWon.p1}</div>
                <div style="text-align: center;">
                  <div style="font-size: 1.1rem; font-weight: 800; color: var(--text-dim);">-</div>
                  <div class="match-format-info">First to 2</div>
                </div>
                <div class="game-score-box ${match.winnerId === match.player2Id ? 'winner' : ''}">${match.gamesWon.p2}</div>
              </div>
            </div>

            <!-- Quick Game Wins Increment Buttons -->
            <div class="quick-game-controls">
              <button class="quick-game-btn p1" onclick="incrementGame(${t}, 1)">
                <span>+1 Game</span> <strong>${p1.name.split(' ')[0]}</strong>
              </button>
              <button class="quick-game-btn p2" onclick="incrementGame(${t}, 2)">
                <span>+1 Game</span> <strong>${p2.name.split(' ')[0]}</strong>
              </button>
            </div>

            <!-- Detailed Points Input per Game (Best of 3) -->
            <div style="margin-bottom: 8px;">
              <div style="font-size: 0.72rem; text-transform: uppercase; color: var(--text-dim); font-weight: 700; margin-bottom: 5px; display: flex; justify-content: space-between;">
                <span>Detailed Game Points</span>
                <span style="font-weight: 500; font-size: 0.7rem;">(Optional 11-pt tracking)</span>
              </div>
              <div class="games-breakdown">
                ${[0, 1, 2].map(idx => `
                  <div class="game-slot">
                    <div class="game-slot-header">G${idx + 1}</div>
                    <div class="game-inputs-wrap">
                      <input type="number" min="0" max="99" class="pt-input" 
                        value="${match.games[idx]?.p1 || 0}" 
                        onchange="updateGamePoints(${t}, ${idx}, this.value, match_input_${t}_g${idx}_p2.value)"
                        id="match_input_${t}_g${idx}_p1">
                      <span style="color: var(--text-dim); font-size: 0.75rem;">:</span>
                      <input type="number" min="0" max="99" class="pt-input" 
                        value="${match.games[idx]?.p2 || 0}" 
                        onchange="updateGamePoints(${t}, ${idx}, match_input_${t}_g${idx}_p1.value, this.value)"
                        id="match_input_${t}_g${idx}_p2">
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- Winner announcement banner if reached 2 games -->
            ${isMatchWon ? `
              <div class="winner-callout">
                🏆 ${winner.name} wins ${match.gamesWon.p1}-${match.gamesWon.p2}!
              </div>
            ` : ''}

            <div class="table-card-footer">
              ${isMatchWon ? `
                <button class="btn btn-primary" onclick="completeMatch(${t})">
                  ✔️ Submit & Complete Match
                </button>
              ` : `
                <button class="btn btn-secondary" style="opacity: 0.6; cursor: not-allowed;" title="Requires 2 game wins to complete">
                  ⏳ Playing (First to 2 wins)
                </button>
              `}
              <div style="display: flex; gap: 8px; justify-content: space-between;">
                <button class="btn btn-secondary btn-sm" onclick="releaseTable(${t})" title="Release match back to queue without completing">
                  ↩️ Return to Queue
                </button>
                <div style="display: flex; gap: 4px;">
                  <button class="btn btn-secondary btn-sm" onclick="decrementGame(${t}, 1)" title="Undo 1 game from ${p1.name}">-1 P1</button>
                  <button class="btn btn-secondary btn-sm" onclick="decrementGame(${t}, 2)" title="Undo 1 game from ${p2.name}">-1 P2</button>
                </div>
              </div>
            </div>
          </div>
        `;
      }
    }

    container.innerHTML = html;
  }

  window.autoCallNextToTable = function (tableNum) {
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

    const nextMatch = state.matches.find(m => {
      if (m.status !== 'scheduled') return false;
      if (activePlayerIds.has(m.player1Id) || activePlayerIds.has(m.player2Id)) return false;
      return true;
    });

    if (nextMatch) {
      nextMatch.status = 'live';
      nextMatch.table = tableNum;
      state.tableAssignments[tableNum] = nextMatch.id;
      saveState();
      renderAll();
      showToast(`Called Round ${nextMatch.round} match to Table ${tableNum}`, 'success');
    } else {
      showToast('No eligible scheduled matches available (players may be currently active).', 'warning');
    }
  };

  /**
   * Render Top 7 Standings for Male & Female
   */
  function renderStandings() {
    renderDivisionStandings('male', 'standingsMaleContainer', state.ui.showAllMales);
    renderDivisionStandings('female', 'standingsFemaleContainer', state.ui.showAllFemales);
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
      let medal = rank;

      if (rank === 1) {
        rankBadgeClass = 'rank-1';
        medal = '🥇';
      } else if (rank === 2) {
        rankBadgeClass = 'rank-2';
        medal = '🥈';
      } else if (rank === 3) {
        rankBadgeClass = 'rank-3';
        medal = '🥉';
      } else if (rank <= 7) {
        rankBadgeClass = 'rank-top7';
      }

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
            <span class="rank-badge ${rankBadgeClass}">${medal}</span>
          </td>
          <td class="td-left">
            <div class="player-name-cell">
              <span class="player-initials">${initials}</span>
              <span>${item.player.name}</span>
              ${isTop7 ? '<span style="font-size: 0.65rem; color: var(--accent-green); font-weight: 700; background: rgba(16, 185, 129, 0.15); padding: 1px 5px; border-radius: 4px;">TOP 7</span>' : ''}
            </div>
          </td>
          <td>${item.played}</td>
          <td style="color: var(--accent-green); font-weight: 800;">${item.won}</td>
          <td style="color: #ef4444;">${item.lost}</td>
          <td>${item.winPct}%</td>
          <td style="font-weight: 700; color: ${item.gameDiff > 0 ? 'var(--accent-green)' : item.gameDiff < 0 ? '#ef4444' : 'var(--text-dim)'}">
            ${item.gameDiff > 0 ? '+' : ''}${item.gameDiff}
          </td>
          <td style="color: ${item.pointDiff > 0 ? 'var(--accent-green)' : item.pointDiff < 0 ? '#ef4444' : 'var(--text-dim)'}">
            ${item.pointDiff > 0 ? '+' : ''}${item.pointDiff}
          </td>
          <td>
            <div class="form-dots">${formDots || '<span style="color: var(--text-dim);">-</span>'}</div>
          </td>
        </tr>
      `;
    });

    if (displayList.length === 0) {
      rowsHtml = `<tr><td colspan="9" style="text-align: center; padding: 24px; color: var(--text-dim);">No players registered in this division.</td></tr>`;
    }

    const toggleBtnText = showAll ? 'Show Top 7 Only' : `View All (${totalCount}) Players`;
    const toggleVisible = totalCount > 7;

    container.innerHTML = `
      <div class="standings-table-wrap">
        <table class="standings-table">
          <thead>
            <tr>
              <th style="width: 50px;">Rank</th>
              <th class="th-left">Player</th>
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
        <div style="margin-top: 14px; display: flex; justify-content: flex-end;">
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

  /**
   * Render Fixtures & Rounds
   */
  function renderFixtures() {
    const container = document.getElementById('fixturesContainer');
    if (!container) return;

    const roundFilter = state.filters.fixturesRound;
    const divisionFilter = state.filters.fixturesDivision;

    // Group matches by round
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
          <div style="font-size: 2rem; margin-bottom: 8px;">📋</div>
          <p>No fixtures found matching current filters.</p>
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
              <span class="badge-tag">${matchesInRound.length} Matches</span>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); font-family: var(--font-mono);">
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
                    <span style="font-size: 0.75rem; color: var(--text-dim);">vs</span>
                    <div class="fixture-player ${m.winnerId === m.player2Id ? 'winner' : ''}">
                      <span>${p2.name}</span>
                    </div>
                  </div>

                  <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--border-subtle);">
                    <div style="font-size: 0.75rem; font-weight: 600;">
                      ${isCompleted ? `
                        <span style="color: var(--accent-green);">Finished</span>
                      ` : isLive ? `
                        <span style="color: #ef4444;">Live on Table ${m.table}</span>
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

  /**
   * Render Match Logs
   */
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
          <div style="font-size: 2rem; margin-bottom: 8px;">📜</div>
          <p>No match activity logs recorded yet.</p>
          <p style="font-size: 0.8rem; margin-top: 4px;">Completed matches will appear here automatically with full score breakdowns.</p>
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

  /**
   * Render Setup View (Roster & Config)
   */
  function renderSetupView() {
    const tableInput = document.getElementById('configTableCount');
    if (tableInput && document.activeElement !== tableInput) {
      tableInput.value = state.config.tableCount;
    }

    const rosterBody = document.getElementById('rosterTableBody');
    if (!rosterBody) return;

    let html = '';
    state.players.forEach((p, idx) => {
      html += `
        <tr>
          <td style="font-family: var(--font-mono); color: var(--text-dim);">${idx + 1}</td>
          <td style="font-weight: 600;">${p.name}</td>
          <td>
            <span class="gender-pill ${p.gender}">
              ${p.gender === 'male' ? '♂ Male' : '♀ Female'}
            </span>
          </td>
          <td style="text-align: right;">
            <button class="btn btn-secondary btn-sm" onclick="togglePlayerGender('${p.id}')" title="Toggle Gender">
              Swap ⚤
            </button>
            <button class="btn btn-danger btn-sm" onclick="removePlayer('${p.id}')" title="Remove Player">
              ✕
            </button>
          </td>
        </tr>
      `;
    });

    if (state.players.length === 0) {
      html = `<tr><td colspan="4" style="text-align: center; padding: 20px; color: var(--text-dim);">No players added. Click "Load 15 Demo Players" or add players above.</td></tr>`;
    }

    rosterBody.innerHTML = html;

    // Update roster preview calculation
    const maleCount = state.players.filter(p => p.gender === 'male').length;
    const femaleCount = state.players.filter(p => p.gender === 'female').length;
    const maleMatches = (maleCount * (maleCount - 1)) / 2;
    const femaleMatches = (femaleCount * (femaleCount - 1)) / 2;
    const totalEstMatches = maleMatches + femaleMatches;

    const calcEl = document.getElementById('rosterCalculationSummary');
    if (calcEl) {
      calcEl.innerHTML = `
        <strong>${state.players.length} Players</strong> (${maleCount} Men, ${femaleCount} Women)<br>
        • Men's 1v1 Matches: <strong>${maleMatches}</strong><br>
        • Women's 1v1 Matches: <strong>${femaleMatches}</strong><br>
        • Total Matches: <strong>${totalEstMatches}</strong> scheduled across <strong>${state.config.tableCount} tables</strong>
      `;
    }
  }

  // --- Setup Actions ---
  window.addPlayer = function () {
    const nameInput = document.getElementById('newPlayerName');
    const gender = document.querySelector('input[name="newPlayerGender"]:checked')?.value || 'male';

    if (!nameInput || !nameInput.value.trim()) {
      showToast('Please enter a player name.', 'warning');
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
    showToast(`Added ${newPlayer.name} (${newPlayer.gender})`, 'success');
  };

  window.removePlayer = function (id) {
    state.players = state.players.filter(p => p.id !== id);
    saveState();
    renderSetupView();
    renderHeaderStats();
    showToast('Player removed', 'info');
  };

  window.togglePlayerGender = function (id) {
    const player = state.players.find(p => p.id === id);
    if (player) {
      player.gender = player.gender === 'male' ? 'female' : 'male';
      saveState();
      renderSetupView();
      renderHeaderStats();
    }
  };

  window.loadDefaultPlayers = function () {
    state.players = [...DEFAULT_PLAYERS];
    saveState();
    renderSetupView();
    renderHeaderStats();
    showToast('Loaded 15 Demo Players (10 Men, 5 Women)', 'success');
  };

  window.clearAllPlayers = function () {
    if (confirm('Clear entire player roster?')) {
      state.players = [];
      saveState();
      renderSetupView();
      renderHeaderStats();
    }
  };

  window.updateTableCount = function (val) {
    const num = Math.max(1, Math.min(32, parseInt(val, 10) || 7));
    state.config.tableCount = num;

    // Ensure state.tableAssignments has keys for 1..num
    for (let t = 1; t <= num; t++) {
      if (state.tableAssignments[t] === undefined) {
        state.tableAssignments[t] = null;
      }
    }

    saveState();
    renderAll();
  };

  // --- Reset Tournament Modal ---
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
    saveState();
    closeResetModal();
    renderAll();
    showToast('Tournament data reset. Ready for a new schedule.', 'info');
  };

  // --- Export to CSV & Print ---
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

  // --- Tab Navigation ---
  window.switchTab = function (tabName) {
    state.currentTab = tabName;

    // Update tab button styles
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Toggle content views
    const views = ['tables', 'standings', 'fixtures', 'logs', 'setup'];
    views.forEach(v => {
      const el = document.getElementById(`view_${v}`);
      if (el) {
        el.style.display = v === tabName ? 'block' : 'none';
      }
    });

    // Populate round filter dropdown when switching to fixtures
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

  // --- Master Render ---
  function renderAll() {
    renderHeaderStats();
    if (state.currentTab === 'tables') renderLiveTables();
    if (state.currentTab === 'standings') renderStandings();
    if (state.currentTab === 'fixtures') renderFixtures();
    if (state.currentTab === 'logs') renderLogs();
    if (state.currentTab === 'setup') renderSetupView();
  }

  // --- Sound Toggle ---
  window.toggleSound = function () {
    SoundFX.muted = !SoundFX.muted;
    const btn = document.getElementById('soundToggleBtn');
    if (btn) {
      btn.innerHTML = SoundFX.muted ? '🔇 Sound Off' : '🔊 Sound On';
    }
  };

  // --- Init ---
  document.addEventListener('DOMContentLoaded', () => {
    const hadSaved = loadState();

    // If no matches yet, generate default tournament so user immediately sees live tables
    if (!hadSaved || !state.matches || state.matches.length === 0) {
      generateTournament();
    }

    // Set initial tab
    switchTab(state.currentTab || 'tables');

    // Attach Event Listeners
    const tableInput = document.getElementById('configTableCount');
    if (tableInput) {
      tableInput.addEventListener('change', e => updateTableCount(e.target.value));
    }

    const playerInput = document.getElementById('newPlayerName');
    if (playerInput) {
      playerInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') addPlayer();
      });
    }

    // Table Division Filter chips
    document.querySelectorAll('.tables-div-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.tables-div-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.filters.tablesDivision = chip.dataset.div;
        renderLiveTables();
      });
    });

    // Fixtures Filters
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

    // Logs Filters
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

  // Expose global generator for button
  window.generateTournament = generateTournament;

})();
