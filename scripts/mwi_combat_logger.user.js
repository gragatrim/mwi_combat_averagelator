// ==UserScript==
// @name         MWI Combat Logger
// @namespace    https://github.com/gragatrim/mwi_combat_averagelator
// @version      1.2
// @description  Captures per-attack combat data from MWI for comparison with deterministic sim
// @author       gragatrim
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // ===========================================================================
  // State
  // ===========================================================================

  const state = {
    fights: [],
    currentFight: null,
    messageTypeCounts: {},
    totalFights: 0,
    // Snapshot from new_battle
    battlePlayers: null,
    battleMonsters: null,
    // Previous tick state for delta tracking
    prevPlayerState: {}, // index -> { cHP, cMP, dmgCounter, critCounter }
    prevMonsterState: {}, // index -> { cHP, cMP, dmgCounter, critCounter }
  };

  // ===========================================================================
  // WebSocket Hook (MessageEvent.prototype.data override)
  // ===========================================================================

  const dataDescriptor = Object.getOwnPropertyDescriptor(
    MessageEvent.prototype,
    "data"
  );
  const originalGet = dataDescriptor.get;

  dataDescriptor.get = function hookedGet() {
    const socket = this.currentTarget;

    if (!(socket instanceof WebSocket)) {
      return originalGet.call(this);
    }

    if (
      socket.url.indexOf("api.milkywayidle.com/ws") === -1 &&
      socket.url.indexOf("api-test.milkywayidle.com/ws") === -1
    ) {
      return originalGet.call(this);
    }

    const message = originalGet.call(this);

    // Anti-loop: define data property so chained hooks don't re-enter
    Object.defineProperty(this, "data", { value: message });

    try {
      processMessage(message);
    } catch (e) {
      console.error("[CombatLogger] Error processing message:", e);
    }

    return message;
  };

  Object.defineProperty(MessageEvent.prototype, "data", dataDescriptor);

  // ===========================================================================
  // Message Processing
  // ===========================================================================

  function processMessage(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const type = data.type;
    if (!type) return;

    // Count all message types
    state.messageTypeCounts[type] = (state.messageTypeCounts[type] || 0) + 1;

    switch (type) {
      case "new_battle":
        handleNewBattle(data);
        break;
      case "battle_updated":
        handleBattleUpdated(data);
        break;
      case "battle_ended":
        handleBattleEnded(data);
        break;
      case "labyrinth_updated":
        handleLabyrinthUpdated(data);
        break;
    }
  }

  // ===========================================================================
  // new_battle — snapshot initial state
  // ===========================================================================

  function handleNewBattle(data) {
    // Finalize any in-progress fight (shouldn't happen normally)
    if (state.currentFight) {
      finalizeFight("timeout");
    }

    state.battlePlayers = data.players || [];
    state.battleMonsters = data.monsters || [];

    // Detect combat mode
    const numPlayers = state.battlePlayers.length;
    const numMonsters = state.battleMonsters.length;
    let combatMode = "zone";
    if (numPlayers === 1 && numMonsters === 1) {
      // Could be labyrinth — check if monster has labyrinth-like characteristics
      // Labyrinth fights are 1v1 with no respawns
      combatMode = "labyrinth_or_zone";
    }
    if (numPlayers > 1 && data.isDungeon) {
      combatMode = "dungeon";
    }

    // Build player stats snapshot
    const playerSnapshots = state.battlePlayers.map((p) => ({
      name: p.name,
      combatDetails: p.combatDetails || null,
      combatBuffMap: p.combatBuffMap || null,
      abilities: p.abilities || [],
      food: p.food || [],
      drinks: p.drinks || [],
    }));

    // Build monster stats snapshot
    const monsterSnapshots = state.battleMonsters.map((m) => ({
      name: m.name,
      hrid: m.hrid || null,
      combatDetails: m.combatDetails || null,
      abilities: m.abilities || [],
    }));

    // Initialize previous state tracking
    state.prevPlayerState = {};
    state.prevMonsterState = {};

    state.currentFight = {
      combatMode,
      startTime: new Date().toISOString(),
      endTime: null,
      durationSec: 0,
      outcome: null,

      playerStats: playerSnapshots,
      monsterStats: monsterSnapshots,

      events: [],
      eventIndex: 0,

      // Per-player aggregates
      playerAggregates: state.battlePlayers.map(() => ({
        totalDamageDealt: 0,
        totalDamageTaken: 0,
        totalHealingReceived: 0,
        hits: 0,
        misses: 0,
        crits: 0,
        deaths: 0,
        abilityDamage: {},
      })),

      // Per-monster aggregates
      monsterAggregates: state.battleMonsters.map(() => ({
        totalDamageDealt: 0,
        totalDamageTaken: 0,
        hits: 0,
        misses: 0,
        crits: 0,
        deaths: 0,
      })),
    };

    state.totalFights++;
    updateUI();
  }

  // ===========================================================================
  // battle_updated — delta tracking
  // ===========================================================================

  function handleBattleUpdated(data) {
    if (!state.currentFight) return;

    const pMap = data.pMap;
    const mMap = data.mMap;
    if (!pMap || !mMap) return;

    const fight = state.currentFight;
    const timestamp = Date.now();

    // Detect unit counts for simplified attribution (Fix 1)
    const playerCount = Object.keys(pMap).length;
    const monsterCount = Object.keys(mMap).length;
    const isSinglePlayer = playerCount === 1;
    const isSingleMonster = monsterCount === 1;

    // Fix 2: Save ALL prev states BEFORE processing either side,
    // so player processing can use the original monster prev state
    const savedPrevMonster = {};
    for (const mIdx of Object.keys(mMap)) {
      savedPrevMonster[mIdx] = state.prevMonsterState[mIdx]
        ? { ...state.prevMonsterState[mIdx] }
        : null;
    }
    const savedPrevPlayer = {};
    for (const pIdx of Object.keys(pMap)) {
      savedPrevPlayer[pIdx] = state.prevPlayerState[pIdx]
        ? { ...state.prevPlayerState[pIdx] }
        : null;
    }

    // --- Process monster changes (detect monster taking damage = player attack) ---
    for (const mIdx of Object.keys(mMap)) {
      const monster = mMap[mIdx];
      if (!monster) continue;

      const prev = savedPrevMonster[mIdx];
      const currentDmg = monster.dmgCounter ?? 0;
      const currentCrit = monster.critCounter ?? 0;
      const currentHP = monster.cHP ?? 0;
      const currentMP = monster.cMP ?? 0;

      if (prev) {
        const hpDiff = prev.cHP - currentHP;
        const dmgCounterDelta = currentDmg - (prev.dmgCounter || 0);
        const critCounterDelta = currentCrit - (prev.critCounter || 0);

        if (dmgCounterDelta > 0 && hpDiff > 0) {
          // Monster took a hit — this is a player attack landing on monster
          let attackerIdx = -1;
          let abilityHrid = null;
          let isCrit = critCounterDelta > 0;

          if (isSinglePlayer) {
            // Fix 1: Trivial attribution for 1v1/1vN
            attackerIdx = parseInt(Object.keys(pMap)[0]);
            const player = pMap[Object.keys(pMap)[0]];
            if (player) {
              const prevP = savedPrevPlayer[Object.keys(pMap)[0]];
              if (prevP && player.cMP < prevP.cMP && player.preparingAbilityHrid) {
                abilityHrid = player.preparingAbilityHrid;
              }
            }
          } else {
            // Multi-player: try MP decrease check
            for (const pIdx of Object.keys(pMap)) {
              const player = pMap[pIdx];
              if (!player) continue;
              const prevP = savedPrevPlayer[pIdx];
              if (!prevP) continue;

              if (player.cMP < prevP.cMP) {
                attackerIdx = parseInt(pIdx);
                if (player.preparingAbilityHrid) {
                  abilityHrid = player.preparingAbilityHrid;
                }
                break;
              }
            }

            // Fall back to first player (not -1) for multi-player
            if (attackerIdx === -1) {
              attackerIdx = parseInt(Object.keys(pMap)[0]);
            }
          }

          const evt = {
            timestamp,
            type: abilityHrid ? "playerAbility" : "playerAttack",
            sourceIndex: attackerIdx,
            targetIndex: parseInt(mIdx),
            damage: hpDiff,
            isCrit,
            isMiss: false,
            abilityHrid: abilityHrid || null,
            monsterHpAfter: currentHP,
            monsterMpAfter: currentMP,
          };

          fight.events.push(evt);

          // Fix 3: Always update aggregates (attackerIdx is now always >= 0)
          if (attackerIdx >= 0 && fight.playerAggregates[attackerIdx]) {
            const agg = fight.playerAggregates[attackerIdx];
            agg.totalDamageDealt += hpDiff;
            agg.hits++;
            if (isCrit) agg.crits++;
            if (abilityHrid) {
              if (!agg.abilityDamage[abilityHrid]) {
                agg.abilityDamage[abilityHrid] = {
                  casts: 0,
                  totalDamage: 0,
                  hits: 0,
                  crits: 0,
                  misses: 0,
                };
              }
              const ad = agg.abilityDamage[abilityHrid];
              ad.casts++;
              ad.totalDamage += hpDiff;
              ad.hits++;
              if (isCrit) ad.crits++;
            }
          }

          if (fight.monsterAggregates[parseInt(mIdx)]) {
            fight.monsterAggregates[parseInt(mIdx)].totalDamageTaken += hpDiff;
          }

          // Monster died
          if (currentHP <= 0 && prev.cHP > 0) {
            if (fight.monsterAggregates[parseInt(mIdx)]) {
              fight.monsterAggregates[parseInt(mIdx)].deaths++;
            }
          }
        } else if (dmgCounterDelta > 0 && hpDiff === 0) {
          // Miss on monster
          let attackerIdx = isSinglePlayer
            ? parseInt(Object.keys(pMap)[0])
            : -1;

          if (attackerIdx === -1) {
            // Multi-player fallback: first player
            attackerIdx = parseInt(Object.keys(pMap)[0]);
          }

          fight.events.push({
            timestamp,
            type: "playerMiss",
            sourceIndex: attackerIdx,
            targetIndex: parseInt(mIdx),
            damage: 0,
            isCrit: false,
            isMiss: true,
            abilityHrid: null,
            monsterHpAfter: currentHP,
            monsterMpAfter: currentMP,
          });

          if (attackerIdx >= 0 && fight.playerAggregates[attackerIdx]) {
            fight.playerAggregates[attackerIdx].misses++;
          }
        }
      }

      // Update previous state
      state.prevMonsterState[mIdx] = {
        cHP: currentHP,
        cMP: currentMP,
        dmgCounter: currentDmg,
        critCounter: currentCrit,
      };
    }

    // --- Process player changes (detect player taking damage = monster attack) ---
    for (const pIdx of Object.keys(pMap)) {
      const player = pMap[pIdx];
      if (!player) continue;

      const prev = savedPrevPlayer[pIdx];
      const currentHP = player.cHP ?? 0;
      const currentMP = player.cMP ?? 0;
      const currentDmg = player.dmgCounter ?? 0;
      const currentCrit = player.critCounter ?? 0;

      if (prev) {
        const hpDiff = prev.cHP - currentHP;
        const dmgCounterDelta = currentDmg - (prev.dmgCounter || 0);
        const critCounterDelta = currentCrit - (prev.critCounter || 0);

        if (dmgCounterDelta > 0 && hpDiff > 0) {
          // Player took a hit — monster attacked
          let attackerMIdx = -1;
          let abilityHrid = null;
          let isCrit = critCounterDelta > 0;

          if (isSingleMonster) {
            // Fix 1: Trivial attribution for 1v1/Nv1
            attackerMIdx = parseInt(Object.keys(mMap)[0]);
            const monster = mMap[Object.keys(mMap)[0]];
            if (monster) {
              const prevM = savedPrevMonster[Object.keys(mMap)[0]];
              if (prevM && monster.cMP < prevM.cMP && monster.preparingAbilityHrid) {
                abilityHrid = monster.preparingAbilityHrid;
              }
            }
          } else {
            // Multi-monster: use SAVED prev state (Fix 2)
            for (const mIdx of Object.keys(mMap)) {
              const monster = mMap[mIdx];
              if (!monster) continue;
              const prevM = savedPrevMonster[mIdx];
              if (!prevM) continue;

              if (monster.cMP < prevM.cMP) {
                attackerMIdx = parseInt(mIdx);
                if (monster.preparingAbilityHrid) {
                  abilityHrid = monster.preparingAbilityHrid;
                }
                break;
              }
            }

            // If no MP change, check monster dmgCounter using SAVED prev state
            if (attackerMIdx === -1) {
              for (const mIdx of Object.keys(mMap)) {
                const monster = mMap[mIdx];
                if (!monster) continue;
                const prevM = savedPrevMonster[mIdx];
                if (!prevM) continue;
                const delta =
                  (monster.dmgCounter ?? 0) - (prevM.dmgCounter || 0);
                if (delta > 0) {
                  attackerMIdx = parseInt(mIdx);
                  if (monster.preparingAbilityHrid) {
                    abilityHrid = monster.preparingAbilityHrid;
                  }
                  break;
                }
              }
            }

            // Fall back to first monster (not -1)
            if (attackerMIdx === -1) {
              attackerMIdx = parseInt(Object.keys(mMap)[0]);
            }
          }

          const evt = {
            timestamp,
            type: abilityHrid ? "monsterAbility" : "monsterAttack",
            sourceIndex: attackerMIdx,
            targetIndex: parseInt(pIdx),
            damage: hpDiff,
            isCrit,
            isMiss: false,
            abilityHrid: abilityHrid || null,
            playerHpAfter: currentHP,
            playerMpAfter: currentMP,
          };

          fight.events.push(evt);

          // Update aggregates
          if (fight.playerAggregates[parseInt(pIdx)]) {
            fight.playerAggregates[parseInt(pIdx)].totalDamageTaken += hpDiff;
          }

          // Fix 3: attackerMIdx is now always >= 0
          if (attackerMIdx >= 0 && fight.monsterAggregates[attackerMIdx]) {
            const magg = fight.monsterAggregates[attackerMIdx];
            magg.totalDamageDealt += hpDiff;
            magg.hits++;
            if (isCrit) magg.crits++;
          }

          // Player died
          if (currentHP <= 0 && prev.cHP > 0) {
            if (fight.playerAggregates[parseInt(pIdx)]) {
              fight.playerAggregates[parseInt(pIdx)].deaths++;
            }
          }
        } else if (dmgCounterDelta > 0 && hpDiff === 0) {
          // Miss on player
          let attackerMIdx = isSingleMonster
            ? parseInt(Object.keys(mMap)[0])
            : -1;

          if (attackerMIdx === -1) {
            // Multi-monster: use SAVED prev state
            for (const mIdx of Object.keys(mMap)) {
              const monster = mMap[mIdx];
              if (!monster) continue;
              const prevM = savedPrevMonster[mIdx];
              if (!prevM) continue;
              const delta = (monster.dmgCounter ?? 0) - (prevM.dmgCounter || 0);
              if (delta > 0) {
                attackerMIdx = parseInt(mIdx);
                break;
              }
            }

            // Fall back to first monster
            if (attackerMIdx === -1) {
              attackerMIdx = parseInt(Object.keys(mMap)[0]);
            }
          }

          fight.events.push({
            timestamp,
            type: "monsterMiss",
            sourceIndex: attackerMIdx,
            targetIndex: parseInt(pIdx),
            damage: 0,
            isCrit: false,
            isMiss: true,
            abilityHrid: null,
            playerHpAfter: currentHP,
            playerMpAfter: currentMP,
          });

          if (attackerMIdx >= 0 && fight.monsterAggregates[attackerMIdx]) {
            fight.monsterAggregates[attackerMIdx].misses++;
          }
        }

        // Healing detection: HP increased without dmgCounter change
        if (hpDiff < 0 && dmgCounterDelta === 0) {
          const healAmount = Math.abs(hpDiff);
          fight.events.push({
            timestamp,
            type: "regen",
            sourceIndex: parseInt(pIdx),
            targetIndex: parseInt(pIdx),
            damage: -healAmount,
            isCrit: false,
            isMiss: false,
            abilityHrid: null,
            playerHpAfter: currentHP,
            playerMpAfter: currentMP,
          });

          if (fight.playerAggregates[parseInt(pIdx)]) {
            fight.playerAggregates[parseInt(pIdx)].totalHealingReceived +=
              healAmount;
          }
        }
      }

      // Update previous state
      state.prevPlayerState[pIdx] = {
        cHP: currentHP,
        cMP: currentMP,
        dmgCounter: currentDmg,
        critCounter: currentCrit,
      };
    }

    // Detect fight ending — all monsters dead (labyrinth fights don't send battle_ended)
    const allMonstersDead = Object.keys(state.prevMonsterState).length > 0 &&
      Object.values(state.prevMonsterState).every((m) => m.cHP <= 0);
    if (allMonstersDead) {
      finalizeFight("kill");
      return;
    }

    // Throttled UI update
    if (fight.events.length % 5 === 0) {
      updateUI();
    }
  }

  // ===========================================================================
  // battle_ended — finalize fight
  // ===========================================================================

  function handleBattleEnded(data) {
    if (!state.currentFight) return;

    // Determine outcome
    const allMonstersDead = state.currentFight.monsterAggregates.every(
      (m) => m.deaths > 0
    );
    const anyPlayerDead = state.currentFight.playerAggregates.some(
      (p) => p.deaths > 0
    );

    let outcome = "timeout";
    if (allMonstersDead) outcome = "kill";
    else if (anyPlayerDead) outcome = "death";

    finalizeFight(outcome);
  }

  // ===========================================================================
  // labyrinth_updated — finalize labyrinth fight (no battle_ended sent)
  // ===========================================================================

  function handleLabyrinthUpdated(data) {
    if (!state.currentFight) return;
    // Mark as labyrinth now that we've confirmed it
    state.currentFight.combatMode = "labyrinth";
    const allMonstersDead = state.currentFight.monsterAggregates.some(
      (m) => m.deaths > 0
    );
    finalizeFight(allMonstersDead ? "kill" : "timeout");
  }

  function finalizeFight(outcome) {
    const fight = state.currentFight;
    if (!fight) return;

    fight.endTime = new Date().toISOString();
    fight.outcome = outcome;

    const startMs = new Date(fight.startTime).getTime();
    const endMs = new Date(fight.endTime).getTime();
    fight.durationSec = (endMs - startMs) / 1000;

    // Build per-player summaries
    fight.summaries = fight.playerAggregates.map((agg, i) => {
      const totalAttacks = agg.hits + agg.misses;
      return {
        playerIndex: i,
        playerName: fight.playerStats[i]?.name || `Player ${i}`,
        totalDamageDealt: agg.totalDamageDealt,
        totalDamageTaken: agg.totalDamageTaken,
        totalHealingReceived: agg.totalHealingReceived,
        hits: agg.hits,
        misses: agg.misses,
        crits: agg.crits,
        deaths: agg.deaths,
        hitRate: totalAttacks > 0 ? agg.hits / totalAttacks : 0,
        critRate: agg.hits > 0 ? agg.crits / agg.hits : 0,
        effectiveDps:
          fight.durationSec > 0
            ? agg.totalDamageDealt / fight.durationSec
            : 0,
        damageTakenPerSec:
          fight.durationSec > 0
            ? agg.totalDamageTaken / fight.durationSec
            : 0,
        abilityDamage: agg.abilityDamage,
      };
    });

    // Build per-monster summaries
    fight.monsterSummaries = fight.monsterAggregates.map((agg, i) => {
      const totalAttacks = agg.hits + agg.misses;
      return {
        monsterIndex: i,
        monsterName: fight.monsterStats[i]?.name || `Monster ${i}`,
        monsterHrid: fight.monsterStats[i]?.hrid || null,
        totalDamageDealt: agg.totalDamageDealt,
        totalDamageTaken: agg.totalDamageTaken,
        hits: agg.hits,
        misses: agg.misses,
        crits: agg.crits,
        deaths: agg.deaths,
        hitRate: totalAttacks > 0 ? agg.hits / totalAttacks : 0,
        effectiveDps:
          fight.durationSec > 0
            ? agg.totalDamageDealt / fight.durationSec
            : 0,
      };
    });

    // Remove internal tracking fields before storing
    const stored = { ...fight };
    delete stored.playerAggregates;
    delete stored.monsterAggregates;
    delete stored.eventIndex;

    state.fights.push(stored);
    state.currentFight = null;

    updateUI();
  }

  // ===========================================================================
  // Export
  // ===========================================================================

  function exportJSON() {
    const exportData = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      fights: state.fights,
      messageTypeCounts: state.messageTypeCounts,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `combat_log_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Keyboard shortcut: Ctrl+Shift+L
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "L") {
      e.preventDefault();
      exportJSON();
    }
  });

  // ===========================================================================
  // UI — Floating Panel
  // ===========================================================================

  function createUI() {
    const panel = document.createElement("div");
    panel.id = "mwi-combat-logger-panel";
    panel.innerHTML = `
      <div id="mcl-header" style="cursor:move;display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-weight:bold;font-size:11px;">Combat Logger</span>
        <div>
          <button id="mcl-export" style="background:#4a5;color:#fff;border:none;border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;margin-right:4px;">Export</button>
          <button id="mcl-minimize" style="background:none;color:#ccc;border:none;cursor:pointer;font-size:14px;line-height:1;">−</button>
        </div>
      </div>
      <div id="mcl-body">
        <div id="mcl-status" style="font-size:10px;color:#8f8;">Logging...</div>
        <div id="mcl-fights" style="font-size:10px;color:#aaa;margin-top:2px;">Fights: 0</div>
        <div id="mcl-last" style="font-size:9px;color:#888;margin-top:2px;max-height:80px;overflow:hidden;"></div>
      </div>
    `;

    const s = panel.style;
    s.position = "fixed";
    s.bottom = "10px";
    s.right = "10px";
    s.width = "200px";
    s.background = "rgba(20,20,30,0.92)";
    s.border = "1px solid rgba(255,255,255,0.15)";
    s.borderRadius = "6px";
    s.padding = "6px 8px";
    s.zIndex = "99999";
    s.fontFamily = "monospace";
    s.color = "#ddd";
    s.boxShadow = "0 2px 12px rgba(0,0,0,0.5)";

    document.body.appendChild(panel);

    // Export button
    document.getElementById("mcl-export").addEventListener("click", exportJSON);

    // Minimize toggle
    let minimized = false;
    const body = document.getElementById("mcl-body");
    const minBtn = document.getElementById("mcl-minimize");
    minBtn.addEventListener("click", () => {
      minimized = !minimized;
      body.style.display = minimized ? "none" : "block";
      minBtn.textContent = minimized ? "+" : "−";
    });

    // Drag support
    const header = document.getElementById("mcl-header");
    let dragging = false;
    let dragX, dragY;
    header.addEventListener("mousedown", (e) => {
      dragging = true;
      dragX = e.clientX - panel.getBoundingClientRect().left;
      dragY = e.clientY - panel.getBoundingClientRect().top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      panel.style.left = e.clientX - dragX + "px";
      panel.style.top = e.clientY - dragY + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    });
    document.addEventListener("mouseup", () => {
      dragging = false;
    });
  }

  function updateUI() {
    const statusEl = document.getElementById("mcl-status");
    const fightsEl = document.getElementById("mcl-fights");
    const lastEl = document.getElementById("mcl-last");
    if (!statusEl) return;

    const inCombat = state.currentFight !== null;
    const eventCount = state.currentFight
      ? state.currentFight.events.length
      : 0;

    statusEl.textContent = inCombat
      ? `In combat (${eventCount} events)`
      : "Logging...";
    statusEl.style.color = inCombat ? "#ff8" : "#8f8";

    fightsEl.textContent = `Fights: ${state.fights.length} captured`;

    // Last fight summary
    if (state.fights.length > 0) {
      const last = state.fights[state.fights.length - 1];
      const monsters = last.monsterStats
        .map((m) => (m.hrid || m.name || "?").split("/").pop())
        .join(", ");
      const outcome = last.outcome || "?";
      const dur = (last.durationSec || 0).toFixed(1);

      let summary = `Last: ${monsters} (${outcome}, ${dur}s)`;

      if (last.summaries && last.summaries[0]) {
        const s = last.summaries[0];
        summary += `\nDPS: ${s.effectiveDps.toFixed(0)} | Hit: ${(s.hitRate * 100).toFixed(0)}%`;
        summary += `\nDmgTaken/s: ${s.damageTakenPerSec.toFixed(0)} | Heal: ${s.totalHealingReceived}`;
      }

      lastEl.textContent = summary;
      lastEl.style.whiteSpace = "pre-wrap";
    }
  }

  // ===========================================================================
  // Init — wait for DOM
  // ===========================================================================

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createUI);
  } else {
    createUI();
  }

  // Expose for console access
  window.__combatLogger = {
    getState: () => state,
    export: exportJSON,
    clear: () => {
      state.fights = [];
      state.messageTypeCounts = {};
      state.totalFights = 0;
      updateUI();
    },
  };

  console.log(
    "[CombatLogger] Installed. Ctrl+Shift+L to export. window.__combatLogger for console access."
  );
})();
