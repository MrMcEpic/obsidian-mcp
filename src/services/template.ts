export class TemplateService {
  render(
    template: string,
    title: string,
    variables: Record<string, string>,
  ): string {
    const now = new Date();
    const builtins: Record<string, string> = {
      title,
      date: now.toISOString().split('T')[0]!,
      time: now.toTimeString().split(' ')[0]!,
      datetime: `${now.toISOString().split('T')[0]} ${now.toTimeString().split(' ')[0]}`,
    };

    const allVars = { ...builtins, ...variables };

    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return key in allVars ? allVars[key]! : match;
    });
  }
}
