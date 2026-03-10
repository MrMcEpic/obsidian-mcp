import { describe, it, expect } from 'vitest';
import { TemplateService } from './template.js';

describe('TemplateService', () => {
  const service = new TemplateService();

  it('should substitute built-in variables', () => {
    const template = '# {{title}}\nCreated: {{date}}';
    const result = service.render(template, 'My Note', {});
    expect(result).toContain('# My Note');
    expect(result).toMatch(/Created: \d{4}-\d{2}-\d{2}/);
  });

  it('should substitute custom variables', () => {
    const template = '# {{title}}\nAuthor: {{author}}';
    const result = service.render(template, 'Test', { author: 'Alice' });
    expect(result).toContain('Author: Alice');
  });

  it('should leave undefined variables as-is', () => {
    const template = '# {{title}}\nFoo: {{unknown}}';
    const result = service.render(template, 'Test', {});
    expect(result).toContain('Foo: {{unknown}}');
  });
});
