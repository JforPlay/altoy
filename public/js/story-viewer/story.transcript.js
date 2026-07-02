/**
 * story.transcript.js
 * Full-script transcript for the story viewer modal: sequence/title-card
 * parsing (moved out of the engine), script-line collection into
 * say/narration/scene/choice entries, the deterministic plain-text
 * serialization behind the copy button, and the DOM fragment renderer.
 *
 * Pure module — no engine/window state; DOM only inside
 * buildTranscriptFragment. Node-importable for tests.
 */

const TAG_RE = /<\/?[^>]+>/g;

const stripTags = (s) => String(s).replace(TAG_RE, '');

/**
 * Parse a raw sequence text entry — strip HTML tags and map any `<size=N>`
 * tag to a CSS scale factor clamped to [0.7, 1.6]. (Engine-parity: moved
 * verbatim from story-viewer.engine.js.)
 */
export function formatSequenceLine(rawText) {
    if (!rawText || typeof rawText !== 'string') return { text: '', scale: 1 };

    const sizeMatch = rawText.match(/<size=([0-9]+)>/i);
    let scale = 1;
    if (sizeMatch) {
        const sizeValue = parseFloat(sizeMatch[1]);
        if (Number.isFinite(sizeValue) && sizeValue > 0) {
            scale = Math.min(Math.max(sizeValue / 50, 0.7), 1.6);
        }
    }

    const cleanedText = rawText
        .replace(/<size=\d+>/gi, '')
        .replace(/<\/size>/gi, '')
        .replace(TAG_RE, '')
        .trim();

    return { text: cleanedText, scale };
}

/**
 * Extract formatted text entries from a line's sequence or signDate field
 * (fullscreen title cards). Returns [{text, scale}]. (Engine-parity move.)
 */
export function extractSequenceLines(line) {
    if (!line) return [];

    const collected = [];

    if (Array.isArray(line.sequence) && line.sequence.length > 0) {
        line.sequence.forEach(entry => {
            const rawText = Array.isArray(entry) ? entry[0] : entry;
            const formatted = formatSequenceLine(rawText);
            if (formatted.text) collected.push(formatted);
        });
    } else if (typeof line.sequence === 'string') {
        const formatted = formatSequenceLine(line.sequence);
        if (formatted.text) collected.push(formatted);
    } else if (Array.isArray(line.signDate) && line.signDate[0]) {
        const formatted = formatSequenceLine(line.signDate[0]);
        if (formatted.text) collected.push(formatted);
    }

    return collected;
}

/**
 * Flatten a story script into transcript entries, in reading order:
 * each line's scene cards, then its spoken text, then its choice options.
 *
 * @param {Array} scripts - story script lines
 * @param {(line: object) => string} resolveActorName - speaker name for a
 *   line; '' or 'Narrator' marks the line as narration (no speaker prefix)
 * @returns {Array<{kind: 'say'|'narration'|'scene'|'choice', speaker?: string, text: string}>}
 */
export function collectTranscriptLines(scripts, resolveActorName) {
    if (!Array.isArray(scripts)) return [];

    const lines = [];
    for (const line of scripts) {
        if (!line || typeof line !== 'object') continue;

        for (const seq of extractSequenceLines(line)) {
            lines.push({ kind: 'scene', text: seq.text });
        }

        if (typeof line.say === 'string' && line.say.trim() !== '') {
            const text = stripTags(line.say).trim();
            const name = resolveActorName ? String(resolveActorName(line) ?? '') : '';
            if (!name || name === 'Narrator') {
                lines.push({ kind: 'narration', text });
            } else {
                lines.push({ kind: 'say', speaker: name, text });
            }
        }

        if (Array.isArray(line.options)) {
            for (const opt of line.options) {
                const content = typeof opt?.content === 'string' ? stripTags(opt.content).trim() : '';
                if (content) lines.push({ kind: 'choice', text: content });
            }
        }
    }
    return lines;
}

/**
 * Serialize transcript sections to the plain text placed on the clipboard.
 * Line grammar (parse-friendly): `화자: 대사`, bare narration, `— 씬 —`,
 * `[선택] 내용`, missing section = `(스토리 데이터 없음)`.
 *
 * @param {string} title - heading line, printed verbatim (falsy = omitted)
 * @param {Array<{title: string|null, lines: Array|null}>} sections
 */
export function transcriptToPlainText(title, sections) {
    const blocks = [];
    if (title) blocks.push(title);

    for (const section of sections || []) {
        const parts = [];
        if (section.title) parts.push(`[${section.title}]`, '');
        if (!section.lines) {
            parts.push('(스토리 데이터 없음)');
        } else {
            for (const l of section.lines) {
                if (l.kind === 'say') parts.push(`${l.speaker}: ${l.text}`);
                else if (l.kind === 'scene') parts.push(`— ${l.text} —`);
                else if (l.kind === 'choice') parts.push(`[선택] ${l.text}`);
                else parts.push(l.text);
            }
        }
        blocks.push(parts.join('\n'));
    }

    return blocks.join('\n\n');
}

/**
 * Render transcript sections to a DocumentFragment for the script modal.
 * All content lands via textContent (no innerHTML).
 */
export function buildTranscriptFragment(sections) {
    const frag = document.createDocumentFragment();

    for (const section of sections || []) {
        const wrap = document.createElement('section');
        wrap.className = 'transcript-section';

        if (section.title) {
            const heading = document.createElement('h3');
            heading.className = 'transcript-section-title';
            heading.textContent = section.title;
            wrap.appendChild(heading);
        }

        if (!section.lines) {
            const p = document.createElement('p');
            p.className = 'transcript-missing';
            p.textContent = '(스토리 데이터 없음)';
            wrap.appendChild(p);
        } else {
            for (const l of section.lines) {
                const p = document.createElement('p');
                if (l.kind === 'say') {
                    p.className = 'transcript-say';
                    const strong = document.createElement('strong');
                    strong.textContent = `${l.speaker}:`;
                    p.append(strong, ` ${l.text}`);
                } else if (l.kind === 'scene') {
                    p.className = 'transcript-scene';
                    p.textContent = `— ${l.text} —`;
                } else if (l.kind === 'choice') {
                    p.className = 'transcript-choice';
                    p.textContent = `[선택] ${l.text}`;
                } else {
                    p.className = 'transcript-narration';
                    p.textContent = l.text;
                }
                wrap.appendChild(p);
            }
        }

        frag.appendChild(wrap);
    }

    return frag;
}
