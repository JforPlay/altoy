import test from 'node:test';
import assert from 'node:assert/strict';
import { menuNav } from '../../public/js/shipgirl/shipgirl-tracker.status-menu.js';

test('ArrowDown advances and wraps', () => {
    assert.equal(menuNav(0, 'ArrowDown', 5), 1);
    assert.equal(menuNav(4, 'ArrowDown', 5), 0);
});
test('ArrowUp retreats and wraps', () => {
    assert.equal(menuNav(2, 'ArrowUp', 5), 1);
    assert.equal(menuNav(0, 'ArrowUp', 5), 4);
});
test('Home/End jump', () => {
    assert.equal(menuNav(3, 'Home', 5), 0);
    assert.equal(menuNav(1, 'End', 5), 4);
});
test('other keys return current', () => {
    assert.equal(menuNav(2, 'a', 5), 2);
});
