import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatSkillDesc } from '../../public/js/simulators/sim.weapon.stats.js';

const catalogRaw = readFileSync('public/data/sim/cross_fleet_skills.json');
const rows = JSON.parse(catalogRaw.toString('utf-8'));
const skillTpl = JSON.parse(readFileSync('public/data/sim/skill_data_template.json', 'utf-8'));
const weaponSkills = JSON.parse(readFileSync('public/data/sim/skill_weapon_data.json', 'utf-8'));

test('has 36 rows: 28 barrage + 8 buff', () => {
    assert.equal(rows.length, 36);
    assert.equal(rows.filter((r) => r.type === 'barrage').length, 28);
    assert.equal(rows.filter((r) => r.type === 'buff').length, 8);
});

test('render_kind breakdown 25 bullet / 3 aircraft / 8 none', () => {
    const count = (kind) => rows.filter((r) => r.render_kind === kind).length;
    assert.equal(count('bullet'), 25);
    assert.equal(count('aircraft'), 3);
    assert.equal(count('none'), 8);
});

test('every barrage payload is injected into skill_weapon_data', () => {
    for (const row of rows.filter((entry) => entry.type === 'barrage')) {
        for (const skillId of row.fs_skill_id) {
            assert.equal(weaponSkills[String(skillId)]?.cross_fleet, true, `${row.skill_name}: missing injected FireSupport skill ${skillId}`);
        }
    }
});

test('every barrage has fs_skill_id(s); buffs have none', () => {
    for (const row of rows) {
        if (row.type === 'barrage') {
            assert.ok(Array.isArray(row.fs_skill_id) && row.fs_skill_id.length > 0, `barrage ${row.skill_name} needs fs_skill_id`);
        } else {
            assert.deepEqual(row.fs_skill_id, []);
        }
    }
});

test('required fields present', () => {
    const requiredFields = [
        'player_skill_id', 'fs_skill_id', 'ship_gid', 'ship_name', 'faction',
        'skill_name', 'skill_icon', 'ship_icon', 'shipyard', 'position',
        'class_name', 'type', 'render_kind', 'retrofit', 'trigger_excerpt',
        'trigger_text',
    ];
    for (const row of rows) {
        for (const field of requiredFields) {
            assert.ok(Object.hasOwn(row, field), `${row.skill_name || row.player_skill_id} missing ${field}`);
        }
    }
});

test('every player skill has its template (source of $n params)', () => {
    for (const row of rows) {
        assert.ok(skillTpl[String(row.player_skill_id)], `player skill ${row.player_skill_id} (${row.skill_name}) missing from skill_data_template`);
    }
});

test('producer trigger_text matches formatSkillDesc with no unresolved params', () => {
    for (const row of rows) {
        const template = skillTpl[String(row.player_skill_id)];
        const expected = formatSkillDesc(row.trigger_excerpt, { descGetAdd: template.desc_get_add });
        assert.equal(row.trigger_text, expected, `${row.skill_name}: trigger_text drifted from the browser formatter`);
        assert.doesNotMatch(row.trigger_text, /\$\d+/, `${row.skill_name}: unresolved placeholder in "${row.trigger_text}"`);
    }
});

test('catalog remains below the 64 KiB raw budget', () => {
    assert.ok(catalogRaw.byteLength < 64 * 1024, `catalog is ${catalogRaw.byteLength} B raw`);
});
