import { describe, expect, it } from 'vitest';
import { markdownToPlainText, parseSuggestionsFromResponse } from './modalUtils';

describe('markdownToPlainText', () => {
  it('removes h1 headers', () => {
    expect(markdownToPlainText('# Header')).toBe('Header');
  });

  it('removes h2 headers', () => {
    expect(markdownToPlainText('## Header')).toBe('Header');
  });

  it('removes h3-h6 headers', () => {
    expect(markdownToPlainText('### H3')).toBe('H3');
    expect(markdownToPlainText('#### H4')).toBe('H4');
    expect(markdownToPlainText('##### H5')).toBe('H5');
    expect(markdownToPlainText('###### H6')).toBe('H6');
  });

  it('removes bold markers (**)', () => {
    expect(markdownToPlainText('**bold text**')).toBe('bold text');
  });

  it('removes italic markers (*)', () => {
    expect(markdownToPlainText('*italic text*')).toBe('italic text');
  });

  it('removes bold markers (__)', () => {
    expect(markdownToPlainText('__bold text__')).toBe('bold text');
  });

  it('removes italic markers (_)', () => {
    expect(markdownToPlainText('_italic text_')).toBe('italic text');
  });

  it('removes links but keeps text', () => {
    expect(markdownToPlainText('[click here](https://example.com)')).toBe('click here');
  });

  it('removes inline code backticks', () => {
    expect(markdownToPlainText('use `kubectl get pods`')).toBe('use kubectl get pods');
  });

  it('removes strikethrough', () => {
    expect(markdownToPlainText('~~deleted~~')).toBe('deleted');
  });

  it('collapses extra whitespace', () => {
    expect(markdownToPlainText('too   many    spaces')).toBe('too many spaces');
  });

  it('removes list markers (-)', () => {
    expect(markdownToPlainText('- list item')).toBe('list item');
  });

  it('removes list markers (*)', () => {
    expect(markdownToPlainText('* list item')).toBe('list item');
  });

  it('removes list markers (+)', () => {
    expect(markdownToPlainText('+ list item')).toBe('list item');
  });

  it('removes numbered list markers', () => {
    expect(markdownToPlainText('1. first item')).toBe('first item');
  });

  it('removes blockquote markers', () => {
    expect(markdownToPlainText('> quoted text')).toBe('quoted text');
  });

  it('removes horizontal rules', () => {
    expect(markdownToPlainText('---')).toBe('');
  });

  it('handles combined markdown', () => {
    const input = '## **Bold Header**\n- *item one*\n- `item two`';
    const result = markdownToPlainText(input);
    expect(result).toContain('Bold Header');
    expect(result).toContain('item one');
    expect(result).toContain('item two');
    expect(result).not.toContain('**');
    expect(result).not.toContain('*');
    expect(result).not.toContain('`');
    expect(result).not.toContain('##');
  });

  it('handles empty string', () => {
    expect(markdownToPlainText('')).toBe('');
  });

  it('handles plain text without markdown', () => {
    expect(markdownToPlainText('plain text')).toBe('plain text');
  });

  it('handles bold + italic (***text***)', () => {
    const result = markdownToPlainText('***bold italic***');
    expect(result).toBe('bold italic');
  });

  it('handles nested bold in italic', () => {
    const result = markdownToPlainText('*some **bold** in italic*');
    expect(result).toContain('some');
    expect(result).toContain('bold');
    expect(result).toContain('in italic');
  });
});

describe('parseSuggestionsFromResponse', () => {
  it('extracts suggestions from response', () => {
    const content = 'Here is the answer.\nSUGGESTIONS: Show pods | Check logs | Describe service';
    const result = parseSuggestionsFromResponse(content);
    expect(result.suggestions).toEqual(['Show pods', 'Check logs', 'Describe service']);
    expect(result.cleanContent).toBe('Here is the answer.');
  });

  it('removes suggestions line from clean content', () => {
    const content = 'Answer text\nSUGGESTIONS: A | B | C\nMore text';
    const result = parseSuggestionsFromResponse(content);
    expect(result.cleanContent).not.toContain('SUGGESTIONS');
    expect(result.cleanContent).toContain('Answer text');
    expect(result.cleanContent).toContain('More text');
  });

  it('limits to 3 suggestions', () => {
    const content = 'SUGGESTIONS: A | B | C | D | E';
    const result = parseSuggestionsFromResponse(content);
    expect(result.suggestions).toHaveLength(3);
  });

  it('returns empty suggestions when no SUGGESTIONS line', () => {
    const content = 'Just a regular response with no suggestions';
    const result = parseSuggestionsFromResponse(content);
    expect(result.suggestions).toEqual([]);
    expect(result.cleanContent).toBe(content);
  });

  it('handles case-insensitive SUGGESTIONS', () => {
    const content = 'suggestions: Option A | Option B';
    const result = parseSuggestionsFromResponse(content);
    expect(result.suggestions).toHaveLength(2);
  });

  it('filters empty suggestions', () => {
    const content = 'SUGGESTIONS: A | | B';
    const result = parseSuggestionsFromResponse(content);
    expect(result.suggestions).toEqual(['A', 'B']);
  });

  it('strips markdown from suggestion text', () => {
    const content = 'SUGGESTIONS: **bold option** | `code option`';
    const result = parseSuggestionsFromResponse(content);
    expect(result.suggestions).toEqual(['bold option', 'code option']);
  });

  it('handles non-string content (array)', () => {
    const content = [
      { type: 'text', text: 'Answer\nSUGGESTIONS: A | B' },
      { type: 'image', url: 'http://example.com/img.png' },
    ];
    const result = parseSuggestionsFromResponse(content);
    expect(result.suggestions).toEqual(['A', 'B']);
    expect(result.cleanContent).toContain('Answer');
  });

  it('handles non-string content (object with text)', () => {
    const content = { text: 'Answer\nSUGGESTIONS: X | Y' };
    const result = parseSuggestionsFromResponse(content);
    expect(result.suggestions).toEqual(['X', 'Y']);
  });

  it('handles null content', () => {
    const result = parseSuggestionsFromResponse(null);
    expect(result.suggestions).toEqual([]);
    expect(result.cleanContent).toBe('');
  });

  it('handles undefined content', () => {
    const result = parseSuggestionsFromResponse(undefined);
    expect(result.suggestions).toEqual([]);
    expect(result.cleanContent).toBe('');
  });

  it('handles number content', () => {
    const result = parseSuggestionsFromResponse(42);
    expect(result.suggestions).toEqual([]);
    expect(result.cleanContent).toBe('42');
  });

  it('handles empty string', () => {
    const result = parseSuggestionsFromResponse('');
    expect(result.suggestions).toEqual([]);
    expect(result.cleanContent).toBe('');
  });

  it('only captures first SUGGESTIONS line', () => {
    const content = 'SUGGESTIONS: A | B\nSUGGESTIONS: C | D';
    const result = parseSuggestionsFromResponse(content);
    expect(result.suggestions).toEqual(['A', 'B']);
    expect(result.cleanContent).not.toContain('SUGGESTIONS:');
  });
});

describe('malformed AI output handling', () => {
  describe('markdownToPlainText with malformed markdown', () => {
    it('handles unclosed bold markers', () => {
      const result = markdownToPlainText('**unclosed bold');
      expect(result).toContain('unclosed bold');
    });

    it('handles unclosed italic markers', () => {
      const result = markdownToPlainText('*unclosed italic');
      expect(result).toContain('unclosed italic');
    });

    it('handles unclosed inline code', () => {
      const result = markdownToPlainText('use `kubectl get');
      expect(result).toContain('kubectl get');
    });

    it('handles unclosed link syntax', () => {
      const result = markdownToPlainText('[click here](http://');
      expect(result).toContain('click here');
    });

    it('handles link with no URL (keeps partial syntax)', () => {
      const result = markdownToPlainText('[text]()');
      expect(result).toContain('text');
    });

    it('handles nested unclosed markers', () => {
      const result = markdownToPlainText('**bold *italic');
      expect(result).toContain('bold');
      expect(result).toContain('italic');
    });

    it('handles markdown table-like content', () => {
      const result = markdownToPlainText('| col1 | col2 |\n|---|---|\n| a | b |');
      expect(result).toContain('col1');
      expect(result).toContain('col2');
    });

    it('handles triple backtick code block markers inline', () => {
      const result = markdownToPlainText('use ```kubectl get pods```');
      expect(result).toContain('kubectl get pods');
    });

    it('handles excessive heading levels', () => {
      const result = markdownToPlainText('####### Not a heading');
      expect(result).toContain('Not a heading');
    });

    it('handles heading with no text', () => {
      const result = markdownToPlainText('## ');
      expect(result.trim()).toBe('');
    });

    it('handles multiple horizontal rules', () => {
      const result = markdownToPlainText('---\ntext\n---\nmore\n---');
      expect(result).toContain('text');
      expect(result).toContain('more');
    });

    it('handles image syntax', () => {
      const result = markdownToPlainText('![alt text](image.png)');
      expect(result).toContain('alt text');
    });

    it('handles strikethrough with no closing', () => {
      const result = markdownToPlainText('~~deleted text');
      expect(result).toContain('deleted text');
    });

    it('handles mixed unclosed formatting', () => {
      const result = markdownToPlainText('**bold *italic `code ~~strike');
      expect(result).toContain('bold');
      expect(result).toContain('italic');
      expect(result).toContain('code');
    });
  });

  describe('parseSuggestionsFromResponse with malformed output', () => {
    it('handles SUGGESTIONS with no pipe separators', () => {
      const result = parseSuggestionsFromResponse('SUGGESTIONS: just one suggestion');
      expect(result.suggestions).toEqual(['just one suggestion']);
    });

    it('handles SUGGESTIONS with only pipes', () => {
      const result = parseSuggestionsFromResponse('SUGGESTIONS: | | |');
      expect(result.suggestions).toEqual([]);
    });

    it('handles SUGGESTIONS with very long suggestion text', () => {
      const longSuggestion = 'A'.repeat(500);
      const result = parseSuggestionsFromResponse(`SUGGESTIONS: ${longSuggestion} | Short`);
      expect(result.suggestions).toHaveLength(2);
      expect(result.suggestions[0].length).toBe(500);
    });

    it('handles SUGGESTIONS with special characters', () => {
      const result = parseSuggestionsFromResponse(
        'SUGGESTIONS: kubectl get pods --namespace=kube-system | az aks show --name="cluster"'
      );
      expect(result.suggestions).toHaveLength(2);
    });

    it('handles SUGGESTIONS with unicode characters', () => {
      const result = parseSuggestionsFromResponse('SUGGESTIONS: 查看日志 | ポッド確認');
      expect(result.suggestions).toHaveLength(2);
    });

    it('handles SUGGESTIONS embedded in markdown', () => {
      const content = '## Results\n\n**Info**: data\n\nSUGGESTIONS: A | B\n\n### Footer';
      const result = parseSuggestionsFromResponse(content);
      expect(result.suggestions).toEqual(['A', 'B']);
      expect(result.cleanContent).toContain('## Results');
      expect(result.cleanContent).toContain('### Footer');
      expect(result.cleanContent).not.toContain('SUGGESTIONS');
    });

    it('handles content that contains SUGGESTIONS as a word in prose', () => {
      const content = 'The SUGGESTIONS: feature allows users to pick from options.';
      const result = parseSuggestionsFromResponse(content);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('handles SUGGESTIONS with markdown in values', () => {
      const content = 'SUGGESTIONS: **Check** `pods` | _List_ services | ~~Delete~~ ns';
      const result = parseSuggestionsFromResponse(content);
      expect(result.suggestions).toEqual(['Check pods', 'List services', 'Delete ns']);
    });

    it('handles SUGGESTIONS at end of content with no newline', () => {
      const content = 'Here is the answer.\nSUGGESTIONS: A | B | C';
      const result = parseSuggestionsFromResponse(content);
      expect(result.suggestions).toEqual(['A', 'B', 'C']);
      expect(result.cleanContent).toBe('Here is the answer.');
    });

    it('handles array with no text items', () => {
      const content = [
        { type: 'image', url: 'http://example.com/img.png' },
        { type: 'audio', url: 'http://example.com/audio.mp3' },
      ];
      const result = parseSuggestionsFromResponse(content);
      expect(result.suggestions).toEqual([]);
      expect(result.cleanContent).toBe('');
    });

    it('handles array with empty text items', () => {
      const content = [
        { type: 'text', text: '' },
        { type: 'text', text: '' },
      ];
      const result = parseSuggestionsFromResponse(content);
      expect(result.suggestions).toEqual([]);
    });

    it('handles object with empty text property (falls through to String())', () => {
      const result = parseSuggestionsFromResponse({ text: '' });
      expect(result.suggestions).toEqual([]);
      expect(result.cleanContent).toBe('[object Object]');
    });

    it('handles boolean content', () => {
      const result = parseSuggestionsFromResponse(true);
      expect(result.suggestions).toEqual([]);
      expect(result.cleanContent).toBe('true');
    });

    it('handles object with no text property', () => {
      const result = parseSuggestionsFromResponse({ other: 'value' });
      expect(result.suggestions).toEqual([]);
    });
  });
});
