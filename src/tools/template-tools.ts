import type { ToolHandler } from './types.js';
import { success } from './types.js';

export const definitions = [
  {
    name: 'create_from_template',
    description: 'Create a new note from a template with variable substitution',
    inputSchema: {
      type: 'object',
      properties: {
        templatePath: { type: 'string', description: 'Path to the template note' },
        outputPath: { type: 'string', description: 'Path for the new note' },
        variables: { type: 'object', description: 'Custom template variables' },
      },
      required: ['templatePath', 'outputPath'],
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  async create_from_template(args, ctx) {
    const { templatePath, outputPath, variables = {} } = args as any;
    const title = outputPath.split('/').pop()?.replace(/\.md$/, '') || outputPath;
    const template = await ctx.vaultAccess.readNote(templatePath);
    const rendered = ctx.templateService.render(template.originalContent, title, variables);
    await ctx.vaultAccess.writeNote({ path: outputPath, content: rendered, mode: 'overwrite' });
    await ctx.cacheService.updateEntry(outputPath, rendered);
    return success({ path: outputPath, message: `Created note from template ${templatePath}` });
  },
};
