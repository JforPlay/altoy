/** @OnlyCurrentDoc */
/**
 * skin-label-sheet.gs — bound Apps Script for the 스킨 특성 라벨 sheet.
 *
 * THE COPY IN THE REPO (scripts/skin-label-sheet.gs) IS THE SOURCE OF TRUTH.
 * Install: Extensions → Apps Script → paste this whole file over Code.gs →
 * run setup() once. Everything else runs from the ALtoy menu.
 * Setup guide: dev/active/2026-07-28-skin-label-sheet-setup.md
 *
 * All sheet data arrives through ONE deployed file, skin_label_worklist.csv,
 * pre-joined and validated by scripts/sync-skin-labels.mjs. refresh() only
 * APPENDS rows whose id is not in the sheet yet — it never overwrites,
 * deletes or reorders, so hand-entered work cannot be clobbered and an id
 * can never misalign with its row.
 */

var FEED_URL = 'https://jforplay.github.io/altoy/data/skin/skin_label_worklist.csv';
var SHEET_NAME = '라벨';

/**
 * Attribute columns in sheet order — MUST match scripts/skin-attributes.mjs
 * (headers, values, order). refresh() cross-checks the feed's header row and
 * aborts on drift, so a vocabulary change is: update skin-attributes.mjs,
 * mirror it here, re-paste, insert the sheet column by hand (LEFT of 검수),
 * re-run setup().
 *
 * multi: true columns need the manually-set multi-select dropdown — Apps
 * Script cannot create one, so setup() falls back to a warn-only single
 * dropdown there (see the setup guide's one manual step).
 */
var ATTRIBUTES = [
  { header: '아이웨어', multi: false, values: ['없음', '안경', '선글라스', '고글', '안대'] },
  { header: '자세', multi: false, values: ['서기', '엎드리기', '눕기', '앉기·무릎꿇기', '거꾸로', '기타'] },
  { header: '방향', multi: false, values: ['정면', '후면'] },
  { header: '강조부위', multi: false, values: ['없음', '다리·발', '가슴', '엉덩이', '얼굴 클로즈업'] },
  { header: '머리색', multi: false, values: ['금발', '갈색', '흑발', '은발·백발', '적발', '청발', '녹발', '분홍', '보라', '회색'] },
  { header: '머리 다중색', multi: false, values: ['단색', '브릿지', '그라데이션', '투톤', '기타'] },
  { header: '눈색', multi: false, values: ['금색', '갈색', '흑색', '은색·회색', '적색', '청색', '녹색', '분홍', '보라', '오드아이'] },
  { header: '수인특징', multi: true, values: ['없음', '동물귀', '꼬리', '뿔', '날개', '후광'] },
];

// Column order A.. — display columns, then the attributes, 검수 LAST. refresh()
// writes rows positionally against this list and verifies the sheet's header
// row matches it, so extra curator columns (메모 …) must go RIGHT of 검수.
var LEAD_HEADERS = ['클뜯 id', '그림', '이름', '사유'];
var HEADERS = LEAD_HEADERS
  .concat(ATTRIBUTES.map(function (a) { return a.header; }))
  .concat(['검수']);
// Mirrors WORKLIST_FEED_HEADER in scripts/sync-skin-labels.mjs.
var FEED_HEADER = ['id', 'reason', 'name', 'image_url']
  .concat(ATTRIBUTES.map(function (a) { return a.header; }));

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ALtoy')
    .addItem('새로고침 — 작업 목록 불러오기', 'refresh')
    .addItem('시트 구성 (최초 1회)', 'setup')
    .addToUi();
}

/**
 * One-time (and idempotent) layout builder: headers, dropdowns, checkboxes,
 * widths. Never touches data rows, so re-running it after a vocabulary change
 * is safe — but a NEW attribute column must be inserted by hand first, or the
 * header row shifts over existing 검수 values.
 */
function setup() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);

  var widths = { '클뜯 id': 80, '그림': 210, '이름': 220, '사유': 90, '검수': 60 };
  HEADERS.forEach(function (h, i) {
    sheet.setColumnWidth(i + 1, widths[h] || 120);
  });

  var rows = sheet.getMaxRows() - 1;
  ATTRIBUTES.forEach(function (attr, i) {
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(attr.values, true)
      // A multi column holds comma-joined values the single-select rule would
      // reject; warn instead until the manual multi-select step replaces it.
      .setAllowInvalid(attr.multi)
      .build();
    sheet.getRange(2, LEAD_HEADERS.length + 1 + i, rows, 1).setDataValidation(rule);
  });
  sheet.getRange(2, HEADERS.length, rows, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());

  SpreadsheetApp.getUi().alert(
    '시트 구성 완료.\n\n'
    + '남은 수동 단계 1개: 수인특징 열의 데이터 확인 규칙을 열어 '
    + '"여러 항목 선택 허용"을 켜세요 (Apps Script로는 만들 수 없음).\n\n'
    + '작업할 때는 필터 보기(검수 = FALSE)를 사용하세요 — 범위 정렬 금지.');
}

/** Append every worklist row the sheet does not have yet. Append-only. */
function refresh() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) {
    throw new Error('다른 새로고침이 아직 실행 중입니다 — 잠시 후 다시 시도하세요.');
  }
  try {
    var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('"' + SHEET_NAME + '" 시트가 없습니다 — 시트 구성을 먼저 실행하세요.');

    // The sheet header must still be what this script writes rows against —
    // an inserted/moved column would silently shift every appended value.
    var sheetHeader = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0]
      .map(function (h) { return String(h).trim(); });
    if (sheetHeader.join(' ') !== HEADERS.join(' ')) {
      throw new Error('라벨 시트의 1행 헤더가 스크립트와 다릅니다. 열을 추가/이동했다면 '
        + '검수 오른쪽으로 옮기거나, 저장소의 scripts/skin-label-sheet.gs를 다시 붙여넣으세요.');
    }

    var res = UrlFetchApp.fetch(FEED_URL, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      throw new Error('worklist 다운로드 실패 (HTTP ' + res.getResponseCode() + ') — '
        + 'skin_label_worklist.csv가 아직 배포되지 않았는지 확인하세요.');
    }
    var rows = Utilities.parseCsv(res.getContentText());
    var feedHeader = (rows.shift() || []).map(function (h) { return String(h).trim(); });
    if (feedHeader.join(' ') !== FEED_HEADER.join(' ')) {
      throw new Error('worklist 헤더가 이 스크립트와 다릅니다 (vocabulary 변경?). 저장소의 '
        + 'scripts/skin-label-sheet.gs를 다시 붙여넣고 시트 구성을 재실행하세요.\n'
        + '받은 헤더: ' + feedHeader.join(', '));
    }

    // Append after the last non-empty COLUMN A cell, not sheet.getLastRow():
    // chip-style dropdowns / checkbox validation can make Sheets report rows
    // far below the data as "used", which once left a 999-row gap.
    var existing = {};
    var dataEnd = 1;
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function (r, i) {
        var cell = String(r[0]).trim();
        if (!cell) return;
        dataEnd = i + 2;
        var m = cell.match(/^\d+/);
        if (m) existing[m[0]] = true;
      });
    }

    var newRows = [];
    rows.forEach(function (r) {
      var id = String(r[0] || '').trim();
      if (!id || existing[id]) return;
      existing[id] = true; // also dedupes within the feed itself
      // [id, 그림, 이름, 사유, ...attributes, 검수] — positional against HEADERS.
      var row = [Number(id), r[3] ? '=IMAGE("' + r[3] + '")' : '', r[2] || '', r[1] || ''];
      for (var i = 0; i < ATTRIBUTES.length; i++) row.push(r[4 + i] || '');
      row.push(false);
      newRows.push(row);
    });

    if (newRows.length) {
      var start = dataEnd + 1;
      var overflow = start + newRows.length - 1 - sheet.getMaxRows();
      if (overflow > 0) sheet.insertRowsAfter(sheet.getMaxRows(), overflow);
      sheet.getRange(start, 1, newRows.length, HEADERS.length).setValues(newRows);
      sheet.setRowHeights(start, newRows.length, 120);
    }
    SpreadsheetApp.getUi().alert('새로고침 완료 — ' + newRows.length + '행 추가, '
      + (rows.length - newRows.length) + '행은 이미 시트에 있음.');
  } finally {
    lock.releaseLock();
  }
}
