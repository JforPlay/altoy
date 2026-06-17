/**
 * cross-fleet.main.js
 * Catalog page: loads cross_fleet_skills.json, renders a sortable/filterable table,
 * and renders the selected barrage in an embedded canvas via the shared
 * sim.weapon.controller. Buff rows link to shipgirl-info (no render).
 */
import { fetchJSONWithCache, resolveUrl, createImgElement, setupFpsDisplay } from '../utils.js';
import { setupSpeedControls, setupPauseButton, setupEnemyToggle } from './sim.ui.js';
import { createWeaponSim } from './sim.weapon.controller.js';
import { formatSkillDesc } from './sim.weapon.stats.js';

document.addEventListener('DOMContentLoaded', async () => {
    const tbody = document.getElementById('cf-tbody');
    const factionFilter = document.getElementById('cf-faction-filter');
    const typeFilter = document.getElementById('cf-type-filter');
    const fireButton = document.getElementById('fire-button');
    const nowFiring = document.getElementById('cf-now-firing');
    const playerAreaDiv = document.getElementById('player-area');

    const sim = createWeaponSim({
        container: document.getElementById('simulation-container'),
        entities: {
            vanguard: document.getElementById('vanguard'),
            mainfleet: document.getElementById('mainfleet'),
            enemy: document.getElementById('enemy'),
        },
        visualLog: document.getElementById('visual-log'),
    });

    let rows = [];
    let sort = { key: 'faction', dir: 1 };
    const active = { faction: new Set(), type: new Set() };
    let selected = null;   // currently selected barrage row

    try {
        rows = await fetchJSONWithCache('data/sim/cross_fleet_skills.json');
        await sim.data.loadData();
    } catch (e) {
        tbody.replaceChildren(rowMessage('데이터를 불러올 수 없습니다.'));
        return;
    }
    sim.updateLayoutAndScale(playerAreaDiv);
    setupFpsDisplay(document.getElementById('fps-display'));
    setupSpeedControls(sim.simEngine);
    setupPauseButton(sim.simEngine, document.getElementById('pause-button'));
    setupEnemyToggle(sim.simEngine, document.getElementById('enemy-toggle'), playerAreaDiv);
    window.addEventListener('resize', () => sim.updateLayoutAndScale(playerAreaDiv));

    buildFilterChips();
    bindSortHeaders();
    render();

    fireButton.addEventListener('click', async () => {
        if (!selected) return;
        sim.clearActiveFire();
        nowFiring.textContent = `${selected.ship_name} — ${selected.skill_name}`;
        // a barrage row may map to multiple FS waves (e.g. 알자스); fire each
        for (const fsId of selected.fs_skill_id) await sim.fireSkill(String(fsId), '1');
    });

    // ---------- table ----------
    function visibleRows() {
        return rows.filter(r =>
            (active.faction.size === 0 || active.faction.has(r.faction)) &&
            (active.type.size === 0 || active.type.has(r.type))
        ).sort((a, b) => {
            const av = a[sort.key] ?? '', bv = b[sort.key] ?? '';
            return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
        });
    }

    function render() {
        const frag = document.createDocumentFragment();
        for (const r of visibleRows()) frag.appendChild(buildRow(r));
        tbody.replaceChildren(frag);
    }

    function buildRow(r) {
        const tr = document.createElement('tr');
        tr.className = 'cf-row' + (r.type === 'buff' ? ' cf-row-buff' : '');

        // 함순이
        const shipTd = document.createElement('td');
        shipTd.className = 'cf-ship';
        if (r.ship_icon) shipTd.appendChild(createImgElement(r.ship_icon, '', { className: 'cf-ship-icon' }));
        const shipName = document.createElement('a');
        shipName.href = resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(r.ship_name)}`);
        shipName.textContent = r.ship_name;
        shipTd.appendChild(shipName);

        // 스킬
        const skillTd = document.createElement('td');
        if (r.skill_icon) skillTd.appendChild(createImgElement(r.skill_icon, '', { className: 'cf-skill-icon' }));
        skillTd.appendChild(document.createTextNode(r.skill_name));

        // 진영 / 타입 / 개조
        const facTd = td(r.faction);
        const typeTd = document.createElement('td');
        const badge = document.createElement('span');
        // Canonical .badge: barrage = informational (--info), buff = generic (--neutral).
        badge.className = `badge badge--${r.type === 'barrage' ? 'info' : 'neutral'}`;
        badge.textContent = r.type === 'barrage' ? '탄막' : '버프';
        typeTd.appendChild(badge);
        const rtTd = td(r.retrofit ? '✓' : '');

        // 트리거 — trigger_excerpt is a slice of the player skill's template desc,
        // so its $1,$2,… resolve against that skill's desc_get_add (same as weapon-sim).
        const tpl = sim.data.getSkillTemplate(String(r.player_skill_id));
        const trigText = r.trigger_excerpt
            ? formatSkillDesc(r.trigger_excerpt, { descGetAdd: tpl?.desc_get_add })
            : '';
        const trigTd = td(trigText);
        trigTd.className = 'cf-col-trigger';

        // 동작
        const actTd = document.createElement('td');
        if (r.type === 'barrage') {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-primary cf-render-btn';
            btn.textContent = '▶ 시뮬레이션';
            btn.addEventListener('click', () => selectRow(r, tr));
            actTd.appendChild(btn);
        } else {
            const link = document.createElement('a');
            link.href = resolveUrl(`shipgirl/shipgirl-info/?ship=${encodeURIComponent(r.ship_name)}`);
            link.className = 'cf-info-link';
            link.textContent = '정보 →';
            actTd.appendChild(link);
        }

        tr.append(shipTd, skillTd, facTd, typeTd, rtTd, trigTd, actTd);
        return tr;
    }

    function selectRow(r, tr) {
        selected = r;
        fireButton.disabled = false;
        tbody.querySelectorAll('.cf-row-selected').forEach(el => el.classList.remove('cf-row-selected'));
        tr.classList.add('cf-row-selected');
        // render sits at the top of the page; bring it into view when a row deep
        // in the catalogue below is chosen
        document.getElementById('simulation-container').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        fireButton.click();
    }

    // ---------- filters & sort ----------
    function buildFilterChips() {
        const factions = [...new Set(rows.map(r => r.faction))].sort();
        factionFilter.append(...factions.map(f => chip(f, active.faction, f)));
        typeFilter.append(chip('탄막', active.type, 'barrage'), chip('버프', active.type, 'buff'));
    }
    function chip(label, set, value) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'cf-chip'; b.textContent = label;
        b.addEventListener('click', () => {
            if (set.has(value)) { set.delete(value); b.classList.remove('active'); }
            else { set.add(value); b.classList.add('active'); }
            render();
        });
        return b;
    }
    function bindSortHeaders() {
        document.querySelectorAll('.cf-table th[data-sort]').forEach(th => {
            th.classList.add('cf-sortable');
            th.addEventListener('click', () => {
                const key = th.dataset.sort;
                sort = { key, dir: sort.key === key ? -sort.dir : 1 };
                render();
            });
        });
    }
    function td(text) { const c = document.createElement('td'); c.textContent = text; return c; }
    function rowMessage(text) { const tr = document.createElement('tr'); const c = document.createElement('td'); c.colSpan = 7; c.textContent = text; tr.appendChild(c); return tr; }
});
