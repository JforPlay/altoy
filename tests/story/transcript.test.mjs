/**
 * transcript.test.mjs
 * Pure transcript module: sequence-line parsing (moved from the engine),
 * script-line collection (say/narration/scene/choice), and the deterministic
 * plain-text serialization used by the modal's copy button.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    formatSequenceLine,
    extractSequenceLines,
    collectTranscriptLines,
    transcriptToPlainText,
} from '../../public/js/story-viewer/story.transcript.js';

// Stub actor resolver: numeric actor 1 -> named speaker, everything else narration.
const resolve = (line) => (line.actor === 1 ? '라피' : (line.actorName || ''));

// ===== formatSequenceLine (engine-parity spec for the module move) =====

test('formatSequenceLine strips tags and maps <size=N> to a clamped scale', () => {
    assert.deepEqual(formatSequenceLine('<size=80>큰 글씨</size>'), { text: '큰 글씨', scale: 1.6 });
    assert.deepEqual(formatSequenceLine('<size=10>작게</size>'), { text: '작게', scale: 0.7 });
    assert.deepEqual(formatSequenceLine('<size=55>보통</size>'), { text: '보통', scale: 1.1 });
    assert.deepEqual(formatSequenceLine('<i>수식 없는</i> 텍스트'), { text: '수식 없는 텍스트', scale: 1 });
});

test('formatSequenceLine tolerates empty and non-string input', () => {
    assert.deepEqual(formatSequenceLine(''), { text: '', scale: 1 });
    assert.deepEqual(formatSequenceLine(null), { text: '', scale: 1 });
    assert.deepEqual(formatSequenceLine(undefined), { text: '', scale: 1 });
});

// ===== extractSequenceLines =====

test('extractSequenceLines reads array-form sequence entries', () => {
    const line = { sequence: [['첫 번째 카드'], ['두 번째 카드', 9]] };
    assert.deepEqual(extractSequenceLines(line).map(l => l.text), ['첫 번째 카드', '두 번째 카드']);
});

test('extractSequenceLines reads string-form sequence and signDate fallback', () => {
    assert.deepEqual(extractSequenceLines({ sequence: '단일 카드' }).map(l => l.text), ['단일 카드']);
    assert.deepEqual(extractSequenceLines({ signDate: ['1941년 12월'] }).map(l => l.text), ['1941년 12월']);
});

test('extractSequenceLines prefers sequence over signDate and drops empty entries', () => {
    const line = { sequence: [['본문'], ['']], signDate: ['무시됨'] };
    assert.deepEqual(extractSequenceLines(line).map(l => l.text), ['본문']);
    assert.deepEqual(extractSequenceLines({}), []);
    assert.deepEqual(extractSequenceLines(null), []);
});

// ===== collectTranscriptLines =====

test('collects a spoken line with speaker and stripped markup', () => {
    const scripts = [{ actor: 1, say: '<color=#ff0000>적 발견!</color> 출격할게.' }];
    assert.deepEqual(collectTranscriptLines(scripts, resolve), [
        { kind: 'say', speaker: '라피', text: '적 발견! 출격할게.' },
    ]);
});

test('speakerless and Narrator-resolved lines become narration', () => {
    const scripts = [
        { say: '바람만이 불고 있었다.' },
        { actorName: 'Narrator', say: '── 그리고 며칠 뒤 ──' },
    ];
    assert.deepEqual(collectTranscriptLines(scripts, resolve), [
        { kind: 'narration', text: '바람만이 불고 있었다.' },
        { kind: 'narration', text: '── 그리고 며칠 뒤 ──' },
    ]);
});

test('sequence cards come before the same line\'s say; options come after', () => {
    const scripts = [{
        actor: 1,
        say: '어떻게 할까?',
        sequence: [['3일 후']],
        options: [
            { flag: 1, content: '<color=#00ff00>출격한다</color>' },
            { flag: 2, content: '대기한다' },
        ],
    }];
    assert.deepEqual(collectTranscriptLines(scripts, resolve), [
        { kind: 'scene', text: '3일 후' },
        { kind: 'say', speaker: '라피', text: '어떻게 할까?' },
        { kind: 'choice', text: '출격한다' },
        { kind: 'choice', text: '대기한다' },
    ]);
});

test('content-less lines are skipped and multi-line say keeps its newlines', () => {
    const scripts = [
        { bgName: 'bg_1', bgm: 'story-1' },
        { say: '   ' },
        { actor: 1, say: '첫 줄\n둘째 줄' },
    ];
    assert.deepEqual(collectTranscriptLines(scripts, resolve), [
        { kind: 'say', speaker: '라피', text: '첫 줄\n둘째 줄' },
    ]);
});

test('tolerates empty or non-array scripts', () => {
    assert.deepEqual(collectTranscriptLines([], resolve), []);
    assert.deepEqual(collectTranscriptLines(null, resolve), []);
});

// ===== transcriptToPlainText =====

test('serializes a multi-section group transcript with missing-data marker', () => {
    const sections = [
        {
            title: '1장',
            lines: [
                { kind: 'say', speaker: '라피', text: '안녕!' },
                { kind: 'narration', text: '나레이션입니다.' },
                { kind: 'scene', text: '3일 후' },
                { kind: 'choice', text: '출격한다' },
            ],
        },
        { title: '2장', lines: null },
    ];
    assert.equal(
        transcriptToPlainText('아이리스의 천사 — 전체 대사', sections),
        '아이리스의 천사 — 전체 대사\n\n'
        + '[1장]\n\n'
        + '라피: 안녕!\n'
        + '나레이션입니다.\n'
        + '— 3일 후 —\n'
        + '[선택] 출격한다\n\n'
        + '[2장]\n\n'
        + '(스토리 데이터 없음)'
    );
});

test('single untitled section (per-story view) has no section header', () => {
    const sections = [{ title: null, lines: [{ kind: 'say', speaker: '라피', text: '안녕!' }] }];
    assert.equal(
        transcriptToPlainText('3장 - 위기', sections),
        '3장 - 위기\n\n라피: 안녕!'
    );
});
