import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    acquisitionRoutes, archiveDropEntries, isOtherRoute, isShopRoute, mapStages, shopLabels, stageLabel,
} from '../../public/js/shipgirl/ship-acquisition.js';

const byKind = routes => Object.fromEntries(routes.map(r => [r.kind, r.text]));

test('collected data drives every row; the tooltip only backs shops/기타 without `acquire`', () => {
    const ship = {
        light: true, special: true,
        maps: [[], [{ map: 1, type: 0 }, { map: 4, type: 1 }]],
        description: ['메인 스테이지 해역2-1', '훈장 상점 교환(랜덤 갱신)'],
        acquire: [1, 4, 1, 99],
    };
    assert.deepEqual(byKind(acquisitionRoutes(ship, '홍염의 방문자')), {
        build: '소형 · 특형',
        map: '2-1, 2-4',
        archive: '홍염의 방문자',
        shop: '훈장 상점',
        other: '훈장 지원',
    });

    const { acquire, ...preField } = ship;
    assert.deepEqual(byKind(acquisitionRoutes(preField)), {
        build: '소형 · 특형', map: '2-1, 2-4', shop: '훈장 상점',
    });
});

test('every MrLar source code 0..16 has a KR label', () => {
    const routes = byKind(acquisitionRoutes({ acquire: Array.from({ length: 17 }, (_, i) => i) }));
    assert.equal(routes.shop.split(', ').length, 6);
    assert.equal(routes.other.split(', ').length, 11);
});

test('an event-only ship has no routes', () => {
    assert.deepEqual(acquisitionRoutes({ description: ['이벤트: 몽광의 아스트라리움'], acquire: [] }), []);
});

test('tooltip rules keep research-tracker semantics', () => {
    assert.ok(isShopRoute('함대 상점 교환'));
    assert.ok(!isOtherRoute('함대 상점 교환'));
    assert.ok(isOtherRoute('연구 도크'));
    assert.ok(!isOtherRoute('소형함 건조'));
    assert.deepEqual(shopLabels(['군수 상점 교환', '특별 보급 (공훈치 소비)', '코어 교환 획득']), ['연습전 상점', '코어 상점']);
});

test('stage label and archive index guard', () => {
    assert.deepEqual(mapStages(undefined), []);
    assert.equal(stageLabel(['1-1', '1-2', '1-3', '1-4'], 3), '1-1, 1-2, 1-3 +1');
    assert.deepEqual(archiveDropEntries({ version: 1, entries: { 1: 'a' } }), { 1: 'a' });
    assert.equal(archiveDropEntries({ version: 2, entries: {} }), null);
    assert.equal(archiveDropEntries(null), null);
});
